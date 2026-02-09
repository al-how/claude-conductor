Rename to Claude Conductor

Status: Working in docker

I want to work on the message UI in telegram. For example:                           

  1. `/history` command** — Browse previous sessions. Show timestamps, message count, first message review.
  2. Error messages with retry — Instead of "Error: ...", send a Telegram inline keyboard button like "Retry" that re-sends the last prompt.
  3. Multi-message response grouping — When a response gets chunked into multiple messages, they arrive as separate messages. Could add a subtle "1/3", "2/3", "3/3" indicator, or send them as a single reply thread.
  4. `/status` command** — Show what's in the queue, if a cron job is running, last execution time, etc.          
  5. Fix this problem: Claude ran out of turns (26 used). The task may be partially complete — try a follow-up message to continue.
