import { invokeClaude } from '../src/claude/invoke.js';
import { createLogger } from '../src/logger.js';

async function run() {
    const logger = createLogger({ level: 'debug' });
    console.log('Testing invokeClaude...');

    try {
        const result = await invokeClaude({
            prompt: 'Hello, are you working?',
            maxTurns: 1,
            logger
        });

        console.log('--- Result ---');
        console.log('Exit Code:', result.exitCode);
        console.log('Stdout:', result.stdout);
        console.log('Stderr:', result.stderr);

        if (result.exitCode === 0) {
            console.log('✅ Success! Claude is working and authenticated.');
        } else {
            console.log('❌ Failed.');
        }
    } catch (e) {
        console.error('Exception:', e);
    }
}

run();
