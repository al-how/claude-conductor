#!/bin/bash
set -e

# Install n8n-skills if not already present
N8N_SKILLS_DIR="/home/claude/.claude/skills/n8n-skills"
if [ ! -d "$N8N_SKILLS_DIR" ]; then
    echo "Installing n8n-skills..."
    mkdir -p /home/claude/.claude/skills
    if git clone --depth=1 --quiet https://github.com/czlonkowski/n8n-skills.git /tmp/n8n-skills 2>/dev/null; then
        cp -r /tmp/n8n-skills/skills/* /home/claude/.claude/skills/
        rm -rf /tmp/n8n-skills
        echo "n8n-skills installed."
    else
        echo "Warning: Failed to install n8n-skills (network unavailable?) — skipping"
    fi
fi

# Start noVNC if browser is enabled (check if BROWSER_ENABLED env var is set)
if [ "$BROWSER_ENABLED" = "true" ]; then
    echo "Starting noVNC for browser automation..."
    /app/scripts/start-vnc.sh &
fi

# Start the main application
exec node dist/main.js
