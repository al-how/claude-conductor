import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/db/index.js';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('DatabaseManager', () => {
    let dbPath: string;
    let dbManager: DatabaseManager;

    beforeEach(() => {
        // Create a temp file path
        dbPath = join(tmpdir(), `test-db-${Date.now()}.sqlite`);
        dbManager = new DatabaseManager(dbPath);
    });

    afterEach(() => {
        dbManager.close();
        try {
            unlinkSync(dbPath);
        } catch (e) {
            // Ignore if file already gone
        }
    });

    it('should initialize without error', () => {
        expect(dbManager).toBeDefined();
    });

    it('should save and retrieve messages', () => {
        const chatId = 12345;
        dbManager.saveMessage(chatId, 'user', 'Hello');
        dbManager.saveMessage(chatId, 'assistant', 'Hi there');

        const context = dbManager.getRecentContext(chatId);
        expect(context).toHaveLength(2);
        expect(context[0].role).toBe('user');
        expect(context[0].content).toBe('Hello');
        expect(context[1].role).toBe('assistant');
        expect(context[1].content).toBe('Hi there');
    });

    it('should limit context size', () => {
        const chatId = 67890;
        for (let i = 0; i < 10; i++) {
            dbManager.saveMessage(chatId, 'user', `msg ${i}`);
        }

        const context = dbManager.getRecentContext(chatId, 5);
        expect(context).toHaveLength(5);
        // Should be the last 5 messages (msg 5 to msg 9), in chronological order
        expect(context[0].content).toBe('msg 5');
        expect(context[4].content).toBe('msg 9');
    });

    it('should separate conversations by chat_id', () => {
        dbManager.saveMessage(1, 'user', 'User 1');
        dbManager.saveMessage(2, 'user', 'User 2');

        const context1 = dbManager.getRecentContext(1);
        expect(context1).toHaveLength(1);
        expect(context1[0].content).toBe('User 1');

        const context2 = dbManager.getRecentContext(2);
        expect(context2).toHaveLength(1);
        expect(context2[0].content).toBe('User 2');
    });
});
