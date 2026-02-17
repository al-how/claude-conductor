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

    it('should retrieve recent context', () => {
        const chatId = 123;
        for (let i = 0; i < 30; i++) {
            dbManager.saveMessage(chatId, i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`);
        }

        const context = dbManager.getRecentContext(chatId, 10);
        expect(context).toHaveLength(10);
        // Should be last 10 messages, in chronological order
        expect(context[9].content).toBe('msg 29');
    });

    // Cron Tests
    it('should create and retrieve cron jobs', () => {
        const job = dbManager.createCronJob({
            name: 'test-job',
            schedule: '* * * * *',
            prompt: 'hello',
            output: 'log'
        });

        expect(job.id).toBeDefined();
        expect(job.name).toBe('test-job');
        expect(job.enabled).toBe(1);

        const retrieved = dbManager.getCronJob('test-job');
        expect(retrieved).toBeDefined();
        expect(retrieved?.name).toBe('test-job');
    });

    it('should list all cron jobs', () => {
        dbManager.createCronJob({ name: 'j1', schedule: '*', prompt: 'p1' });
        dbManager.createCronJob({ name: 'j2', schedule: '*', prompt: 'p2' });

        const jobs = dbManager.listCronJobs();
        expect(jobs).toHaveLength(2);
    });

    it('should update a cron job', () => {
        dbManager.createCronJob({ name: 'update-me', schedule: '*', prompt: 'old' });

        const updated = dbManager.updateCronJob('update-me', {
            schedule: '5 * * * *',
            prompt: 'new',
            enabled: 0
        });

        expect(updated).toBeDefined();
        expect(updated?.schedule).toBe('5 * * * *');
        expect(updated?.prompt).toBe('new');
        expect(updated?.enabled).toBe(0);

        const verify = dbManager.getCronJob('update-me');
        expect(verify?.schedule).toBe('5 * * * *');
    });

    it('should delete a cron job', () => {
        dbManager.createCronJob({ name: 'delete-me', schedule: '*', prompt: 'bye' });
        const result = dbManager.deleteCronJob('delete-me');
        expect(result).toBe(true);

        const missing = dbManager.getCronJob('delete-me');
        expect(missing).toBeUndefined();
    });

    it('should log cron executions', () => {
        dbManager.logCronExecution({
            job_name: 'exec-job',
            started_at: '2023-01-01T00:00:00Z',
            finished_at: '2023-01-01T00:00:05Z',
            exit_code: 0,
            output_destination: 'log',
            response_preview: 'success'
        });

        const executions = dbManager.getRecentCronExecutions('exec-job');
        expect(executions).toHaveLength(1);
        expect(executions[0].job_name).toBe('exec-job');
        expect(executions[0].exit_code).toBe(0);
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

    it('should create a cron job with model field', () => {
        const job = dbManager.createCronJob({
            name: 'model-test',
            schedule: '0 9 * * *',
            prompt: 'test',
            model: 'haiku'
        });
        expect(job.model).toBe('haiku');
    });

    it('should create a cron job with null model by default', () => {
        const job = dbManager.createCronJob({
            name: 'no-model-test',
            schedule: '0 9 * * *',
            prompt: 'test'
        });
        expect(job.model).toBeNull();
    });

    it('should update a cron job model field', () => {
        dbManager.createCronJob({ name: 'update-model-test', schedule: '0 9 * * *', prompt: 'test' });
        const updated = dbManager.updateCronJob('update-model-test', { model: 'sonnet' });
        expect(updated?.model).toBe('sonnet');
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
