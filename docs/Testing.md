# Testing Guide

This guide covers how to run automated tests and perform manual verification for Claude Conductor.

## Automated Tests

The project uses [Vitest](https://vitest.dev/) for unit and integration testing.

### Running All Tests
```bash
npm test
```

### Running Specific Tests
```bash
# Run only database tests
npx vitest tests/db

# Run only dispatcher tests
npx vitest tests/dispatcher

# Run only telegram tests
npx vitest tests/telegram
```

### Watch Mode
To run tests in watch mode during development:
```bash
npm run test:watch
```

## Manual Verification

To test the application end-to-end locally, you need to configure it and run it.

### 1. Prerequisites
- Node.js 20+
- A Telegram Bot Token (get one from [@BotFather](https://t.me/BotFather))
- (Optional) `claude` CLI installed and authenticated (`claude login`) if you want to test actual execution.

### 2. Configuration
Create a `config.local.yaml` (gitignored) or use a temporary config file.

**Example `config.local.yaml`:**
```yaml
telegram:
  bot_token: "YOUR_TELEGRAM_BOT_TOKEN"
  allowed_users: [YOUR_TELEGRAM_USER_ID]

queue:
  max_concurrent: 1
  timeout_seconds: 300
```
*Note: You can get your Telegram User ID by messaging [@userinfobot](https://t.me/userinfobot).*

### 3. Environment Setup
You can set environment variables to point to your local config and data paths.

```bash
# Windows PowerShell
$env:CONFIG_PATH = "config.local.yaml"
$env:DB_PATH = "data/harness.db"
$env:LOG_LEVEL = "debug"
```

### 4. Running the Harness
```bash
# Create data directory if it doesn't exist
mkdir data

# Run in development mode
npm run dev
```

### 5. Verification Steps
1.  **Start the Bot**: Send `/start` to your bot. It should reply "Welcome to Claude Conductor!".
2.  **Send a Message**: Send "Hello".
    -   **Logs**: Check the terminal. You should see "Received message", "Task enqueued", "Processing task".
    -   **Dispatcher**: The harness will try to spawn `claude`.
        -   *If `claude` is installed*: It will execute. Depending on your auth state, it might succeed or fail.
        -   *If `claude` is NOT installed*: You will see a "spawn claude ENOENT" error in the logs, and the bot might reply with an error message.
3.  **Database check**: Stop the server and check `data/harness.db` using a SQLite viewer to ensure your message was saved in the `conversations` table.

### 6. Mocking Claude (Optional)
If you don't want to invoke the real Claude CLI (which consumes tokens/money), you can create a dummy script in your path named `claude` or use unit tests which mock the invocation.

For manual testing without `claude` installed, expect to see errors in the logs, but the *flow* (Telegram -> DB -> Dispatcher -> Attempt) should work.
