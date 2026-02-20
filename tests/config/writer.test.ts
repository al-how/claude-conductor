import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateConfigField } from '../../src/config/writer.js';

describe('Config Writer', () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `writer-test-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
        configPath = join(tmpDir, 'config.yaml');
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should update a top-level field', () => {
        writeFileSync(configPath, 'model: sonnet\nvault_path: /vault\n');
        updateConfigField('model', 'opus', configPath);
        const result = readFileSync(configPath, 'utf-8');
        expect(result).toContain('model: opus');
        expect(result).toContain('vault_path: /vault');
    });

    it('should update a nested field', () => {
        writeFileSync(configPath, 'queue:\n  max_concurrent: 1\n  timeout_seconds: 300\n');
        updateConfigField('queue.max_concurrent', 3, configPath);
        const result = readFileSync(configPath, 'utf-8');
        expect(result).toContain('max_concurrent: 3');
        expect(result).toContain('timeout_seconds: 300');
    });

    it('should preserve comments', () => {
        writeFileSync(configPath, '# Main model\nmodel: sonnet  # default model\n');
        updateConfigField('model', 'haiku', configPath);
        const result = readFileSync(configPath, 'utf-8');
        expect(result).toContain('# Main model');
        expect(result).toContain('model: haiku');
    });

    it('should preserve env var placeholders in other fields', () => {
        writeFileSync(configPath, 'model: sonnet\napi:\n  anthropic_api_key: "${ANTHROPIC_API_KEY}"\n');
        updateConfigField('model', 'opus', configPath);
        const result = readFileSync(configPath, 'utf-8');
        expect(result).toContain('${ANTHROPIC_API_KEY}');
        expect(result).toContain('model: opus');
    });

    it('should handle null values', () => {
        writeFileSync(configPath, 'model: sonnet\n');
        updateConfigField('model', null, configPath);
        const result = readFileSync(configPath, 'utf-8');
        expect(result).toContain('model: null');
    });
});
