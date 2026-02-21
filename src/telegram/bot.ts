import { Bot, Context, InputFile } from 'grammy';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkMessage, downloadTelegramFile, escapePromptContent, markdownToTelegramHtml, extractScreenshotPaths } from './utils.js';
import { extractResponseText } from '../claude/invoke.js';
import { resolveModel, isKnownAlias } from '../claude/models.js';
import type { ClaudeResult } from '../claude/invoke.js';
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
}

const TELEGRAM_FILES_DIR = resolve(process.env.TELEGRAM_FILES_DIR || '/data/telegram-files');

export class TelegramBot {
    private bot: Bot;
    private logger?: Logger;
    private allowedUsers: Set<number>;
    private dispatcher?: Dispatcher;
    private db?: DatabaseManager;
    private workingDir?: string;
    private stickyModel: string | undefined;
    private globalModel: string | undefined;

    constructor(config: TelegramBotConfig) {
        this.allowedUsers = new Set(config.allowedUsers);
        this.logger = config.logger?.child({ module: 'telegram' });
        this.dispatcher = config.dispatcher;
        this.db = config.db;
        this.workingDir = config.workingDir;
        this.globalModel = config.globalModel;

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
        this.bot.command('help', (ctx) => ctx.reply('Commands: /start, /help, /clear, /model'));

        this.bot.command('model', async (ctx) => {
            const text = ctx.message?.text || '';
            const args = text.replace(/^\/model\s*/, '').trim();

            if (!args) {
                const current = this.stickyModel || this.globalModel || 'default (CLI default)';
                await ctx.reply(`Current model: ${current}`);
                return;
            }

            const parts = args.split(/\s+/);
            const modelArg = parts[0].toLowerCase();

            if (modelArg === 'default' || modelArg === 'reset') {
                this.stickyModel = undefined;
                await ctx.reply('Model reset to default.');
                return;
            }

            // Per-message override: /model <known-alias> <prompt>
            if (parts.length > 1 && isKnownAlias(modelArg)) {
                const prompt = parts.slice(1).join(' ');
                await this.handleUserMessage(ctx, prompt, undefined, modelArg);
                return;
            }

            this.stickyModel = modelArg;
            await ctx.reply(`Model set to: ${modelArg}`);
        });

        this.bot.command('clear', async (ctx) => {
            if (this.db) {
                try {
                    this.db.clearConversation(ctx.chat!.id);
                    this.db.clearSessionId(ctx.chat!.id);
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
    }

    private async handleUserMessage(ctx: Context, text: string, filePaths?: string[], modelOverride?: string) {
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

        this.enqueueClaudeTask(ctx, prompt, ctx.message!.message_id, modelOverride);
    }

    private enqueueClaudeTask(ctx: Context, prompt: string, messageId: number, modelOverride?: string) {
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

        const model = resolveModel(modelOverride || this.stickyModel || this.globalModel || undefined)?.model;

        this.dispatcher!.enqueue({
            id: taskId,
            source: 'telegram',
            prompt,
            workingDir: this.workingDir,
            logger: this.logger,
            dangerouslySkipPermissions: true,
            ...(hasSession ? { continue: true } : {}),
            model,
            onComplete: async (result: ClaudeResult) => {
                // Persist the session ID so we know to use --continue next time
                if (result.sessionId && this.db) {
                    try { this.db.saveSessionId(chatId, result.sessionId); }
                    catch (e) { this.logger?.error({ err: e }, 'Failed to save session ID'); }
                }
                clearInterval(typingInterval);

                // Response handling
                let responseText = extractResponseText(result);
                if (!responseText || responseText.trim().length === 0) {
                    responseText = '(empty response)';
                }

                if (this.db) {
                    try {
                        this.db.saveMessage(ctx.chat!.id, 'assistant', responseText);
                    } catch (e) {
                        this.logger?.error({ err: e }, 'Failed to save assistant message to DB');
                    }
                }

                await this.sendTelegramResponse(ctx, responseText);
            },
            onError: async (err) => {
                clearInterval(typingInterval);
                await ctx.reply(`Error: ${err.message}`);
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
