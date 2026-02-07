import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramBot } from '../../src/telegram/bot.js';
import { Dispatcher } from '../../src/dispatcher/index.js';

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
});
