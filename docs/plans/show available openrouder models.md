---
Plan: Show Available OpenRouter Models in /model
Goal: When /model is run with no arguments and the effective provider is OpenRouter, show the list of allowed models from openrouter.allowed_models so users know what they can switch to.
Scope: Telegram /model command only. No config changes, no new DB fields.
---
Task 1: Expand /model => no-args output
src/telegram/bot.ts:161-171
Current behavior when no args:
Current model: sonnet
New behavior for OpenRouter:
Current model: qwen/qwen3-coder
Provider: openrouter
Available models: qwen/qwen3-coder, google/gemini-2.0-flash-001, meta-llama/llama-4-scout
New behavior for Ollama:
Current model: qwen3-coder
Provider: ollama
Available models: qwen3-coder, llama3.3
Claude provider stays unchanged:
Current model: opus
Provider: claude
Implementation: after determining effectiveProvider (already done on line 187), append the allowlist when effectiveProvider === 'openrouter' and the config exists, or effectiveProvider === 'ollama' and the config exists.
---
Task 2: Add integration setMyCommands + Expand /help
src/telegram/bot.ts
Register Telegram native slash-command menu on startup:
await this.bot.api.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show commands and examples' },
  { command: 'session', description: 'Show current Claude session' },
  { command: 'clear', description: 'Clear conversation and session' },
  { command: 'model', description: 'Show or set model/alias' },
  { command: 'provider', description: 'Show or set AI provider' },
]);
Expand /help from the current one-liner to include usage and examples:
Commands:
/start - Start the bot
/help - Show this message
/session - Show current Claude session UUID and resume commands
/clear - Clear conversation and start a new session
/model - Show or set the model
Usage:
  /model — show current model (and available models for current provider)
  /model <alias-or-model-id> — set model (aliases: sonnet, opus, haiku for Claude)
  /model reset — reset to default
  /model <alias> <prompt> — one-time override with specific model
Examples: /model sonnet, /model haiku summarize today, /model reset
/provider - Show or set the AI provider
Usage:
  /provider — show current provider
  /provider <claude|openrouter|ollama> — set provider
  /provider reset — reset to default
  /provider <provider> <prompt> — one-time override with specific provider
Examples: /provider openrouter, /provider claude
---
## Task 3: Update tests
`tests/telegram/bot.test.ts`
- Add test: `/model` with OpenRouter provider shows allowed models.
- Add test: `/model` with Ollama provider shows allowed models.
- Add test: `/model` with Claude provider does not show allowed models list.
- Update existing `/help` test to match new expanded text.
- Add test: `setMyCommands` is called on bot start with the expected command list.
---
Task 4: Bump version and build
- package.json: bump version.
- package-lock.json: bump version.
- Run npm test.
- Run npm run build.
---