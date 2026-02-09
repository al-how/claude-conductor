Rename to Claude Conductor

Status: Working in docker

I want to work on the message UI in telegram. For example:                           
  1. Markdown formatting** — Right now `ctx.reply(chunk)` sends plain text. Adding `{ parse_mode: 'MarkdownV2' }` or `{ parse_mode: 'HTML' }` would make Claude's responses render with bold, italic, code blocks, links, etc. The `sanitizeMarkdown` function already exists in utils but isn't used. Needs
  some care since Claude's Markdown doesn't always match Telegram's MarkdownV2 spec. 
  1. `/history` command** — Browse previous sessions. Show timestamps, message count, first message review.
  2. Error messages with retry — Instead of "Error: ...", send a Telegram inline keyboard button like "Retry" that re-sends the last prompt.
  3. Multi-message response grouping — When a response gets chunked into multiple messages, they arrive as separate messages. Could add a subtle "1/3", "2/3", "3/3" indicator, or send them as a single reply thread.
  4. `/status` command** — Show what's in the queue, if a cron job is running, last execution time, etc.          
