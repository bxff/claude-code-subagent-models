# claude-code-subagent-models

```bash
npx claude-code-subagent-models
```

Finds your Claude Code binary, patches it, and starts it. The patched bundle lands in `~/.cache/claude-code-subagent-models/claude-patched.js`; re-run the same command after each Claude Code update.

The binary is found via `CC_CLAUDE_BIN`, then `command -v claude`, then the usual install locations. Symlinks are resolved. Everything after `--` is passed to the patched claude:

```bash
npx claude-code-subagent-models -- --resume <uuid>
```

Patch only, no run, and explicit paths:

```bash
npx claude-code-subagent-models --no-run
npx claude-code-subagent-models /path/to/claude claude-patched.js
bun claude-patched.js
```

Global install gives you the short alias:

```bash
npm i -g claude-code-subagent-models
ccr          # Claude Code Router
```

Adds third-party models to Claude Code as subagents. Model names matching a configured provider prefix are routed to that provider's Anthropic-compatible endpoint, per request. No proxy, no extra login: the subscription token stays in the official client. Zero config: `deepseek-*` routes to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

When the input is the native binary, the embedded native addons (image processing, audio capture, computer use, URL handling) are extracted to a `natives/` directory next to the output, so the patched bundle runs under plain Bun with those features intact.

Read more: [DeepSeek subagents in Claude Code on a Max plan, without a proxy](https://musaab.io/posts/2026/deepseek-subagents-claude-code)

## Config

Zero config: `deepseek-*` routes to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

Any number of providers is supported. `CC_PROVIDERS` is an array, one entry per provider:

```json
[
  { "prefix": "deepseek", "baseUrl": "https://api.deepseek.com/anthropic", "apiKeyEnv": "CC_DEEPSEEK_API_KEY" },
  { "prefix": "glm",      "baseUrl": "https://api.z.ai/api/anthropic",      "apiKeyEnv": "CC_ZAI_API_KEY" }
]
```

Set it as a single-line JSON string in `~/.claude/settings.json`, and list the models the Agent tool should offer in `CC_EXTRA_MODELS`. Put the provider keys in the same `env` block: Claude Code loads it into the process at startup, so the one-liner works with nothing else set up.

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

[npm](https://www.npmjs.com/package/claude-code-subagent-models) · [GitHub](https://github.com/bxff/claude-code-subagent-models)
