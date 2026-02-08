Openclaw uses an agent sdk called Pi to wrap around claude's sessions. We're using the regular Claude CLI. The benefit of this is simplicity; the cons are that i can't stop a run or fork a conversation

## Phase 3: Cron Scheduler

### 1. Dynamic-only cron jobs
- **Decision**: All cron jobs are stored in the SQLite database and managed via API, creating a "dynamic-only" system. Used to support both user and system defined jobs.
- **Alternatives**: 
    - Static config in `config.yaml`.
    - Hybrid approach (static + dynamic).
- **Rationale**: Claude Code needs to be able to create its own scheduled tasks at runtime without restarting the container or modifying configuration files. Static config would require container restarts.

### 2. HTTP API for job management
- **Decision**: Expose REST endpoints at `/api/cron` for job CRUD operations. Claude Code uses `curl` via its Bash tool to interact with these endpoints.
- **Alternatives**:
    - Custom MCP tool server.
    - `WebFetch` tool against internal API.
    - Direct SQLite access from Claude Code.
- **Rationale**: Reuses existing Fastify infrastructure. Keeps concerns separated (Harness manages DB, Claude Code is just a client). `curl` is a reliable, standard tool available in the environment.

### 3. `croner` library
- **Decision**: Use `croner` for scheduling.
- **Alternatives**: `node-cron`, `cron`, `bree`.
- **Rationale**: `croner` is a modern, dependency-free, TypeScript-native library with support for standard cron expressions and in-memory scheduling, which fits our node.js architecture well.

### 4. Telegram output prefixed with job name
- **Decision**: Output from cron jobs sent to Telegram is prefixed with `[job-name]`.
- **Alternative**: Raw output.
- **Rationale**: Since multiple jobs might run or output asynchronously, the user needs context to know which scheduled task generated the message.

### 5. Telegram sessions use `--dangerously-skip-permissions`
- **Decision**: Interactive Telegram sessions invoke Claude Code with `--dangerously-skip-permissions`, granting full tool access including Bash.
- **Alternatives**:
    - Restrictive `--allowedTools` whitelist for Telegram sessions.
    - File-based API instead of HTTP + curl.
- **Rationale**: Claude Code needs Bash access to run `curl` against the harness API (e.g., to create cron jobs). Interactive Telegram sessions are user-initiated and gated by the `allowed_users` allowlist, providing sufficient auth. Cron jobs remain read-only with a restricted tool set.

## General Architecture

### 1. Config Loading Strategy
- **Decision**: The configuration loader implements a fallback strategy: `argument` -> `CONFIG_PATH env var` -> `./config.local.yaml` -> `./config.yaml` -> `/config/config.yaml`.
- **Alternatives**: strictly enforce `/config/config.yaml` or rely solely on environment variables.
- **Rationale**: This allows easy local development (using `config.local.yaml` which is gitignored) without complex environment setup, while preserving the Docker-native path `/config/config.yaml` as the default for procudtion/container environments.
