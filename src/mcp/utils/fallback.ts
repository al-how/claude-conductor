import type { McpLogger } from '../backends/types.js';

/**
 * Try primary function, fall back to secondary on failure.
 * Returns the result from whichever succeeds first.
 * If all fail, returns the structured error from errorFn.
 */
export async function withFallback<T>(
    steps: Array<{ name: string; fn: () => Promise<T> }>,
    logger: McpLogger,
): Promise<T> {
    let lastError: Error | undefined;

    for (const step of steps) {
        try {
            logger.info({ backend: step.name }, `Trying backend: ${step.name}`);
            const result = await step.fn();
            logger.info({ backend: step.name }, `Backend succeeded: ${step.name}`);
            return result;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            logger.warn({ backend: step.name, err: lastError.message }, `Backend failed: ${step.name}`);
        }
    }

    throw lastError ?? new Error('All backends failed');
}
