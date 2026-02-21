import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';

export interface ClaudeInvokeOptions {
    prompt: string;
    workingDir?: string;
    sessionId?: string;
    resume?: boolean;
    continue?: boolean;
    forkSession?: boolean;
    allowedTools?: string[];
    dangerouslySkipPermissions?: boolean;
    noSessionPersistence?: boolean;
    maxTurns?: number;
    outputFormat?: 'text' | 'json' | 'stream-json';
    model?: string;
    appendSystemPrompt?: string;
    timeout?: number;
    logger?: Logger;
}

export interface ClaudeResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    numTurns?: number;
    sessionId?: string;
}

export function buildClaudeArgs(options: ClaudeInvokeOptions): string[] {
    const {
        prompt,
        sessionId,
        resume = false,
        continue: continueSession = false,
        forkSession = false,
        allowedTools,
        dangerouslySkipPermissions = false,
        noSessionPersistence = false,
        maxTurns,
        outputFormat = 'stream-json',
        model,
        appendSystemPrompt,
    } = options;

    const args: string[] = ['-p', prompt];

    if (sessionId) args.push('--session-id', sessionId);
    if (resume) args.push('--resume');
    if (continueSession) args.push('--continue');
    if (forkSession) args.push('--fork-session');
    if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
    if (noSessionPersistence) args.push('--no-session-persistence');
    if (allowedTools && allowedTools.length > 0) {
        args.push('--allowedTools', ...allowedTools);
    }
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);

    if (model) args.push('--model', model);
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    args.push('--output-format', outputFormat);

    if (outputFormat === 'stream-json') {
        args.push('--verbose');
    }

    return args;
}

/**
 * Extract the "key argument" from a tool's input for logging purposes.
 */
function extractToolArg(toolName: string, input: Record<string, unknown>): string | undefined {
    switch (toolName) {
        case 'Read':
        case 'Write':
        case 'Edit':
            return input.file_path as string | undefined;
        case 'Glob':
            return input.pattern as string | undefined;
        case 'Grep':
            return input.pattern as string | undefined;
        case 'Bash': {
            const cmd = input.command as string | undefined;
            return cmd || undefined;
        }
        case 'WebSearch':
            return input.query as string | undefined;
        case 'WebFetch':
            return input.url as string | undefined;
        case 'Task':
            return input.description as string | undefined;
        default:
            return undefined;
    }
}

export async function invokeClaude(options: ClaudeInvokeOptions): Promise<ClaudeResult> {
    const vaultDefault = process.env.VAULT_PATH || '/vault';
    const { workingDir: requestedDir = vaultDefault, timeout = 300_000, logger } = options;
    const workingDir = existsSync(requestedDir) ? requestedDir : process.cwd();
    const args = buildClaudeArgs(options);

    if (workingDir !== requestedDir) {
        logger?.warn({ requestedDir, workingDir }, 'Requested workingDir does not exist, falling back to cwd');
    }
    logger?.debug({ args, workingDir }, 'Invoking Claude Code');

    const effectiveFormat = options.outputFormat ?? 'stream-json';

    return new Promise((resolve) => {
        let stderr = '';
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        // For stream-json: we reconstruct a final result object
        // For json/text: we collect stdout as before
        let stdout = '';
        let resultJson: Record<string, unknown> | null = null;
        let numTurns: number | undefined;
        let sessionId: string | undefined;

        // Strip ANTHROPIC_API_KEY so CLI sessions authenticate via OAuth
        // (API key is only needed by Agent SDK in invoke-api.ts)
        const { ANTHROPIC_API_KEY, ...cleanEnv } = process.env;
        const child = spawn('claude', args, {
            cwd: workingDir,
            env: cleanEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        if (effectiveFormat === 'stream-json') {
            // Line-by-line parsing of stream-json events
            const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                let parsed: Record<string, unknown>;
                try {
                    parsed = JSON.parse(trimmed);
                } catch {
                    // Skip non-JSON lines (e.g. stderr bleed, progress spinners)
                    return;
                }

                const eventType = parsed.type as string | undefined;

                // Debug: log all event types for format diagnosis
                logger?.debug({ eventType, keys: Object.keys(parsed) }, 'Stream event received');

                // Handle assistant messages — content array is at parsed.message.content
                if (eventType === 'assistant') {
                    const message = parsed.message as Record<string, unknown> | undefined;
                    const content = message?.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            handleContentEvent(block as Record<string, unknown>, logger);
                        }
                    }
                }

                // Handle tool results — they arrive as type:'user' events
                if (eventType === 'user') {
                    const message = parsed.message as Record<string, unknown> | undefined;
                    const content = message?.content;
                    if (Array.isArray(content)) {
                        for (const block of content as Record<string, unknown>[]) {
                            if (block.type === 'tool_result') {
                                const resultContent = typeof block.content === 'string'
                                    ? block.content
                                    : JSON.stringify(block.content);
                                const lines = resultContent.split('\n').length;
                                const preview = resultContent;
                                logger?.debug(
                                    { event: 'tool_result', toolUseId: block.tool_use_id, lines, preview },
                                    `Tool result: ${lines} lines`
                                );
                            }
                        }
                    }
                }

                // Capture session_id from any event (first one wins)
                if (!sessionId && parsed.session_id) {
                    sessionId = parsed.session_id as string;
                }

                // Capture the final result event
                if (eventType === 'result') {
                    resultJson = parsed;
                    numTurns = parsed.num_turns as number | undefined;
                }
            });
        } else {
            // Legacy json/text mode — collect stdout as a string
            child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        }

        if (timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                logger?.warn({ timeout }, 'Claude Code timed out');
                child.kill('SIGTERM');
                setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
            }, timeout);
        }

        child.on('error', (err) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logger?.error({ err }, 'Claude Code spawn error');
            resolve({ exitCode: -1, stdout, stderr: stderr || err.message, timedOut, numTurns, sessionId });
        });

        child.on('close', (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logger?.debug({ exitCode: code, timedOut }, 'Claude Code finished');

            // For stream-json, reconstruct a JSON string that matches the legacy format
            if (effectiveFormat === 'stream-json' && resultJson) {
                const compat: Record<string, unknown> = {
                    type: resultJson.type,
                    result: resultJson.result ?? resultJson.text,
                    text: resultJson.text ?? resultJson.result,
                    subtype: resultJson.subtype,
                    num_turns: resultJson.num_turns,
                };
                // Remove undefined keys
                for (const key of Object.keys(compat)) {
                    if (compat[key] === undefined) delete compat[key];
                }
                stdout = JSON.stringify(compat);
            }

            resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, numTurns, sessionId });
        });
    });
}

function handleContentEvent(block: Record<string, unknown>, logger?: Logger): void {
    if (block.type === 'tool_use') {
        const toolName = block.name as string || 'unknown';
        const input = (block.input as Record<string, unknown>) || {};
        const arg = extractToolArg(toolName, input);
        logger?.info({ event: 'tool_use', tool: toolName, arg }, `Tool: ${toolName}`);
    }
    if (block.type === 'text' && block.text) {
        const preview = block.text as string;
        logger?.info(
            { event: 'assistant_text', preview },
            'Assistant response'
        );
    }
}

export function parseClaudeOutput(result: ClaudeResult): unknown | null {
    if (result.exitCode !== 0 || result.timedOut) return null;
    try { return JSON.parse(result.stdout); }
    catch { return null; }
}

export function isMaxTurnsError(result: ClaudeResult): boolean {
    try {
        const parsed = JSON.parse(result.stdout);
        return parsed.subtype === 'error_max_turns';
    } catch {
        return false;
    }
}

export function extractResponseText(result: ClaudeResult): string {
    if (result.timedOut) return 'Claude Code timed out.';
    if (result.exitCode !== 0) {
        let text = `Claude Code exited with code ${result.exitCode}.`;
        if (result.stderr) text += `\n\n${result.stderr.slice(0, 500)}`;
        return text;
    }
    try {
        const parsed = JSON.parse(result.stdout);

        // Extract actual response text
        const text = parsed.result ?? parsed.text;
        if (text) return text;

        // Handle known error subtypes with no response text
        if (parsed.subtype === 'error_max_turns') {
            return `Claude ran out of turns (${parsed.num_turns ?? '?'} used). The task may be partially complete — try a follow-up message to continue.`;
        }

        // Generic fallback for parsed JSON with no text content
        if (parsed.type === 'result' && !text) {
            return `Claude finished without a response (${parsed.subtype ?? 'unknown reason'}).`;
        }

        return result.stdout || '(empty response)';
    } catch {
        return result.stdout || '(empty response)';
    }
}
