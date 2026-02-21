# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-slim

RUN apt-get update && apt-get install -y ca-certificates curl git gnupg && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Remove default node user (UID 1000) and create claude user in its place
# so the installer puts the binary in /home/claude/.local/bin
RUN userdel -r node && useradd -m -u 1000 -s /bin/bash claude

# Copy built app and install production deps as root
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY public ./public
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Install Gemini CLI globally (as root, before user switch)
RUN npm install -g @google/gemini-cli

# Install Chromium, noVNC, and websockify for browser automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    novnc \
    websockify \
    xvfb \
    x11vnc \
    fluxbox \
    && rm -rf /var/lib/apt/lists/*

# Symlink system Chromium to the path Playwright's 'chrome' distribution expects
RUN mkdir -p /opt/google/chrome && ln -s /usr/bin/chromium /opt/google/chrome/chrome

# Install Playwright CLI globally and download its bundled Chromium to a shared location
# PLAYWRIGHT_BROWSERS_PATH must be set before install so the browser lands in a path
# accessible to the claude user at runtime (default /root/.cache is not accessible)
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm install -g @playwright/cli@latest
RUN npx playwright install chromium --with-deps && chmod -R 755 /opt/playwright-browsers

# Volume mount points — create and chown as root
RUN mkdir -p /vault /config /data /data/browser-profile /data/screenshots /home/claude/.claude && \
    chown -R claude:claude /vault /config /data /home/claude /app

COPY scripts /app/scripts
RUN chmod +x /app/scripts/*.sh

# Switch to claude user, then install Claude CLI natively
# This ensures the binary lands in /home/claude/.local/bin
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash

ARG GIT_SHA=unknown
ARG VERSION=0.0.0

ENV PATH="/home/claude/.local/bin:$PATH" \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/config/config.yaml \
    LOG_LEVEL=info \
    TELEGRAM_FILES_DIR=/data/telegram-files \
    DISPLAY=:99 \
    GIT_SHA=$GIT_SHA \
    VERSION=$VERSION

EXPOSE 3000 6080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["/app/scripts/entrypoint.sh"]
