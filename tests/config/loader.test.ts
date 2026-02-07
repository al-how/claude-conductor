import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

describe('loadConfig', () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    function writeConfig(yaml: string): string {
        tempDir = mkdtempSync(join(tmpdir(), 'harness-test-'));
        const path = join(tempDir, 'config.yaml');
        writeFileSync(path, yaml);
        return path;
    }

    it('should load and validate a minimal config', () => {
        const path = writeConfig(`
telegram:
  bot_token: "abc123"
  allowed_users: [111]
`);
        const config = loadConfig(path);
        expect(config.telegram?.bot_token).toBe('abc123');
        expect(config.cron).toEqual([]);
    });

    it('should substitute environment variables', () => {
        process.env.TEST_TOKEN = 'from-env';
        const path = writeConfig(`
telegram:
  bot_token: "\${TEST_TOKEN}"
  allowed_users: [111]
`);
        const config = loadConfig(path);
        expect(config.telegram?.bot_token).toBe('from-env');
        delete process.env.TEST_TOKEN;
    });

    it('should throw on missing env var', () => {
        const path = writeConfig(`
telegram:
  bot_token: "\${DOES_NOT_EXIST}"
  allowed_users: [111]
`);
        expect(() => loadConfig(path)).toThrow('Environment variable DOES_NOT_EXIST not found');
    });

    it('should throw on missing file', () => {
        expect(() => loadConfig('/no/such/file.yaml')).toThrow('Failed to read config');
    });

    it('should throw on invalid YAML', () => {
        const path = writeConfig(': invalid: [[[');
        expect(() => loadConfig(path)).toThrow();
    });

    it('should throw on schema validation failure', () => {
        const path = writeConfig(`
telegram:
  bot_token: ""
  allowed_users: []
`);
        expect(() => loadConfig(path)).toThrow('Config validation failed');
    });
});
