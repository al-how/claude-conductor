import { DatabaseManager } from './src/db/index.js';
import { join } from 'path';
import { tmpdir } from 'os';

const dbPath = join(tmpdir(), `debug-db-${Date.now()}.sqlite`);
console.log('DB Path:', dbPath);
const db = new DatabaseManager(dbPath);

try {
    console.log('Creating job...');
    db.createCronJob({ name: 'test', schedule: '*', prompt: 'p' });
    console.log('Logging execution...');
    db.logCronExecution({
        job_name: 'test',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        exit_code: 0,
        output_destination: 'log',
        response_preview: 'success'
    });
    console.log('Done.');
} catch (e) {
    console.error('ERROR:', e);
}
