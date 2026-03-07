import { Bot, Context, InputFile } from 'grammy';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkMessage, downloadTelegramFile, escapePromptContent, markdownToTelegramHtml, extractScreenshotPaths } from './utils.js';
import { extractResponseText } from '../claude/invoke.js';
import { resolveExecutionTarget, isKnownAlias } from '../claude/models.js';
import type { ClaudeResult, StreamEvent } from '../claude/invoke.js';
import type { OllamaConfig, OpenRouterConfig } from '../config/schema.js';
import type { Logger } from 'pino';
import type { Dispatcher } from '../dispatcher/index.js';
import type { DatabaseManager } from '../db/index.js';

export interface TelegramBotConfig {
    token: string;
    allowedUsers: number[];
    workingDir?: string;
    dispatcher?: Dispatcher;
    db?: DatabaseManager;
    logger?: Logger;
    globalModel?: string;
    globalProvider?: 'claude' | 'openrouter' | 'ollama';
    openRouterConfig?: OpenRouterConfig;
    ollamaConfig?: OllamaConfig;
    streamingEnabled?: boolean;
    showToolEvents?: boolean;
}

const TELEGRAM_FILES_DIR = resolve(process.env.TELEGRAM_FILES_DIR || '/data/telegram-files');

export function formatToolStatus(tool: string, arg?: string): string {
    if (!arg) return `[tool] ${tool}`;
    const collapsed = arg.replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    const maxLen = 120;
    const truncated = collapsed.length > maxLen ? collapsed.slice(0, maxLen) + '…' : collapsed;
    return `[tool] ${tool}: ${truncated}`;
}

export class TelegramBot {
    private bot: Bot;
    private logger?: Logger;
    private allowedUsers: Set<number>;
    private dispatcher?: Dispatcher;
    private db?: DatabaseManager;
    private workingDir?: string;
    private stickyModel: string | undefined;
    private stickyProvider: 'claude' | 'openrouter' | 'ollama' | undefined;
    private globalModel: string | undefined;
    private globalProvider: 'claude' | 'openrouter' | 'ollama' | undefined;
    private openRouterConfig: OpenRouterConfig | undefined;
    private ollamaConfig: OllamaConfig | undefined;
    private streamingEnabled: boolean;
    private showToolEvents: boolean;

    constructor(config: TelegramBotConfig) {
        this.allowedUsers = new Set(config.allowedUsers);
        this.logger = config.logger?.child({ module: 'telegram' });
        this.dispatcher = config.dispatcher;
        this.db = config.db;
        this.workingDir = config.workingDir;
        this.globalModel = config.globalModel;
        this.globalProvider = config.globalProvider;
        this.openRouterConfig = config.openRouterConfig;
        this.ollamaConfig = config.ollamaConfig;
        this.streamingEnabled = config.streamingEnabled ?? true;
        this.showToolEvents = config.showToolEvents ?? true;

        if (!config.token) {
            this.logger?.error('Telegram bot token is missing in config');
            throw new Error('Telegram bot token is missing');
        }
        this.logger?.info({ hasToken: !!config.token }, 'Initializing Telegram Bot');

        this.bot = new Bot<Context>(config.token);
        this.setupMiddleware();
        this.setupHandlers();
    }

    private setupMiddleware() {
        // Auth middleware
        this.bot.use(async (ctx, next) => {
            const userId = ctx.from?.id;
            if (!userId || !this.allowedUsers.has(userId)) {
                this.logger?.warn({ userId }, 'Unauthorized access attempt');
                return; // Drop message silently or maybe reply? Silently is safer.
            }
            await next();
        });

        // Error handling
        this.bot.catch(async (err) => {
            const ctx = err.ctx;
            this.logger?.error({ err, update_id: ctx.update.update_id }, 'Telegram Bot Error');
            try {
                // Determine if we can reply
                if (ctx && ctx.chat) {
                    await ctx.reply('An internal error occurred. Please try again later.');
                }
            } catch (e) {
                // Ignore reply error
            }
        });
    }

    private setupHandlers() {
        this.bot.command('start', (ctx) => ctx.reply('Welcome to Claude Conductor!'));
        this.bot.command('help', (ctx) => ctx.reply('Commands: /start, /help, /clear, /model, /provider'));

        this.bot.command('provider', async (ctx) => {
            const text = ctx.message?.text || '';
            const args = text.replace(/^\/provider\s*/, '').trim();
            const chatId = ctx.chat?.id;

            if (!args) {
                // Query current sticky provider
                const chatSettings = chatId ? (this.db as any)?.getChatSettings?.(chatId) : undefined;
                const current = chatSettings?.provider || this.stickyProvider || this.globalProvider || 'claude (default)';
                await ctx.reply(`Current provider: ${current}`);
                return;
            }

            const parts = args.split(/\s+/);
            const providerArg = parts[0].toLowerCase() as 'claude' | 'openrouter' | 'ollama' | 'default' | 'reset';

            if (providerArg === 'default' || providerArg === 'reset') {
                this.stickyProvider = undefined;
                this.stickyModel = undefined;
                if (chatId) {
                    (this.db as any)?.setChatSettings?.(chatId, { provider: null, model: null });
                }
                await ctx.reply('Provider reset to default.');
                return;
            }

            const validProviders = ['claude', 'openrouter', 'ollama'];
            if (!validProviders.includes(providerArg)) {
                await ctx.reply(`Unknown provider: ${providerArg}. Use: claude, openrouter, ollama`);
                return;
            }

            // One-off override: /provider <provider> <prompt>
            if (parts.length > 1) {
                const prompt = parts.slice(1).join(' ');
                await this.handleUserMessage(ctx, prompt, undefined, undefined, providerArg as 'claude' | 'openrouter' | 'ollama');
                return;
            }

            // Set sticky provider and clear sticky model to avoid cross-provider model conflicts
            // (e.g. switching from Claude "sonnet" to OpenRouter with a strict allowlist).
            this.stickyProvider = providerArg as 'claude' | 'openrouter' | 'ollama';
            this.stickyModel = undefined;
            if (chatId) {
                (this.db as any)?.setChatSettings?.(chatId, { provider: this.stickyProvider, model: null });
            }
            await ctx.reply(`Provider set to: ${this.stickyProvider} (model reset to provider default)`);
        });

        this.bot.command('model', async (ctx) => {
            const text = ctx.message?.text || '';
            const args = text.replace(/^\/model\s*/, '').trim();
            const chatId = ctx.chat?.id;

            if (!args) {
                const chatSettings = chatId ? (this.db as any)?.getChatSettings?.(chatId) : undefined;
                const current = chatSettings?.model || this.stickyModel || this.globalModel || 'default (CLI default)';
                await ctx.reply(`Current model: ${current}`);
                return;
            }

            const parts = args.split(/\s+/);
            const modelArg = parts[0].toLowerCase();

            if (modelArg === 'default' || modelArg === 'reset') {
                this.stickyModel = undefined;
                if (chatId) {
                    (this.db as any)?.setChatSettings?.(chatId, { model: null });
                }
                await ctx.reply('Model reset to default.');
                return;
            }

            // Determine effective provider for validation
            const chatSettings = chatId ? (this.db as any)?.getChatSettings?.(chatId) : undefined;
            const effectiveProvider = chatSettings?.provider || this.stickyProvider || this.globalProvider || 'claude';

            // Provider-aware validation for non-Claude providers
            if (effectiveProvider === 'openrouter') {
                if (!this.openRouterConfig) {
                    await ctx.reply('OpenRouter is not configured. Set openrouter config in config.yaml.');
                    return;
                }
                if (!this.openRouterConfig.allowed_models.includes(modelArg) && !this.openRouterConfig.allowed_models.includes(parts[0])) {
                    const allowed = this.openRouterConfig.allowed_models.join(', ');
                    await ctx.reply(`Model '${modelArg}' is not in the OpenRouter allowed_models list.\nAllowed: ${allowed}`);
                    return;
                }
            } else if (effectiveProvider === 'ollama') {
                if (!this.ollamaConfig) {
                    await ctx.reply('Ollama is not configured. Set ollama config in config.yaml.');
                    return;
                }
                if (!this.ollamaConfig.allowed_models.includes(modelArg) && !this.ollamaConfig.allowed_models.includes(parts[0])) {
                    const allowed = this.ollamaConfig.allowed_models.join(', ');
                    await ctx.reply(`Model '${modelArg}' is not in the Ollama allowed_models list.\nAllowed: ${allowed}`);
                    return;
                }
            } else {
                // Claude provider: per-message override for known aliases
                if (parts.length > 1 && isKnownAlias(modelArg)) {
                    const prompt = parts.slice(1).join(' ');
                    await this.handleUserMessage(ctx, prompt, undefined, modelArg);
                    return;
                }
            }

            this.stickyModel = modelArg;
            if (chatId) {
                (this.db as any)?.setChatSettings?.(chatId, { model: modelArg });
            }
            await ctx.reply(`Model set to: ${modelArg}`);
        });

        this.bot.command('clear', async (ctx) => {
            if (this.db) {
                try {
                    this.db.clearConversation(ctx.chat!.id);
                    this.db.clearSessionId(ctx.chat!.id);
                    // NOTE: /clear does NOT reset chat_settings (sticky provider/model persists)
                    await ctx.reply('Conversation context cleared.');
                } catch (e) {
                    this.logger?.error({ err: e }, 'Failed to clear conversation');
                    await ctx.reply('Failed to clear conversation context.');
                }
            } else {
                await ctx.reply('Database not connected.');
            }
        });

        this.bot.on('message:text', async (ctx) => {
            const text = ctx.message.text;
            this.logger?.info({ event: 'message_received', userId: ctx.from.id, text }, 'Received message');
            await this.handleUserMessage(ctx, text);
        });

        this.bot.on('message:photo', async (ctx) => {
            const photos = ctx.message.photo;
            const largest = photos[photos.length - 1];
            this.logger?.info({ userId: ctx.from.id, fileId: largest.file_id }, 'Received photo');

            try {
                const localPath = await downloadTelegramFile(
                    this.bot,
                    largest.file_id,
                    TELEGRAM_FILES_DIR,
                    `photo_${largest.file_unique_id}.jpg`
                );
                const text = ctx.message.caption || 'Describe this image.';
                await this.handleUserMessage(ctx, text, [localPath]);
            } catch (e) {
                this.logger?.error({ err: e }, 'Failed to download photo');
                await ctx.reply('Failed to download the photo.');
            }
        });

        this.bot.on('message:document', async (ctx) => {
            const doc = ctx.message.document;
            this.logger?.info({ userId: ctx.from.id, fileName: doc.file_name }, 'Received document');

            try {
                const localPath = await downloadTelegramFile(
                    this.bot,
                    doc.file_id,
                    TELEGRAM_FILES_DIR,
                    doc.file_name
                );
                const text = ctx.message.caption || 'Analyze this file.';
                await this.handleUserMessage(ctx, text, [localPath]);
            } catch (e) {
                this.logger?.error({ err: e }, 'Failed to download document');
                await ctx.reply('Failed to download the document.');
            }
        });

        this.bot.on('message:location', async (ctx) => {
            const { latitude, longitude } = ctx.message.location;
            const caption = ctx.message.caption ?? '';
            const locationText = `[Location shared: latitude=${latitude}, longitude=${longitude}]${caption ? `\n${caption}` : ''}`;
            await this.handleUserMessage(ctx, locationText);
        });

        this.bot.on('message:venue', async (ctx) => {
            const { location, title, address } = ctx.message.venue;
            const { latitude, longitude } = location;
            const locationText = `[Location shared: "${title}" at ${address} (latitude=${latitude}, longitude=${longitude})]`;
            await this.handleUserMessage(ctx, locationText);
        });
    }

    private async handleUserMessage(ctx: Context, text: string, filePaths?: string[], modelOverride?: string, providerOverride?: 'claude' | 'openrouter' | 'ollama') {
        // Extract reply context if replying to a message
        let replyContext = '';
        if (ctx.message?.reply_to_message) {
            const replied = ctx.message.reply_to_message;
            const quotedText = (replied as any).text || (replied as any).caption || '(media message)';
            replyContext = `[Replying to: "${quotedText}"]\n`;
        }

        // Save user message
        if (this.db) {
            try {
                this.db.saveMessage(ctx.chat!.id, 'user', text);
            } catch (e) {
                this.logger?.error({ err: e }, 'Failed to save message to DB');
            }
        }

        if (!this.dispatcher) {
            await ctx.reply('Dispatcher not connected.');
            return;
        }

        // Build file attachment block
        let fileBlock = '';
        if (filePaths && filePaths.length > 0) {
            const entries = filePaths
                .map(fp => `File: ${fp}\nUse the Read tool to view this file.`)
                .join('\n\n');
            fileBlock = `<attached_files>\n${entries}\n</attached_files>\n\n`;
        }

        // Build prompt with conversation history for context
        let prompt = `${replyContext}${fileBlock}${text}`;
        if (this.db) {
            try {
                const history = this.db.getRecentContext(ctx.chat!.id, 20);
                const prior = history.slice(0, -1);
                if (prior.length > 0) {
                    const historyBlock = prior
                        .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${escapePromptContent(m.content)}`)
                        .join('\n\n');
                    prompt = `<conversation_history>\n${historyBlock}\n</conversation_history>\n\n${fileBlock}${replyContext}Human: ${text}`;
                }
            } catch (e) {
                this.logger?.error({ err: e }, 'Failed to load conversation history');
            }
        }

        this.enqueueClaudeTask(ctx, prompt, ctx.message!.message_id, modelOverride, providerOverride);
    }

    private enqueueClaudeTask(ctx: Context, prompt: string, messageId: number, modelOverride?: string, providerOverride?: 'claude' | 'openrouter' | 'ollama') {
        const taskId = `tg-${messageId}`;

        // Start typing indicator
        void ctx.replyWithChatAction('typing');
        const typingInterval = setInterval(async () => {
            try {
                await ctx.replyWithChatAction('typing');
            } catch {
                // Chat may have been deleted or bot blocked — ignore
            }
        }, 5000);

        // Check if this chat has an existing Claude Code session to continue
        const chatId = ctx.chat!.id;
        const hasSession = !!this.db?.getSessionId(chatId);

        // Load sticky settings from DB (if available), fall back to in-memory
        const chatSettings = (this.db as any)?.getChatSettings?.(chatId);
        const effectiveStickyModel = chatSettings?.model || this.stickyModel;
        const effectiveStickyProvider = chatSettings?.provider || this.stickyProvider;

        // Resolve the full execution target (provider, model, env vars)
        const effectiveModelInput =
            modelOverride !== undefined
                ? modelOverride
                : providerOverride !== undefined
                    ? undefined
                    : effectiveStickyModel || undefined;

        let target;
        try {
            target = resolveExecutionTarget({
                model: effectiveModelInput,
                provider: providerOverride || effectiveStickyProvider || this.globalProvider || undefined,
                globalModel: this.globalModel,
                ollamaConfig: this.ollamaConfig,
                openRouterConfig: this.openRouterConfig,
            });
        } catch (err) {
            clearInterval(typingInterval);
            void ctx.reply(`Configuration error: ${(err as Error).message}`);
            return;
        }

        const { model, providerEnv } = target;

        // Streaming state
        let streamBuffer = '';
        let streamMessageId: number | undefined;
        const streamMessageIds: number[] = [];
        let lastEditAt = 0;
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        let lastFlushedContent = '';
        let lastToolResult = '';
        const throttleMs = 1000;

        const ensureStreamMessage = async () => {
            if (!streamMessageId) {
                const msg = await ctx.reply('…');
                streamMessageId = msg.message_id;
                streamMessageIds.push(streamMessageId);
            }
        };

        const flushStream = async () => {
            if (!streamMessageId) return;
            const content = streamBuffer.slice(0, 4096);
            if (content === lastFlushedContent) return;
            try {
                await ctx.api.editMessageText(ctx.chat!.id, streamMessageId, content);
                lastFlushedContent = content;
            } catch (e) {
                this.logger?.warn({ err: e }, 'Failed to edit stream message');
            }
        };

        const onStreamEvent = this.streamingEnabled ? async (event: StreamEvent) => {
            // Capture tool result content as fallback for models that complete without text
            if (event.type === 'tool_result') {
                lastToolResult = String(event.data.content ?? '');
                return;
            }

            let chunk: string | undefined;

            if (event.type === 'text_delta') {
                chunk = String(event.data.text ?? '');
            } else if (event.type === 'tool_use' && this.showToolEvents) {
                chunk = '\n' + formatToolStatus(
                    event.data.tool as string,
                    event.data.arg as string | undefined
                ) + '\n';
            }

            if (!chunk) return;

            streamBuffer += chunk;
            await ensureStreamMessage();

            // Overflow handling: finalize current stream message and start a new one
            if (streamBuffer.length > 4096) {
                await flushStream();
                streamBuffer = streamBuffer.slice(4096);
                streamMessageId = undefined;
                lastFlushedContent = '';
                await ensureStreamMessage();
            }

            // Throttled edits
            const now = Date.now();
            if (now - lastEditAt >= throttleMs) {
                lastEditAt = now;
                await flushStream();
            } else if (!flushTimer) {
                flushTimer = setTimeout(async () => {
                    flushTimer = undefined;
                    lastEditAt = Date.now();
                    await flushStream();
                }, throttleMs - (now - lastEditAt));
            }
        } : undefined;

        this.dispatcher!.enqueue({
            id: taskId,
            source: 'telegram',
            prompt,
            workingDir: this.workingDir,
            logger: this.logger,
            dangerouslySkipPermissions: true,
            includePartialMessages: this.streamingEnabled,
            ...(hasSession ? { continue: true } : {}),
            model,
            providerEnv,
            onStreamEvent,
            onComplete: async (result: ClaudeResult) => {
                // Persist the session ID so we know to use --continue next time
                if (result.sessionId && this.db) {
                    try { this.db.saveSessionId(chatId, result.sessionId); }
                    catch (e) { this.logger?.error({ err: e }, 'Failed to save session ID'); }
                }
                clearInterval(typingInterval);

                // Clear any pending stream flush and flush remaining buffer
                if (flushTimer) clearTimeout(flushTimer);
                if (streamBuffer && streamMessageId) {
                    await flushStream();
                }

                // Response handling
                let responseText = extractResponseText(result);
                // Fallback for models that complete tool-use without generating text
                if (!responseText || responseText.trim().length === 0 || responseText.startsWith('Claude finished without a response')) {
                    if (streamBuffer.trim()) {
                        responseText = streamBuffer.trim();
                    } else if (lastToolResult.trim()) {
                        responseText = lastToolResult.slice(0, 3000);
                    } else {
                        responseText = '(empty response)';
                    }
                }

                if (this.db) {
                    try {
                        this.db.saveMessage(ctx.chat!.id, 'assistant', responseText);
                    } catch (e) {
                        this.logger?.error({ err: e }, 'Failed to save assistant message to DB');
                    }
                }

                // Send final formatted response
                await this.sendTelegramResponse(ctx, responseText);

                // Delete stream messages to avoid duplication
                for (const msgId of streamMessageIds) {
                    try {
                        await ctx.api.deleteMessage(ctx.chat!.id, msgId);
                    } catch (e) {
                        this.logger?.warn({ err: e, msgId }, 'Failed to delete stream message');
                    }
                }
            },
            onError: async (err) => {
                clearInterval(typingInterval);
                if (flushTimer) clearTimeout(flushTimer);
                await ctx.reply(`Error: ${err.message}`);

                // Clean up stream messages
                for (const msgId of streamMessageIds) {
                    try {
                        await ctx.api.deleteMessage(ctx.chat!.id, msgId);
                    } catch (e) {
                        this.logger?.warn({ err: e, msgId }, 'Failed to delete stream message');
                    }
                }
            }
        });
    }

    private async sendTelegramResponse(ctx: Context, responseText: string) {
        const htmlText = markdownToTelegramHtml(responseText);
        const htmlChunks = chunkMessage(htmlText);
        const plainChunks = chunkMessage(responseText);
        for (let i = 0; i < htmlChunks.length; i++) {
            try {
                await ctx.reply(htmlChunks[i], { parse_mode: 'HTML' });
            } catch (e) {
                this.logger?.warn({ err: e }, 'HTML reply failed, falling back to plain text');
                try {
                    await ctx.reply(plainChunks[i] || htmlChunks[i]);
                } catch (e2) {
                    this.logger?.error({ err: e2 }, 'Failed to send Telegram reply');
                }
            }
        }

        // Send any screenshots referenced in the response
        const screenshots = extractScreenshotPaths(responseText);
        for (const screenshotPath of screenshots) {
            if (existsSync(screenshotPath)) {
                try {
                    await ctx.replyWithPhoto(new InputFile(screenshotPath));
                } catch (e) {
                    this.logger?.warn({ err: e, path: screenshotPath }, 'Failed to send screenshot');
                }
            }
        }
    }

    public async sendMessage(chatId: number, text: string): Promise<void> {
        const htmlText = markdownToTelegramHtml(text);
        const chunks = chunkMessage(htmlText);
        for (const chunk of chunks) {
            try {
                await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
            } catch {
                // Fallback to plain text if HTML fails
                await this.bot.api.sendMessage(chatId, text.slice(0, 4096));
            }
        }
    }

    public async start() {
        this.logger?.info('Starting Telegram Bot');
        await this.bot.start({
            onStart: (botInfo) => {
                this.logger?.info({ botInfo }, 'Telegram Bot started');
            }
        });
    }

    public async stop() {
        this.logger?.info('Stopping Telegram Bot');
        await this.bot.stop();
    }
}
