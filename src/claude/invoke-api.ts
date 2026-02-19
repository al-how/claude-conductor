import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess, SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';

export interface ApiInvokeOptions {
    prompt: string;
    workingDir: string;
    allowedTools?: string[];
    maxTurns?: number;
    model?: string;
    logger: Logger;
    timeoutMs?: number;
}

export interface ApiResult {
    text: string;
    numTurns: number;
    costUsd: number;
    error?: string;
}

export async function invokeApi(options: ApiInvokeOptions): Promise<ApiResult> {
    const { prompt, workingDir, allowedTools, maxTurns, model, logger, timeoutMs = 300_000 } = options;

    logger.info({ model, maxTurns, workingDir, timeoutMs }, 'Starting API cron execution');

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        const conversation = query({
            prompt,
            options: {
                cwd: workingDir,
                allowedTools: allowedTools ?? ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                model,
                maxTurns,
                persistSession: false,
                abortController,
            }
        });

        let resultText = '';
        let numTurns = 0;
        let costUsd = 0;
        let error: string | undefined;

        for await (const message of conversation) {
            if (message.type === 'result') {
                numTurns = message.num_turns;
                costUsd = message.total_cost_usd;

                if (message.subtype === 'success') {
                    resultText = (message as SDKResultSuccess).result ?? '';
                } else {
                    const errorResult = message as SDKResultError;
                    error = errorResult.subtype;
                    // Some error results may still have partial output in errors array
                    if (errorResult.errors?.length) {
                        resultText = errorResult.errors.join('\n');
                    }
                }
            }
        }

        logger.info({ numTurns, costUsd, textLength: resultText.length, error }, 'API cron execution completed');

        return { text: resultText, numTurns, costUsd, error };
    } finally {
        clearTimeout(timer);
    }
}
