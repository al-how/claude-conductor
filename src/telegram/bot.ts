import { Bot, Context, session } from 'grammy';
import { chunkMessage, sanitizeMarkdown } from './utils.js';
import type { Logger } from 'pino';
import type { Dispatcher } from '../dispatcher/index.js';
import type { DatabaseManager } from '../db/index.js';

export interface TelegramBotConfig {
    token: string;
    allowedUsers: number[];
    dispatcher?: Dispatcher;
    db?: DatabaseManager;
    logger?: Logger;
}

export class TelegramBot {
    private bot: Bot;
    private logger?: Logger;
    private allowedUsers: Set<number>;
    private dispatcher?: Dispatcher;
    private db?: DatabaseManager;

    constructor(config: TelegramBotConfig) {
        this.allowedUsers = new Set(config.allowedUsers);
        this.logger = config.logger?.child({ module: 'telegram' });
        this.dispatcher = config.dispatcher;
        this.db = config.db;

        if (!config.token) {
            this.logger?.error('Telegram bot token is missing in config');
            throw new Error('Telegram bot token is missing');
        }
        this.logger?.info({ tokenMasked: config.token.substring(0, 5) + '...' }, 'Initializing Telegram Bot');

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
        this.bot.command('start', (ctx) => ctx.reply('Welcome to Claude Harness!'));
        this.bot.command('help', (ctx) => ctx.reply('Commands: /start, /help, /clear'));

        this.bot.command('clear', async (ctx) => {
            // TODO: Implement conversation clearing logic if needed (e.g. new session ID)
            await ctx.reply('Conversation context cleared (simulated).');
        });

        this.bot.on('message:text', async (ctx) => {
            const text = ctx.message.text;
            this.logger?.info({ userId: ctx.from.id, text }, 'Received message');

            // Save user message
            if (this.db) {
                try {
                    this.db.saveMessage(ctx.chat.id, 'user', text);
                } catch (e) {
                    this.logger?.error({ err: e }, 'Failed to save message to DB');
                }
            }

            if (this.dispatcher) {
                await ctx.replyWithChatAction('typing'); // Show typing status

                this.dispatcher.enqueue({
                    id: `tg-${ctx.message.message_id}`,
                    source: 'telegram',
                    prompt: text, // In integration, we might append history
                    sessionId: String(ctx.chat.id),
                    logger: this.logger,
                    onComplete: async (result) => {
                        // This will be handled in integration task properly, 
                        // but for now we can simulate or just leave it for the loop.
                        // We need to send the response back.
                        // But the dispatcher task is generic. 
                        // We can pass a closure here.

                        if (result.exitCode === 0) {
                            try {
                                const response = JSON.parse(result.stdout);
                                // Assuming standard Claude Code JSON output or just raw text?
                                // Spec says output-format json.
                                // Usually it's just the text if we use non-interactive?
                                // Actually `claude -p` output depends.
                                // If it is just the response text we want, we should parse it.
                                // For now, let's assume result.stdout is the response or part of it.
                                // But wait, claude -p output might be complex.
                                // Let's assume for this phase we just echo or send "Done".
                                // The integration task will refine this.
                            } catch (e) {
                                //
                            }
                        }
                    },
                    onError: async (err) => {
                        await ctx.reply(`Error: ${err.message}`);
                    }
                });
            } else {
                // specific for unit testing without dispatcher
                await ctx.reply('Dispatcher not connected.');
            }
        });
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
