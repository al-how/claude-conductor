#!/usr/bin/env bash
# claude-tg — resume the most recently updated Telegram session from the conductor DB.
#
# Usage (inside the container):
#   claude-tg                  # resume the newest session (single-chat common case)
#   claude-tg <chat_id>        # resume the session for a specific Telegram chat_id
#
# Reads the Telegram chat's persisted Claude session UUID straight from
# the harness DB and runs `claude --resume <uuid>` so manual CLI work
# stays aligned with the bot's session tracking.
#
# When the chat uses a non-default provider (openrouter/ollama), the script
# injects the provider env vars (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
# so the session UUID can be resolved on the correct API endpoint.
set -euo pipefail

DB_PATH="${DB_PATH:-/data/harness.db}"
PROVIDER_ENV_FILE="/data/provider-env.json"

if [ ! -f "$DB_PATH" ]; then
    echo "claude-tg: database not found at $DB_PATH" >&2
    exit 1
fi

# Resolve chat_id and session UUID
if [ "$#" -ge 1 ] && [[ "$1" =~ ^-?[0-9]+$ ]]; then
    CHAT_ID="$1"
    shift
    SESSION_ID=$(sqlite3 "$DB_PATH" \
        "SELECT session_id FROM claude_sessions WHERE chat_id = $CHAT_ID;")
    if [ -z "$SESSION_ID" ]; then
        echo "claude-tg: no session found for chat_id $CHAT_ID" >&2
        exit 1
    fi
else
    SESSION_ID=$(sqlite3 "$DB_PATH" \
        "SELECT session_id FROM claude_sessions ORDER BY updated_at DESC LIMIT 1;")
    if [ -z "$SESSION_ID" ]; then
        echo "claude-tg: no Telegram sessions found in $DB_PATH" >&2
        exit 1
    fi
    CHAT_ID=""
fi

# If we have a chat_id, check for non-default provider and inject env vars
if [ -n "$CHAT_ID" ] && [ -f "$PROVIDER_ENV_FILE" ]; then
    PROVIDER=$(sqlite3 "$DB_PATH" \
        "SELECT provider FROM chat_settings WHERE chat_id = $CHAT_ID;" 2>/dev/null || echo "")
    if [ "$PROVIDER" = "openrouter" ] || [ "$PROVIDER" = "ollama" ]; then
        TMP_ENV="$(mktemp)"
        if python3 -c "
import json, sys
try:
    cfg = json.load(open('$PROVIDER_ENV_FILE'))
    env = cfg.get('$PROVIDER', {})
    for k, v in env.items():
        print(f'{k}={v}')
except Exception as e:
    sys.stderr.write(f'claude-tg: failed to load provider env: {e}\n')
    sys.exit(1)
" > "$TMP_ENV" 2>&2; then
            set -a
            # shellcheck disable=SC1090
            . "$TMP_ENV"
            set +a
        fi
        rm -f "$TMP_ENV"
    fi
fi

cd /vault
exec claude --resume "$SESSION_ID" "$@"
