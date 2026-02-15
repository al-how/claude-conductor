# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-slim

RUN apt-get update && apt-get install -y ca-certificates curl git && rm -rf /var/lib/apt/lists/*

# Remove default node user (UID 1000) and create claude user in its place
# so the installer puts the binary in /home/claude/.local/bin
RUN userdel -r node && useradd -m -u 1000 -s /bin/bash claude

# Copy built app and install production deps as root
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Volume mount points — create and chown as root
RUN mkdir -p /vault /config /data /home/claude/.claude && \
    chown -R claude:claude /vault /config /data /home/claude /app

# Switch to claude user, then install Claude CLI natively
# This ensures the binary lands in /home/claude/.local/bin
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash

ARG GIT_SHA=unknown

ENV PATH="/home/claude/.local/bin:$PATH" \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/config/config.yaml \
    LOG_LEVEL=info \
    TELEGRAM_FILES_DIR=/data/telegram-files \
    GIT_SHA=$GIT_SHA

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
