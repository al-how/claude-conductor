#!/bin/bash
set -e

# Start noVNC if browser is enabled (check if BROWSER_ENABLED env var is set)
if [ "$BROWSER_ENABLED" = "true" ]; then
    echo "Starting noVNC for browser automation..."
    /app/scripts/start-vnc.sh &
fi

# Start the main application
exec node dist/main.js
