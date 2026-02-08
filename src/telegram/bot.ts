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

                // Build prompt with conversation history for context
                let prompt = text;
                if (this.db) {
                    try {
                        const history = this.db.getRecentContext(ctx.chat.id, 20);
                        // Exclude the message we just saved (last entry) since it's the current prompt
                        const prior = history.slice(0, -1);
                        if (prior.length > 0) {
                            const historyBlock = prior
                                .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
                                .join('\n\n');
                            prompt = `<conversation_history>\n${historyBlock}\n</conversation_history>\n\nHuman: ${text}`;
                        }
                    } catch (e) {
                        this.logger?.error({ err: e }, 'Failed to load conversation history');
                    }
                }

                this.dispatcher.enqueue({
                    id: `tg-${ctx.message.message_id}`,
                    source: 'telegram',
                    prompt,
                    logger: this.logger,
                    onComplete: async (result) => {
                        let responseText: string;

                        if (result.timedOut) {
                            responseText = 'Claude Code timed out.';
                        } else if (result.exitCode !== 0) {
                            responseText = `Claude Code exited with code ${result.exitCode}.`;
                            if (result.stderr) {
                                responseText += `\n\n${result.stderr.slice(0, 500)}`;
                            }
                        } else {
                            // claude -p --output-format json returns a JSON object with a "result" field
                            try {
                                const parsed = JSON.parse(result.stdout);
                                responseText = parsed.result ?? parsed.text ?? result.stdout;
                            } catch {
                                // If not valid JSON, use raw stdout
                                responseText = result.stdout;
                            }
                        }

                        if (!responseText || responseText.trim().length === 0) {
                            responseText = '(empty response)';
                        }

                        // Save assistant response to DB
                        if (this.db) {
                            try {
                                this.db.saveMessage(ctx.chat.id, 'assistant', responseText);
                            } catch (e) {
                                this.logger?.error({ err: e }, 'Failed to save assistant message to DB');
                            }
                        }

                        // Send response, chunking if needed for Telegram's 4096 char limit
                        const chunks = chunkMessage(responseText);
                        for (const chunk of chunks) {
                            try {
                                await ctx.reply(chunk);
                            } catch (e) {
                                this.logger?.error({ err: e }, 'Failed to send Telegram reply');
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
