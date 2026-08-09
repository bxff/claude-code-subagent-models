# claude-code-subagent-models

```bash
npm i -g claude-code-subagent-models
ccr --key sk-... # first time: saves your DeepSeek key, then patches and runs
ccr              # every time after
```

Adds third-party models to Claude Code as subagents. Model names matching a configured provider prefix are routed to that provider's Anthropic-compatible endpoint, per request. No proxy, no extra login: the subscription token stays in the official client. Zero config: `deepseek-*` routes to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

`ccr` finds your Claude Code binary, patches it, and starts it; re-run it after each Claude Code update. The patched bundle lands in `~/.cache/claude-code-subagent-models/claude-patched.js`, with the embedded native addons extracted next to it so it runs under plain Bun. Each run also makes sure telemetry is off in `~/.claude/settings.json` (skip with `--no-settings`).

Other forms: `ccr --key sk-...` (first-time setup: saves your DeepSeek key to `~/.claude/settings.json`, then patches and runs), `ccr --no-run` (patch only), `ccr /path/to/claude claude-patched.js` (explicit paths), `npx claude-code-subagent-models` (no install at all). Any flag `ccr` does not recognize is passed to the patched claude: `ccr --resume <uuid>`.

Read more: [DeepSeek subagents in Claude Code on a Max plan, without a proxy](https://musaab.io/posts/2026/deepseek-subagents-claude-code)

The task-list QoL additions (pinning, detaching, retention) are personal tooling in [my-cc-config](https://github.com/bxff/my-cc-config).

## Config

Zero config: `deepseek-*` routes to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

Any number of providers is supported. `CC_PROVIDERS` is an array, one entry per provider:

```json
[
  { "prefix": "deepseek", "baseUrl": "https://api.deepseek.com/anthropic", "apiKeyEnv": "CC_DEEPSEEK_API_KEY" },
  { "prefix": "glm",      "baseUrl": "https://api.z.ai/api/anthropic",      "apiKeyEnv": "CC_ZAI_API_KEY" }
]
```

Set it as a single-line JSON string in `~/.claude/settings.json`, and list the models the Agent tool should offer in `CC_EXTRA_MODELS`. Put the provider keys in the same `env` block (or run `ccr --key sk-...` to save the DeepSeek key there for you): Claude Code loads it into the process at startup, so `ccr` works with nothing else set up. Without a key, `ccr` prints a hint pointing at `--key`.

```json
{
  "env": {
    "CC_DEEPSEEK_API_KEY": "sk-...",
    "CC_ZAI_API_KEY": "zai-...",
    "CC_PROVIDERS": "[{\"prefix\":\"deepseek\",\"baseUrl\":\"https://api.deepseek.com/anthropic\",\"apiKeyEnv\":\"CC_DEEPSEEK_API_KEY\"},{\"prefix\":\"glm\",\"baseUrl\":\"https://api.z.ai/api/anthropic\",\"apiKeyEnv\":\"CC_ZAI_API_KEY\"}]",
    "CC_EXTRA_MODELS": "deepseek-v4-flash,glm-5.2,glm-4.7"
  }
}
```

Any Anthropic-compatible endpoint works. Every model in `CC_EXTRA_MODELS` is selectable per subagent.

Add a `/model` picker entry for the primary model with the official custom-model vars:

```json
{
  "env": {
    "ANTHROPIC_CUSTOM_MODEL_OPTION": "deepseek-v4-flash",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "DeepSeek V4 Flash",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION": "Cheap and fast, routed to DeepSeek"
  }
}
```

Config changes are picked up at runtime, no re-patch needed.

## Limitations

Patches the local bundle: re-run the command after each Claude Code update. Your provider needs an Anthropic-compatible endpoint, and the patch fails loudly instead of breaking silently if an update renames something.

Modifying the official client is a gray area of Anthropic's terms. Enforcement so far has targeted relays and third-party harnesses, not local patches of the official binary, and there is no documented case of a ban for one as of August 2026. Use at your own risk.

[npm](https://www.npmjs.com/package/claude-code-subagent-models) · [GitHub](https://github.com/bxff/claude-code-subagent-models)
