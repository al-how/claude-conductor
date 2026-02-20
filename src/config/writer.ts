import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

/**
 * Update a field in the YAML config file, preserving comments and env var placeholders.
 * Uses yaml library's Document API to modify in-place.
 *
 * @param dotPath - Dot-separated path like "queue.max_concurrent" or "model"
 * @param value - The new value to set
 * @param configPath - Path to the YAML file (defaults to CONFIG_PATH env var)
 */
export function updateConfigField(dotPath: string, value: unknown, configPath?: string): void {
    const filePath = configPath ?? process.env.CONFIG_PATH ?? '/config/config.yaml';
    const raw = readFileSync(filePath, 'utf-8');
    const doc = parseDocument(raw);

    const keys = dotPath.split('.');
    doc.setIn(keys, value);

    writeFileSync(filePath, doc.toString(), 'utf-8');
}
