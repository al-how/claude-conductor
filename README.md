# Claude Conductor

## Provider Switching (Telegram)

Use these commands in Telegram:

- Switch back to Claude: `/provider claude`
- Clear sticky provider override (use configured default): `/provider reset` or `/provider default`
- Clear sticky model override: `/model reset`

## OpenRouter Notes

OpenRouter manual switching is implemented in the OpenRouter feature worktree/branch.

- Worktree path: `c:\Users\alexn\Documents\Projects\claude-conductor\.worktrees\openrouter`
- Branch: `feature/openrouter-manual-switching`

In that worktree, OpenRouter switching is exposed through `/provider openrouter` and provider-aware model selection.
