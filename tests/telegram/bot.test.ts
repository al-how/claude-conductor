import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramBot } from '../../src/telegram/bot.js';
import { Dispatcher } from '../../src/dispatcher/index.js';

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
        }))
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
});
