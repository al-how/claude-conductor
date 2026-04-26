#!/usr/bin/env bash
# claude-tg — resume the most recently updated Telegram session from the conductor DB.
#
# Usage (inside the container):
#   claude-tg                  # resume the newest session (single-chat common case)
#   claude-tg <chat_id>        # resume the session for a specific Telegram chat_id
#
# Works around the unreliable "most recent" pointer used by `claude --continue`
# and the interactive `/resume` picker by reading the UUID straight from
# the harness DB and passing it to `claude --resume <uuid>`.
set -euo pipefail

DB_PATH="${DB_PATH:-/data/harness.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "claude-tg: database not found at $DB_PATH" >&2
    exit 1
fi

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
fi

cd /vault
exec claude --resume "$SESSION_ID" "$@"
