# claude-code-subagent-models

```bash
npx claude-code-subagent-models /path/to/claude claude-patched.js
bun claude-patched.js
```

Adds third-party models to Claude Code as subagents. Model names matching a configured provider prefix are routed to that provider's Anthropic-compatible endpoint, per request. No proxy, no extra login: the subscription token stays in the official client. Zero config: `deepseek-*` routes to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

## Config

Providers are a JSON array in `CC_PROVIDERS`, set in `~/.claude/settings.json`:

```json
{
  "env": {
    "CC_PROVIDERS": "[{\"prefix\":\"deepseek\",\"baseUrl\":\"https://api.deepseek.com/anthropic\",\"apiKeyEnv\":\"CC_DEEPSEEK_API_KEY\"}]",
    "CC_EXTRA_MODELS": "deepseek-v4-flash"
  }
}
```

`CC_EXTRA_MODELS` is the comma-separated model list exposed to the Agent tool. Add a `/model` picker entry with the official custom-model vars:

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

Read more: [DeepSeek subagents in Claude Code on a Max plan, without a proxy](https://musaab.io/posts/2026/deepseek-subagents-claude-code)

[npm](https://www.npmjs.com/package/claude-code-subagent-models) · [GitHub](https://github.com/bxff/claude-code-subagent-models)
