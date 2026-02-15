# MCP Research Subagents — Design Document

**Date:** 2026-02-15
**Status:** Approved

## Problem

Claude Code sessions burn tokens reading and processing raw web content, URLs, and large text. When Claude uses WebSearch → WebFetch, full web pages (10k-50k+ tokens each) load into its context window. This wastes context capacity and increases session costs.

## Solution

Build an MCP server (`research`) that exposes research/summarization tools backed by cheaper LLMs. Claude calls these tools instead of its built-in equivalents — raw content is processed externally and Claude gets back concise summaries.

## Architecture

```
Claude Code CLI session
    │ (stdio JSON-RPC)
    ▼
MCP Server (node /app/dist/mcp/server.js)
    ├── Gemini backend  → Google AI Studio API (free)
    ├── Ollama backend  → REST API → host.docker.internal:11434
    └── OpenAI backend  → OpenAI API (paid)
```

- Separate Node.js process inside the same Docker container
- Claude Code starts it via stdio transport on first tool call
- Uses `@modelcontextprotocol/sdk` for protocol handling
- Auto-registered in `/home/claude/.claude.json` at harness startup

## Tools

| Tool | Backend | Purpose | Context Savings |
|------|---------|---------|-----------------|
| `research_web(query, depth?)` | Gemini + Google Search grounding | Web research + synthesis | Huge — replaces WebSearch + multiple WebFetch |
| `summarize_text(content, focus?)` | Ollama qwen3-vl | Summarize provided text | Moderate — avoids multi-pass reasoning |
| `summarize_url(url, focus?)` | Gemini | Fetch URL + summarize | Large — raw page never enters context |
| `analyze_image(image_path, question?)` | Ollama qwen3-vl | Image analysis | Moderate — vision processing offloaded |
| `analyze_complex(content, question)` | OpenAI GPT-4o-mini | Deep analysis | Moderate — complex reasoning offloaded |

**Fallback chains:**
- `summarize_text`: Ollama → Gemini → OpenAI
- `analyze_complex`: OpenAI → Gemini
- Others: no fallback (capability-specific)

## Model Backends

Available models with task-based routing:

- **Gemini 2.0 Flash** — Free via Google AI Studio. 1M token context. Best for web research (Google Search grounding) and URL summarization.
- **Ollama qwen3-vl:8b** — Runs on Unraid host (8GB VRAM GPU). Local, fast, private. Vision-capable for image analysis. Best for text/image summarization.
- **OpenAI GPT-4o-mini** — Paid credits. Strong reasoning. Best for complex analysis tasks.

Common `ModelBackend` interface with adapter pattern:
- `checkHealth()` — runtime reachability check
- `generate(options)` — text completion
- `analyzeImage(options)` — image analysis (Ollama only)

## File Structure

```
src/mcp/
  server.ts              # Entry point — McpServer, tool registration, stdio transport
  config.ts              # Env var loading (zod schema)
  logger.ts              # Pino to stderr (stdout = MCP protocol)
  register.ts            # Auto-register in /home/claude/.claude.json
  backends/
    types.ts             # ModelBackend interface
    gemini.ts            # @google/genai SDK wrapper
    ollama.ts            # fetch() against Ollama REST API
    openai.ts            # OpenAI SDK wrapper
  tools/
    research-web.ts      # Gemini + Search grounding
    summarize-text.ts    # Ollama primary, fallback chain
    summarize-url.ts     # Fetch URL → Gemini summarize
    analyze-image.ts     # Ollama qwen3-vl vision
    analyze-complex.ts   # OpenAI primary, Gemini fallback
  utils/
    fetch-url.ts         # URL fetching + HTML-to-text
    fallback.ts          # Generic fallback wrapper

tests/mcp/              # Mirrors src/mcp/ structure
```

## Modified Files

- `src/main.ts` — add `registerMcpServer()` call after config loading
- `package.json` — add `@modelcontextprotocol/sdk`, `@google/genai`, `openai`
- Docker compose — add env vars and `extra_hosts` for Ollama

## Configuration

Environment variables:
```
GEMINI_API_KEY=...                                    # free from AI Studio
OPENAI_API_KEY=...                                    # paid
OLLAMA_HOST=http://host.docker.internal:11434         # Ollama on host
OLLAMA_MODEL=qwen3-vl:8b                              # configurable model
```

Auto-registration writes to `/home/claude/.claude.json`:
```json
{
  "mcpServers": {
    "research": {
      "type": "stdio",
      "command": "node",
      "args": ["/app/dist/mcp/server.js"],
      "env": { "GEMINI_API_KEY": "...", "OPENAI_API_KEY": "...", "OLLAMA_HOST": "..." }
    }
  }
}
```

## System Prompt Guidance

A rule file at `/vault/.claude/rules/mcp-research.md` instructs Claude to prefer MCP tools:
- Use `research_web` instead of WebSearch + WebFetch for research
- Use `summarize_url` instead of WebFetch when you only need to understand a page
- Use `summarize_text` for large content you've already read but need to distill
- Use `analyze_image` for image understanding

## Testing

- Backend unit tests — mock fetch()/SDK, verify API calls and error handling
- Tool unit tests — mock backends, verify routing and fallback logic
- Config tests — env var loading and validation
- Server integration test — MCP in-memory transport, verify tool registration
