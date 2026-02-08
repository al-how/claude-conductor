# Cron Scheduler Verification Guide

This guide describes how to manually verify the Cron Scheduler functionality in Claude Conductor.

## Prerequisites
- Node.js 20+
- Terminal with `curl` support (Git Bash, WSL, or PowerShell with curl alias)

## Steps

### 1. Start the Application
Open a terminal and run:
```bash
npm run dev
```
Wait for the message "Server listening".

### 2. Create a Scheduled Task
Open a second terminal and run this command to create a job that runs every minute:

```bash
curl -X POST http://localhost:3000/api/cron \
  -H "Content-Type: application/json" \
  -d '{"name": "test-job", "schedule": "* * * * *", "prompt": "echo hello", "output": "log"}'
```

**Expected Output:**
```json
{"job":{"name":"test-job","schedule":"* * * * *","prompt":"echo hello","output":"log","enabled":1,...}}
```

### 3. Verify Job Execution
Wait for the next minute (e.g., if it's 14:05:30, wait until 14:06:00).
Check the application logs in the first terminal. You should see:
```text
INFO (claude-harness): Executing cron job { name: 'test-job' }
...
```

### 4. Check Execution History via DB (Optional)
You can inspect the SQLite database directly if you have `sqlite3` installed:
```bash
sqlite3 data/harness.db "SELECT * FROM cron_executions ORDER BY id DESC LIMIT 1;"
```

### 5. Delete the Job
Cleanup the test job:
```bash
curl -X DELETE http://localhost:3000/api/cron/test-job
```

## Troubleshooting
- If `npm run dev` fails, ensure dependency installation was successful (`npm install`).
- If `curl` fails, ensure the server is running on port 3000.
