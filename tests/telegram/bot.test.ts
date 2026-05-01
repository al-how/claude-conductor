import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramBot } from '../../src/telegram/bot.js';
import { Dispatcher } from '../../src/dispatcher/index.js';
import { extractScreenshotPaths } from '../../src/telegram/utils.js';

// Helper to extract a registered command handler by name
function getCommandHandler(commandName: string): Function | undefined {
    const call = mockCommand.mock.calls.find((c: any[]) => c[0] === commandName);
    return call ? call[1] : undefined;
}

// Helper to extract registered message handler
function getMessageHandler(): Function | undefined {
    const call = mockOn.mock.calls.find((c: any[]) => c[0] === 'message:text');
    return call ? call[1] : undefined;
}

// Mock everything from grammy
const mockUse = vi.fn();
const mockCommand = vi.fn();
const mockOn = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockCatch = vi.fn();

vi.mock('grammy', () => {
    return {
        Bot: vi.fn().mockImplementation(() => ({
            use: mockUse,
            command: mockCommand,
            on: mockOn,
            start: mockStart,
            stop: mockStop,
            catch: mockCatch
        })),
        InputFile: vi.fn()
    };
});

describe('TelegramBot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize and setup handlers', () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        expect(mockUse).toHaveBeenCalled(); // Middleware
        expect(mockCommand).toHaveBeenCalledWith('start', expect.any(Function));
        expect(mockCommand).toHaveBeenCalledWith('help', expect.any(Function));
        expect(mockCommand).toHaveBeenCalledWith('clear', expect.any(Function));
        expect(mockOn).toHaveBeenCalledWith('message:text', expect.any(Function));
        expect(mockCatch).toHaveBeenCalled();
    });

    it('should start and stop', async () => {
        const bot = new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        await bot.start();
        expect(mockStart).toHaveBeenCalled();

        await bot.stop();
        expect(mockStop).toHaveBeenCalled();
    });

    it('should integrate with dispatcher (mocked)', () => {
        // access the handler passed to .on
        // This is a bit complex to test without a full functioning bot mock object
        // or using grammy's test helpers.
        // For unit testing the structure, checking calls is enough.
        // Integration test will cover the flow more deeply.

        const dispatcher = new Dispatcher();
        new TelegramBot({
            token: 'fake',
            allowedUsers: [1],
            dispatcher
        });

        // Just verify we passed it
        expect(mockOn).toHaveBeenCalledWith('message:text', expect.any(Function));
    });

    it('should register /model command handler', () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        expect(mockCommand).toHaveBeenCalledWith('model', expect.any(Function));
    });

    it('/model with no args should reply with current model', async () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            globalModel: 'sonnet'
        });

        const handler = getCommandHandler('model')!;
        const mockCtx = {
            message: { text: '/model' },
            reply: vi.fn()
        };

        await handler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('sonnet'));
    });

    it('/model sonnet should set sticky model', async () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        const handler = getCommandHandler('model')!;
        const mockCtx = {
            message: { text: '/model sonnet' },
            reply: vi.fn()
        };

        await handler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('sonnet'));
    });

    it('/model default should clear sticky model', async () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        const handler = getCommandHandler('model')!;

        // First set a sticky model
        await handler({ message: { text: '/model haiku' }, reply: vi.fn() });

        // Then reset
        const mockCtx = { message: { text: '/model default' }, reply: vi.fn() };
        await handler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('reset'));
    });

    it('/model reset should clear sticky model', async () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        const handler = getCommandHandler('model')!;

        // Set then reset
        await handler({ message: { text: '/model opus' }, reply: vi.fn() });
        const mockCtx = { message: { text: '/model reset' }, reply: vi.fn() };
        await handler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('reset'));
    });

    it('should pass resolved model to dispatcher when sticky model is set', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
        });

        // Set sticky model
        const modelHandler = getCommandHandler('model')!;
        await modelHandler({ message: { text: '/model haiku' }, reply: vi.fn() });

        // Send a regular message
        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
        );
    });

    it('should pass global model to dispatcher when no sticky model', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            globalModel: 'opus'
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-opus-4-6' })
        );
    });

    it('should skip conversation history injection when session exists', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([
                { role: 'user', content: 'older message' },
                { role: 'assistant', content: 'older reply' },
                { role: 'user', content: 'hello' }
            ]),
            getSessionId: vi.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000')
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];
        expect(task.prompt).not.toContain('<conversation_history>');
        expect(task.prompt).toBe('hello');
        expect(task.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(task.resume).toBe(true);
        expect(task.continue).toBeUndefined();
        expect(mockDb.getRecentContext).not.toHaveBeenCalled();
    });

    it('should not set resume or continue when no session exists', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];
        expect(task.sessionId).toBeUndefined();
        expect(task.resume).toBeUndefined();
        expect(task.continue).toBeUndefined();
    });

    it('/clear should delete the saved session so the next message starts fresh', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn()
                .mockReturnValueOnce('550e8400-e29b-41d4-a716-446655440000')
                .mockReturnValueOnce(undefined),
            clearConversation: vi.fn(),
            clearSessionId: vi.fn()
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
        });

        const clearHandler = getCommandHandler('clear')!;
        const clearCtx = {
            chat: { id: 100 },
            reply: vi.fn()
        };

        await clearHandler(clearCtx);

        expect(mockDb.clearConversation).toHaveBeenCalledWith(100);
        expect(mockDb.clearSessionId).toHaveBeenCalledWith(100);

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello after clear', message_id: 2 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];
        expect(task.sessionId).toBeUndefined();
        expect(task.resume).toBeUndefined();
        expect(task.continue).toBeUndefined();
    });

    it('/session should show the stored UUID and resume command', async () => {
        const mockDb = {
            getSessionId: vi.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000')
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            db: mockDb as any
        });

        const sessionHandler = getCommandHandler('session')!;
        const mockCtx = {
            chat: { id: 100 },
            reply: vi.fn()
        };

        await sessionHandler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(
            expect.stringContaining('claude --resume 550e8400-e29b-41d4-a716-446655440000'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
    });

    it('/model haiku <prompt> should send one-time override without changing sticky', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
        });

        const modelHandler = getCommandHandler('model')!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: '/model haiku what is today\'s summary?', message_id: 2 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await modelHandler(mockCtx);

        // Should enqueue with haiku model
        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
        );

        // Sticky model should NOT be set — verify by querying
        const queryCtx = { message: { text: '/model' }, reply: vi.fn() };
        await modelHandler(queryCtx);
        expect(queryCtx.reply).toHaveBeenCalledWith('Current model: default (CLI default)');
    });

    it('/model with unknown alias and prompt should treat entire text as sticky', async () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        const handler = getCommandHandler('model')!;
        const mockCtx = {
            message: { text: '/model custommodel' },
            reply: vi.fn()
        };

        await handler(mockCtx);

        // Single word that's not a known alias — set as sticky
        expect(mockCtx.reply).toHaveBeenCalledWith('Model set to: custommodel');
    });

    it('/help should include /model in command list', () => {
        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123]
        });

        const handler = getCommandHandler('help')!;
        const mockCtx = { reply: vi.fn() };
        handler(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('/model'));
    });

    it('/provider openrouter should clear sticky model and use openrouter default', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined),
            getChatSettings: vi.fn().mockReturnValue(undefined),
            setChatSettings: vi.fn()
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            openRouterConfig: {
                api_key: 'sk-or-test',
                base_url: 'https://openrouter.ai/api',
                default_model: 'qwen/qwen3-coder',
                allowed_models: ['qwen/qwen3-coder']
            }
        });

        const modelHandler = getCommandHandler('model')!;
        await modelHandler({ message: { text: '/model sonnet' }, reply: vi.fn() });

        const providerHandler = getCommandHandler('provider')!;
        await providerHandler({
            message: { text: '/provider openrouter' },
            chat: { id: 100 },
            reply: vi.fn()
        });

        const textHandler = getMessageHandler()!;
        await textHandler({
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'qwen/qwen3-coder',
                providerEnv: expect.objectContaining({
                    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api'
                })
            })
        );
    });

    it('/provider openrouter <prompt> should ignore sticky model for one-off override', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined),
            getChatSettings: vi.fn().mockReturnValue(undefined),
            setChatSettings: vi.fn()
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            openRouterConfig: {
                api_key: 'sk-or-test',
                base_url: 'https://openrouter.ai/api',
                default_model: 'qwen/qwen3-coder',
                allowed_models: ['qwen/qwen3-coder']
            }
        });

        const modelHandler = getCommandHandler('model')!;
        await modelHandler({ message: { text: '/model sonnet' }, reply: vi.fn() });

        const providerHandler = getCommandHandler('provider')!;
        await providerHandler({
            from: { id: 123 },
            message: { text: '/provider openrouter summarize this', message_id: 2 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'qwen/qwen3-coder',
                providerEnv: expect.objectContaining({
                    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api'
                })
            })
        );
    });
});

describe('TelegramBot streaming', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should pass onStreamEvent when streamingEnabled is true', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            streamingEnabled: true
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ onStreamEvent: expect.any(Function) })
        );
    });

    it('should not pass onStreamEvent when streamingEnabled is false', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            streamingEnabled: false
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];
        expect(task.onStreamEvent).toBeUndefined();
    });

    it('should pass includePartialMessages when streamingEnabled is true', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            streamingEnabled: true
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ includePartialMessages: true })
        );
    });

    it('should not pass includePartialMessages when streamingEnabled is false', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            streamingEnabled: false
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ includePartialMessages: false })
        );
    });

    it('should default streamingEnabled to true', async () => {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any
            // streamingEnabled not set — should default to true
        });

        const textHandler = getMessageHandler()!;
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: vi.fn(),
            replyWithChatAction: vi.fn()
        };

        await textHandler(mockCtx);

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ onStreamEvent: expect.any(Function) })
        );
    });
});

describe('TelegramBot streaming finalization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function setupBotAndEnqueue() {
        const dispatcher = new Dispatcher();
        const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
        const mockDb = {
            saveMessage: vi.fn(),
            getRecentContext: vi.fn().mockReturnValue([]),
            getSessionId: vi.fn().mockReturnValue(undefined)
        };

        new TelegramBot({
            token: 'fake-token',
            allowedUsers: [123],
            dispatcher,
            db: mockDb as any,
            streamingEnabled: true
        });

        const mockEditMessageText = vi.fn();
        const mockDeleteMessage = vi.fn();
        const mockReply = vi.fn().mockResolvedValue({ message_id: 999 });
        const mockCtx = {
            from: { id: 123 },
            message: { text: 'hello', message_id: 1 },
            chat: { id: 100 },
            reply: mockReply,
            replyWithChatAction: vi.fn(),
            api: { editMessageText: mockEditMessageText, deleteMessage: mockDeleteMessage }
        };

        return { enqueueSpy, mockCtx, mockEditMessageText, mockDeleteMessage, mockReply };
    }

    it('should flush buffered text before sending final response on complete', async () => {
        const { enqueueSpy, mockCtx, mockEditMessageText } = setupBotAndEnqueue();

        const textHandler = getMessageHandler()!;
        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];

        // Simulate streaming: send a text_delta to create a stream message and buffer
        await task.onStreamEvent({ timestamp: new Date().toISOString(), type: 'text_delta', data: { text: 'partial response' } });

        // Simulate completion — buffer should be flushed
        await task.onComplete({ exitCode: 0, stdout: '{"result":"done"}', stderr: '', timedOut: false });

        // editMessageText should have been called to flush the buffer
        expect(mockEditMessageText).toHaveBeenCalledWith(100, 999, expect.stringContaining('partial response'));
    });

    it('should delete stream messages on error', async () => {
        const { enqueueSpy, mockCtx, mockDeleteMessage } = setupBotAndEnqueue();

        const textHandler = getMessageHandler()!;
        await textHandler(mockCtx);

        const task = enqueueSpy.mock.calls[0][0];

        // Simulate streaming to create a stream message
        await task.onStreamEvent({ timestamp: new Date().toISOString(), type: 'text_delta', data: { text: 'partial' } });

        // Simulate error
        await task.onError(new Error('something went wrong'));

        // Stream messages should be cleaned up
        expect(mockDeleteMessage).toHaveBeenCalledWith(100, 999);
    });
});

describe('screenshot detection', () => {
    it('should detect screenshot paths in response text', () => {
        const text = 'Here is what I found. Screenshot saved to /data/screenshots/2026-02-21-123456.png';
        const paths = extractScreenshotPaths(text);
        expect(paths).toEqual(['/data/screenshots/2026-02-21-123456.png']);
    });

    it('should return empty array when no screenshots', () => {
        const text = 'No screenshots here.';
        const paths = extractScreenshotPaths(text);
        expect(paths).toEqual([]);
    });
});
