#!/usr/bin/env node
/**
 * claude-code-subagent-models — add third-party models to Claude Code.
 *
 * Model names matching a configured provider prefix are routed to that
 * provider's Anthropic-compatible endpoint with that provider's API key;
 * everything else keeps the normal session endpoint and auth.
 *
 * Usage: node patch.mjs <input> <output.js> [--providers <file.json>]
 *   <input> = native claude binary or extracted cli.js bundle
 *   Run with: bun <output.js>
 *
 * When <input> is the native binary, the embedded native addons
 * (image-processor, audio-capture, url-handler, computer-use-*) are extracted
 * next to <output.js> in a natives/ directory, and the bundle's $bunfs
 * requires are rewritten to load them from there, so the patched bundle runs
 * under plain bun with the addons intact.
 *
 * CC's built-in grep/find/rg dispatch re-execs CLAUDE_CODE_EXECPATH (the
 * bundle's own executable) as a busybox. Under plain bun that path is bun,
 * so the dispatch is pointed at the native claude binary instead (baked from
 * <input>, or overridden with CC_CLAUDE_BIN).
 *
 * Runtime env (shell or ~/.claude/settings.json "env"):
 *   CC_PROVIDERS    JSON: [{"prefix","baseUrl","apiKeyEnv"}] (optional)
 *   CC_EXTRA_MODELS comma list of model names for the Agent tool (optional)
 *   CC_NATIVES_DIR  override for the natives/ directory (optional)
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MARK = '/*ccr*/';
const ID = '[a-zA-Z_$][\\w$]*';

// files embedded in the binary's $bunfs filesystem that the bundle loads at
// runtime: native addons (require) and JS bundles (readFile for artifacts:
// charts, syntax highlighting, mermaid diagrams)
const BUNFS_FILES = [
  'image-processor.node', 'audio-capture.node', 'url-handler.node',
  'computer-use-swift.node', 'computer-use-input.node',
  'chart.umd.min.js', 'hljsBundle.generated.min.js', 'mermaid.min.js',
];

export const DEFAULT_PROVIDERS = [{
  prefix: 'deepseek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  apiKeyEnv: 'CC_DEEPSEEK_API_KEY',
}];
const DEFAULT_MODELS = ['deepseek-v4-flash'];

// --- structural anchors -----------------------------------------------------

// buildRequest: capture param, options var, defaultBaseURL var
//   2.1.220: async buildRequest(e,{retryCount:t=0}={}){let r={...e},{method:n,...,defaultBaseURL:s}=r;
//   2.1.88:  async buildRequest(q,{retryCount:K=0}={}){let _={...q},{method:z,...,defaultBaseURL:A}=_,
const BUILD_REQ_RE = new RegExp(
  'async buildRequest\\(' +
  '(' + ID + ')' +
  ',\\{retryCount:' + ID + '=0\\}=\\{\\}\\)\\{' +
  'let (' + ID + ')=\\{\\.\\.\\.\\1\\},\\{method:' + ID + ',path:' + ID + ',query:' + ID + ',defaultBaseURL:(' + ID + ')\\}=\\2'
);

// buildURL gate (best-effort): capture gate param + fallback var
//   let n=!qo(this,e0i,"m",$xl).call(this)&&r||this.baseURL
const GATE_RE = new RegExp(
  'let (' + ID + ')=!(' + ID + ')\\(this,' + ID + ',"m",' + ID + '\\)\\.call\\(this\\)&&(' + ID + ')\\|\\|this\\.baseURL'
);

// authHeaders in the SDK class: capture header-merge helper
//   2.1.220: async authHeaders(e){...return As([await this.apiKeyAuth(e),await this.bearerAuth(e)])}
const AUTH_RE = new RegExp(
  'async authHeaders\\(' + ID + '\\)\\{.{0,900}?return (' + ID + ')\\(\\[await this\\.apiKeyAuth\\(' + ID + '\\),await this\\.bearerAuth\\(' + ID + '\\)\\]\\)',
  'sg'
);

// Agent-tool schema enum (helper differs across versions: E vs L, fable absent pre-2.1.x)
const ENUM_RE = /model:([A-Za-z_$][\w$]*)\.enum\((\[[^\]]{0,120}\])\)\.optional\(\)\.describe\(/;

// alias resolver tail (2.1.220: switch on "best" over a model map)
const RESOLVER_TAIL = Buffer.from('case"best":{let r=fYn[cDc()];return r!==void 0?r.builtinDefault(t):Bje(t)}default:return null}');
// alias resolver tail (2.1.88: switch on display-name getters)
const RESOLVER_TAIL_288 = Buffer.from('case n9().haiku35:return"Haiku 3.5";default:return null}');

// --- helpers ----------------------------------------------------------------

function findBun() {
  for (const p of [process.env.HOME + '/.bun/bin/bun', 'bun']) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch {}
  }
  return null;
}

export function extractBundle(binPath) {
  const data = fs.readFileSync(binPath);
  const banner = Buffer.from('// @bun @bytecode @bun-cjs\n(function(exports, require, module, __filename, __dirname)');
  const bunfs = Buffer.from('\x00/$bunfs/root/');
  // native binary mode: pick the largest banner->bunfs section containing the SDK
  let best = null, bestEnd = -1;
  for (let s = data.indexOf(banner); s >= 0; s = data.indexOf(banner, s + 1)) {
    const endMark = data.indexOf(bunfs, s);
    if (endMark < 0) continue;
    const candidate = data.slice(s, endMark);
    if (BUILD_REQ_RE.test(candidate) && (!best || candidate.length > best.length)) { best = candidate; bestEnd = endMark; }
  }
  if (best) return { bundle: best, bunfsStart: bestEnd };
  // plain bundle mode (extracted cli.js or npm bundle)
  if (!BUILD_REQ_RE.test(data)) throw new Error('input is neither a native binary nor a Claude Code bundle');
  return { bundle: data, bunfsStart: -1 };
}

// Extract every runtime-loaded file from a claude binary's $bunfs filesystem.
// Entries are [name\0][content] runs; files are found by name.
export function extractNatives(binPath, outDir) {
  const { bunfsStart } = extractBundle(binPath);
  if (bunfsStart < 0) return [];
  const data = fs.readFileSync(binPath);
  const order = [];
  for (const name of BUNFS_FILES) {
    const key = Buffer.from(name + '\0');
    const idx = data.indexOf(key, bunfsStart); // entry headers only: require strings have no NUL
    if (idx < 0) throw new Error('bunfs entry not found: ' + name);
    order.push({ name, start: idx });
  }
  order.sort((a, b) => a.start - b.start);
  const out = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < order.length; i++) {
    const { name, start } = order[i];
    const contentStart = start + name.length + 1;
    const end = i + 1 < order.length ? order[i + 1].start : data.length;
    const content = data.subarray(contentStart, end);
    const target = pathJoin(outDir, name);
    fs.writeFileSync(target, content);
    out.push(target);
  }
  return out;
}

function pathJoin(...parts) {
  return parts.join('/').replace(/\\/g, '/');
}

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '.';
}

// Runtime-parity checks: the bundle must not reference the $bunfs virtual
// filesystem or the busybox dispatch in ways that break under plain bun.
function assertParity(out, nativesDir) {
  const t = out.toString('latin1');
  const refs = t.match(/["'\x27]\/\$bunfs\/root\/[^"'\x27]+["'\x27]/g) || [];
  if (refs.length > 0) throw new Error('parity: unresolved $bunfs path literals: ' + refs.join(', '));
  if (nativesDir) {
    const missing = BUNFS_FILES.filter((f) => !fs.existsSync(pathJoin(nativesDir, f)));
    if (missing.length > 0) throw new Error('parity: missing natives: ' + missing.join(', '));
  }
}

// In-place patch of the native binary: replace the embedded bundle with the
// patched one. The bundle grows by ~1KB, so the embedded $bunfs filesystem
// (found by magic scan) shifts — the Mach-O sections all precede the bundle,
// so the layout stays valid. The binary keeps its native behavior: the
// embedded filesystem, the grep/find busybox dispatch, and
// Bun.isStandaloneExecutable all work as stock.
export function patchBinary(binPath, outPath, providers = DEFAULT_PROVIDERS, models = null, extraPatcher = null) {
  const data = fs.readFileSync(binPath);
  const banner = Buffer.from('// @bun @bytecode @bun-cjs\n(function(exports, require, module, __filename, __dirname)');
  const bunfs = Buffer.from('\x00/$bunfs/root/');
  let best = null, bestEnd = -1;
  for (let s = data.indexOf(banner); s >= 0; s = data.indexOf(banner, s + 1)) {
    const endMark = data.indexOf(bunfs, s);
    if (endMark < 0) continue;
    const candidate = data.slice(s, endMark);
    if (BUILD_REQ_RE.test(candidate) && (!best || candidate.length > best.length)) { best = candidate; bestEnd = endMark; }
  }
  if (!best) throw new Error('native binary: bundle not found');
  const span = bestEnd - best.length;
  const { out, patched } = patch(best, providers, models); // plain-bun splices skipped: native runtime
  if (!patched) throw new Error('already patched');
  const final = extraPatcher ? extraPatcher(out).out : out;
  const patchedBin = Buffer.concat([data.subarray(0, span), final, data.subarray(bestEnd)]);
  fs.writeFileSync(outPath, patchedBin);
  return patchedBin;
}

function buildInjected(providers, models, param, baseVar, authHelper) {
  const def = JSON.stringify(providers).replace(/'/g, "\\'");
  const key = '(process.env[$x.apiKeyEnv||""]||"")';
  return {
    def, models: models.join(','),
    // after the destructure statement (Pattern A): route + stamp + reassign base
    routeA:
      MARK + 'let $m=typeof ' + param + '.body?.model==="string"?' + param + '.body.model:"";' +
      'if($m){const $p=JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\');' +
      'for(const $x of $p){if($m.indexOf($x.prefix)===0){' +
      'let $h=' + param + '.headers;if($h){' +
      'if($h instanceof Headers)$h.set("Authorization","Bearer "+' + key + ');' +
      'else if($h.values instanceof Headers){$h.values.set("Authorization","Bearer "+' + key + ');$h.nulls.add("x-api-key")}' +
      'else $h.Authorization="Bearer "+' + key + '}' +
      'if($x.baseUrl)' + baseVar + '=$x.baseUrl;break}}}',
    // right after the function opening brace (Pattern B): route flag + header stamp
    routeB:
      MARK + 'let $m=typeof ' + param + '.body?.model==="string"?' + param + '.body.model:"";' +
      'if($m){const $p=JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\');' +
      'for(const $x of $p){if($m.indexOf($x.prefix)===0){' +
      'let $h=' + param + '.headers;if($h){' +
      'if($h instanceof Headers)$h.set("Authorization","Bearer "+' + key + ');' +
      'else if($h.values instanceof Headers){$h.values.set("Authorization","Bearer "+' + key + ');$h.nulls.add("x-api-key")}' +
      'else $h.Authorization="Bearer "+' + key + '}break}}}',
    // inline buildURL third-arg rewrite (Pattern B)
    urlArg:
      '(()=>{const $p=JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\');' +
      'const $x=$p.find($q=>$m.indexOf($q.prefix)===0);return $x&&$x.baseUrl?$x.baseUrl:$0})()',
    // authHeaders early return
    auth:
      'let $m=typeof ' + param + '?.body?.model==="string"?' + param + '.body.model:"";' +
      'if($m){const $p=JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\');' +
      'for(const $x of $p){if($m.indexOf($x.prefix)===0)' +
      'return ' + authHelper + '([{Authorization:"Bearer "+' + key + '}])}}',
    // resolver tail
    resolver:
      'default:return JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\').some($q=>e.indexOf($q.prefix)===0)?e:null}',
    // resolver tail (2.1.88 shape)
    resolver288:
      'default:return JSON.parse(process.env.CC_PROVIDERS||\'' + def + '\').some($q=>q.indexOf($q.prefix)===0)?q:null}',
    // schema enum: keep the base list and helper as found, append extras
    enumFor: (base, helper) =>
      'model:' + helper + '.enum([' + base.slice(1, -1) + ',...(process.env.CC_EXTRA_MODELS||\'' + models.join(',') + '\').split(",")]).optional().describe(',
  };
}

export function patch(bundle, providers = DEFAULT_PROVIDERS, models = null, nativesDir = null, claudeBin = null) {
  if (bundle.includes(MARK)) return { out: bundle, patched: false };
  // derive the model list from the FULL provider config before stripping
  if (!models) models = providers.flatMap(p => (p.models || []).map(m => typeof m === 'string' ? m : m.name));
  providers = providers.map(p => ({ prefix: p.prefix, baseUrl: p.baseUrl, apiKeyEnv: p.apiKeyEnv }));

  const text = bundle.toString('latin1');

  const br = BUILD_REQ_RE.exec(text);
  if (!br) throw new Error('buildRequest anchor not found — version mismatch?');
  const [brFull, param, , baseVar] = br;
  const brEnd = text.indexOf(';', br.index + brFull.length);
  if (brEnd < 0 || brEnd - br.index > 300) throw new Error('buildRequest statement terminator not found');

  let authMatch = null;
  for (let m; (m = AUTH_RE.exec(text)) !== null;) {
    if (m.index > br.index) break;
    authMatch = m;
    AUTH_RE.lastIndex = m.index + 1;
  }
  if (!authMatch) throw new Error('authHeaders anchor not found — version mismatch?');
  const authHelper = authMatch[1];
  const authInsertPos = authMatch.index + authMatch[0].indexOf('{') + 1;

  if (!ENUM_RE.test(text)) throw new Error('Agent-tool schema enum not found — version mismatch?');
  const resolverTail = text.indexOf(RESOLVER_TAIL) >= 0 ? RESOLVER_TAIL : text.indexOf(RESOLVER_TAIL_288) >= 0 ? RESOLVER_TAIL_288 : null;
  if (!resolverTail) throw new Error('alias resolver tail not found — version mismatch?');

  const gateMatch = GATE_RE.exec(text);

  const inj = buildInjected(providers, models, param, baseVar, authHelper);
  let out = text;

  const stmtTail = text.slice(br.index + br[0].length, brEnd);
  if (stmtTail.includes('this.buildURL(')) {
    // Pattern B: rewrite the inline call's third arg
    const callRe = /this\.buildURL\(([^)]*)\)/;
    const call = callRe.exec(stmtTail);
    if (!call) throw new Error('inline buildURL call not found');
    const args = call[1].split(',').map(s => s.trim());
    if (args.length < 3) throw new Error('inline buildURL call has unexpected args');
    const newCall = 'this.buildURL(' + args[0] + ',' + args[1] + ',(' + inj.urlArg.replace('$0', args[2]) + '))';
    const callAbs = br.index + br[0].length + call.index;
    out = out.slice(0, callAbs) + newCall + out.slice(callAbs + call[0].length);
    const openBrace = br.index + br[0].lastIndexOf(')') + 2;
    out = out.slice(0, openBrace) + inj.routeB + out.slice(openBrace);
  } else {
    // Pattern A: set the destructured base URL var after the let statement
    out = out.slice(0, brEnd + 1) + inj.routeA + out.slice(brEnd + 1);
  }

  if (gateMatch) {
    const gateNew = 'let ' + gateMatch[1] + '=' + gateMatch[3] + '||this.baseURL';
    out = out.slice(0, gateMatch.index) + gateNew + out.slice(gateMatch.index + gateMatch[0].length);
  }

  out = out.slice(0, authInsertPos) + inj.auth + out.slice(authInsertPos);

  for (const [anchor, repl] of [[resolverTail, resolverTail === RESOLVER_TAIL_288 ? inj.resolver288 : inj.resolver]]) {
    const pos = out.indexOf(anchor);
    if (pos < 0) throw new Error('anchor lost during patch');
    out = out.slice(0, pos) + repl + out.slice(pos + anchor.length);
  }
  const em = ENUM_RE.exec(out);
  if (!em) throw new Error('schema enum anchor lost during patch');
  out = out.slice(0, em.index) + inj.enumFor(em[2], em[1]) + out.slice(em.index + em[0].length);

  if (!out.includes(MARK)) throw new Error('routing snippet missing after patch');
  if (!out.includes('CC_PROVIDERS')) throw new Error('provider routing missing after patch');
  if (gateMatch && GATE_RE.test(out)) throw new Error('original buildURL gate still present');

  // $bunfs virtual filesystem: it only exists inside the original binary.
  // When running the bundle under plain bun, every runtime-loaded file is
  // read from the extracted natives/ directory instead (requires for the
  // native addons, readFile for the artifact JS bundles).
  if (nativesDir) {
    const base = 'process.env.CC_NATIVES_DIR||' + JSON.stringify(nativesDir);
    for (const name of BUNFS_FILES) {
      const node = name.endsWith('.node');
      const from = node
        ? 'require("/$bunfs/root/' + name + '")'
        : '"/$bunfs/root/' + name + '"';
      if (!out.includes(from)) throw new Error('bunfs reference not found: ' + name);
      const to = node
        ? 'require(' + base + '+"/' + name + '")'
        : '(' + base + ')+"/' + name + '"';
      out = out.split(from).join(to);
    }
  }

  // busybox dispatch: CC sets CLAUDE_CODE_EXECPATH = process.execPath, which
  // is bun when the bundle runs under plain bun; the grep/find/rg shell
  // functions then exec bun with ugrep-style flags. Point it at a real claude
  // binary (baked from the input, or CC_CLAUDE_BIN; empty -> snapshot fallback).
  const execAnchor = 'c[yCs]=process.execPath';
  if (!out.includes(execAnchor)) throw new Error('execpath override anchor not found — version mismatch?');
  const execRepl = 'c[yCs]=process.env.CC_CLAUDE_BIN||' + JSON.stringify(claudeBin || '');
  out = out.split(execAnchor).join(execRepl);

  return { out: Buffer.from(out, 'latin1'), patched: true };
}

function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--providers');
  const inPlace = args.includes('--in-place');
  const [inPath, outPath] = args.filter((a, i) => a !== '--providers' && a !== '--in-place' && args[i - 1] !== '--providers');
  if (!inPath || !outPath) {
    console.error('usage: node patch.mjs <input> <output> [--providers <file.json>] [--in-place]');
    process.exit(1);
  }
  let providers = DEFAULT_PROVIDERS;
  let models = DEFAULT_MODELS;
  if (pi >= 0 && args[pi + 1]) {
    const cfg = JSON.parse(fs.readFileSync(args[pi + 1], 'utf8'));
    providers = cfg.providers || cfg;
    models = providers.flatMap(p => (p.models || []).map(m => typeof m === 'string' ? m : m.name));
    providers = providers.map(p => ({ prefix: p.prefix, baseUrl: p.baseUrl, apiKeyEnv: p.apiKeyEnv }));
  }

  if (inPlace) {
    // native-binary mode: keep the embedded filesystem and the binary's own
    // dispatch (grep/find busybox, Bun.isStandaloneExecutable) intact
    patchBinary(inPath, outPath, providers, models);
    console.log(`patched in place: ${inPath} -> ${outPath}`);
    const bun = findBun();
    if (!bun) return;
    try {
      const ver = execFileSync(outPath, ['--version'], { stdio: 'pipe' }).toString().trim();
      console.log(`boot ok: ${ver}`);
    } catch (e) { console.warn('WARNING: boot check failed: ' + e.message); }
    return;
  }
  const { bundle, bunfsStart } = extractBundle(inPath);
  const nativesDir = bunfsStart >= 0 ? pathJoin(dirname(outPath), 'natives') : null;
  const claudeBin = bunfsStart >= 0 ? inPath : null;
  const { out, patched } = patch(bundle, providers, models, nativesDir, claudeBin);
  fs.writeFileSync(outPath, out);
  console.log(`${patched ? 'patched' : 'unchanged (already patched)'}: ${bundle.length} -> ${out.length} bytes -> ${outPath}`);
  if (nativesDir && patched) {
    const natives = extractNatives(inPath, nativesDir);
    console.log(`natives: extracted ${natives.length} files -> ${nativesDir}`);
  }
  assertParity(out, nativesDir);

  const bun = findBun();
  if (!bun) { console.warn('WARNING: bun not found — skipping verification'); return; }
  try {
    execFileSync(bun, ['build', outPath, '--no-bundle', '--outfile=/dev/null'], { stdio: 'pipe' });
    console.log('parse ok');
  } catch {
    fs.unlinkSync(outPath);
    throw new Error('VERIFY FAILED: patched bundle does not parse — output removed');
  }
  try {
    const ver = execFileSync(bun, [outPath, '--version'], { stdio: 'pipe' }).toString().trim();
    console.log(`boot ok: ${ver}`);
  } catch (e) {
    console.warn('WARNING: boot check failed: ' + e.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
