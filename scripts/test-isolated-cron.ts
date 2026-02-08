
import { DatabaseManager } from '../dist/db/index.js';
import { CronScheduler } from '../dist/cron/scheduler.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { createLogger } from '../dist/logger.js';

async function test() {
    const dbPath = join(tmpdir(), `iso-cron-${Date.now()}.db`);
    const logger = createLogger({ level: 'debug' });
    const db = new DatabaseManager(dbPath, logger);

    // Mock dispatcher
    const dispatcher = {
        enqueue: async (task: any) => {
            console.log('MOCK Dispatcher: Task received');
            // Simulate async execution
            setTimeout(() => {
                try {
                    if (task.onComplete) {
                        task.onComplete({
                            result: {
                                stdout: 'mock output',
                                stderr: '',
                                exitCode: 0
                            }
                        });
                    }
                } catch (e) {
                    console.error('Callback error:', e);
                }
            }, 100);
            return 'mock-id';
        },
        getTaskParams: (id: string) => ({}),
        getTaskResult: (id: string) => ({ status: 'completed', result: { exitCode: 0, stdout: 'mock output', stderr: '' } })
    } as any;

    const scheduler = new CronScheduler({
        dispatcher,
        vaultPath: '/tmp/vault',
        logger,
        db,
        sendTelegram: async (msg) => console.log('MOCK Telegram:', msg)
    });

    console.log('Starting scheduler...');
    scheduler.start();

    console.log('Adding job...');
    const job = db.createCronJob({
        name: 'iso-job',
        schedule: '* * * * * *', // Every second
        prompt: 'test prompt',
        output: 'log'
    });
    scheduler.addJob(job);

    console.log('Waiting 5s...');
    await new Promise(r => setTimeout(r, 5000));

    const executions = db.getRecentCronExecutions('iso-job');
    console.log(`Found ${executions.length} executions.`);

    scheduler.stop();
    db.close();
    try { unlinkSync(dbPath); } catch { }

    if (executions.length > 0) {
        console.log('SUCCESS');
    } else {
        console.error('FAILURE');
        process.exit(1);
    }
}

test();
