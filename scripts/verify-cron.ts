import { main } from '../dist/main.js';
import { DatabaseManager } from '../dist/db/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, writeFileSync } from 'node:fs';

async function verify() {
    const configPath = join(tmpdir(), `verify-config-${Date.now()}.yaml`);
    writeFileSync(configPath, `
queue:
  max_concurrent: 1
`);
    process.env.CONFIG_PATH = configPath;

    // ... rest of setup
    const dbPath = join(tmpdir(), `verify-cron-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;
    process.env.PORT = '3001'; // Use different port
    process.env.LOG_LEVEL = 'error'; // Reduce noise

    console.log('Starting system...');
    const { app, scheduler, db } = await main();

    try {
        console.log('System started. Creating cron job via API...');

        // 1. Create Job
        const createRes = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload: {
                name: 'test-cron',
                schedule: '* * * * * *', // Run every second (using croner's extended syntax if supported, or just * * * * * which is minutely)
                // Croner supports 6 digits for seconds? Yes.
                // But let's check if scheduler supports it.
                // If not, we wait a minute? That's too long.
                // Croner supports seconds if pattern has 6 parts.
                prompt: 'echo "hello world"',
                output: 'log'
            }
        });

        if (createRes.statusCode !== 201) {
            throw new Error(`Failed to create job: ${createRes.payload}`);
        }
        console.log('Job created. Waiting for execution (10s)...');

        // 2. Wait for execution
        await new Promise(r => setTimeout(r, 10000));

        console.log('Checking DB for execution...');
        // 3. Check DB for execution
        const executions = db!.getRecentCronExecutions('test-cron');
        console.log(`Found ${executions.length} executions.`);

        if (executions.length > 0) {
            console.log('Verification PASSED: Job executed.');
            console.log('Execution result:', JSON.stringify(executions[0], null, 2));
        } else {
            console.error('Verification FAILED: No executions found.');
            const allExecutions = db!.getRecentCronExecutions();
            console.log('All executions:', JSON.stringify(allExecutions, null, 2));
        }

    } catch (e) {
        console.error('Verification failed with error:', e);
    } finally {
        console.log('Cleaning up...');
        await app.close();
        scheduler!.stop();
        if (db) db.close();
        try { unlinkSync(dbPath); } catch { }
        try { unlinkSync(process.env.CONFIG_PATH!); } catch { }
    }
}

verify();
