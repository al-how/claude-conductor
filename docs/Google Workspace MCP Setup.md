# Google Workspace MCP Setup

This guide walks you through integrating the [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) server with Claude Conductor. Once configured, Claude will have access to Gmail, Calendar, Drive, Docs, and other Google Workspace tools directly via the MCP protocol.

## Prerequisites

- **Google account** with Google Workspace or personal Google account
- **Google Cloud Console** access
- **pip** and **Python 3.7+** on your host machine (for local OAuth token generation)
- **Docker** and the Claude Conductor container

## Step 1: Create Google Cloud Project and OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project:
   - Click **Select a Project** > **New Project**
   - Name: `Claude Conductor` (or your preference)
   - Click **Create**
3. Enable Gmail API (and other APIs as needed):
   - Go to **APIs & Services** > **Library**
   - Search for `Gmail API` and click **Enable**
   - (Optional) Also enable: Calendar API, Google Drive API, Google Docs API
4. Create OAuth 2.0 credentials:
   - Go to **APIs & Services** > **Credentials**
   - Click **+ Create Credentials** > **OAuth client ID**
   - If prompted, configure the OAuth consent screen first:
     - User Type: **External** (for personal accounts) or **Internal** (for Workspace)
     - Fill in app name: `Claude Conductor`
     - User support email: your email
     - Developer contact: your email
     - Click **Save and Continue** through the remaining screens
   - Back on the Credentials page, click **+ Create Credentials** > **OAuth client ID**
   - Application type: **Desktop application**
   - Name: `Claude Conductor`
   - Click **Create**
5. Copy the credentials:
   - A popup shows **Client ID** and **Client Secret**
   - Copy both values — you'll need them in the next step
6. **IMPORTANT:** Set project to Production (optional but recommended):
   - This prevents the 7-day test token expiry
   - Go to **APIs & Services** > **OAuth consent screen**
   - Click **Make it Public** (if appropriate for your use case)

## Step 2: Generate and Store OAuth Tokens

The `workspace-mcp` server needs authorization tokens. You'll generate these on your host machine and copy them into the project.

### On Your Host Machine

1. Install workspace-mcp:
   ```bash
   pip install workspace-mcp
   ```

2. Run the server to trigger OAuth authorization:
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="<your-client-id>"
   export GOOGLE_OAUTH_CLIENT_SECRET="<your-client-secret>"
   workspace-mcp --single-user
   ```

3. A browser window will open — authorize your Google account:
   - Click **Allow** when prompted
   - You should see a success message
   - The tokens are now saved to `~/.config/workspace-mcp/`

4. Copy the tokens to your project:
   ```bash
   # Navigate to your Claude Conductor project directory
   cp -r ~/.config/workspace-mcp/ ./google-workspace-tokens/
   ```

5. Verify the tokens exist:
   ```bash
   ls -la ./google-workspace-tokens/
   # Should show: secrets.json, tokens.json, etc.
   ```

**Note:** On Windows, `workspace-mcp` stores tokens at:
```
%APPDATA%\workspace-mcp\
# Usually: C:\Users\<username>\AppData\Roaming\workspace-mcp\
```

Copy this folder to `./google-workspace-tokens/` in your project.

## Step 3: Configure Environment Variables

Set these in your `.env` file (or however you manage docker-compose environment variables):

```bash
GOOGLE_OAUTH_CLIENT_ID="<your-client-id>"
GOOGLE_OAUTH_CLIENT_SECRET="<your-client-secret>"
USER_GOOGLE_EMAIL="your-email@gmail.com"
```

If you're using a `.env` file with `docker-compose`, make sure it's referenced:
```bash
docker-compose --env-file .env up -d
```

Or set them directly in `docker-compose.yml` (less secure, not recommended for production).

## Step 4: Enable in config.yaml

Edit your `config.yaml` and add (or uncomment) the `google_workspace` section:

```yaml
google_workspace:
  enabled: true
  tool_tier: core        # Options: core, extended, complete
  read_only: false       # Set to true to restrict to read-only scopes
  token_dir: /data/google-workspace-tokens
```

### Tool Tier Explanation

- **`core`** (recommended): Gmail, Calendar, Drive basics
- **`extended`**: Adds Docs, Sheets, Forms read access
- **`complete`**: Full access to all Google Workspace APIs

### Read-Only Mode

Set `read_only: true` to restrict Claude to read-only operations:
- Gmail: Read messages only (no send/delete)
- Drive: Read files only (no upload/delete)
- Calendar: Read events only (no create/modify)

## Step 5: Recreate the Container

```bash
docker-compose pull
docker-compose down
docker-compose up -d
```

The harness will register the MCP server at startup. Verify:

```bash
docker exec claude-conductor grep -A 5 '"google-workspace"' /home/claude/.claude.json
```

You should see the `google-workspace` entry with your tool tier and env vars.

## Step 6: Test the Integration

Send a message to your Telegram bot or test via Cron:

**Test via Telegram:**
```
List my recent Gmail messages
```

**Test via Cron (HTTP POST):**
```bash
curl -X POST http://localhost:3000/api/cron \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-gmail",
    "schedule": "*/5 * * * *",
    "prompt": "List my last 5 unread Gmail messages with subject lines",
    "output": "telegram"
  }'
```

If successful, Claude will read your Gmail and respond with recent messages.

## Troubleshooting

### Token Expired (7-day refresh)

If you see errors about token expiry after 7 days:
1. Delete `./google-workspace-tokens/`
2. Re-run the OAuth setup (Step 2)
3. Recreate the container

**Prevention:** Set your Google Cloud project to **Production** mode (see Step 1, note 6).

### "Permission denied" for specific APIs

Make sure those APIs are enabled in Google Cloud Console:
- Go to **APIs & Services** > **Library**
- Search for the API (e.g., "Google Drive API")
- Click **Enable**

### Container Can't Find workspace-mcp

Verify the install worked:
```bash
docker exec claude-conductor workspace-mcp --help
```

If it fails, the pip install didn't complete. Rebuild the image:
```bash
docker-compose build --no-cache
docker-compose up -d
```

### MCP Entry Not in .claude.json

Check the logs:
```bash
docker logs claude-conductor | grep -i "google workspace"
```

If you see a warning, verify:
1. `google_workspace.enabled: true` is set in `config.yaml`
2. Environment variables are set (check `docker inspect claude-conductor` under `Env`)
3. `/home/claude/.claude.json` file exists in the container

### OAuth Browser Window Doesn't Open (Headless Setup)

If running on a headless server without a browser:

1. Generate tokens on a machine with a browser (follow Step 2)
2. Copy the `google-workspace-tokens/` folder to your server
3. Set the env vars, enable in config.yaml, recreate the container

The server will use the pre-authorized tokens and won't require a browser.

## Disabling Google Workspace MCP

To disable without removing the code:

1. Edit `config.yaml`:
   ```yaml
   google_workspace:
     enabled: false
   ```

2. Restart the container:
   ```bash
   docker-compose restart
   ```

The MCP entry will be removed from `.claude.json` at startup, and Claude will no longer have access to Gmail/Calendar/Drive tools.

## Further Reading

- [workspace-mcp GitHub](https://github.com/taylorwilsdon/google_workspace_mcp) — full documentation and supported tools
- [Google Cloud Documentation](https://cloud.google.com/docs) — OAuth 2.0 flows, API scopes
- [Claude Code MCP Protocol](https://modelcontextprotocol.io/) — how Claude tools work

---

**Questions?** Check the container logs:
```bash
docker logs claude-conductor --follow | grep -i "google\|workspace\|mcp"
```
