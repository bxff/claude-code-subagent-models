# claude-code-subagent-models

Add third-party models to Claude Code. Model names matching a configured provider prefix are routed to that provider's Anthropic-compatible endpoint, per request. No proxy, no extra login: the subscription token stays in the official client.

```bash
npx claude-code-subagent-models /path/to/claude claude-patched.js
bun claude-patched.js
```

Zero config: `deepseek-*` models route to DeepSeek with the key from `CC_DEEPSEEK_API_KEY`.

## Config

Providers are a JSON array in the `CC_PROVIDERS` env var, set in `~/.claude/settings.json`:

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

## How it works

`patch.mjs` splices the request layer of the bundle: the request assembler, the auth helper, the subagent model list, and the alias resolver. Anchors are structural regexes over stable tokens, and minified identifiers are captured from the bundle at patch time, so the patch survives renames across versions (verified on 2.1.88 and 2.1.220). It accepts the native binary or an extracted bundle, is idempotent, and verifies the output with a parse check and a boot check.

[npm](https://www.npmjs.com/package/claude-code-subagent-models) · [GitHub](https://github.com/bxff/claude-code-subagent-models)
