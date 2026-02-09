import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';

export interface ClaudeInvokeOptions {
    prompt: string;
    workingDir?: string;
    sessionId?: string;
    resume?: boolean;
    allowedTools?: string[];
    dangerouslySkipPermissions?: boolean;
    noSessionPersistence?: boolean;
    maxTurns?: number;
    outputFormat?: 'text' | 'json' | 'stream-json';
    appendSystemPrompt?: string;
    timeout?: number;
    logger?: Logger;
}

export interface ClaudeResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

export function buildClaudeArgs(options: ClaudeInvokeOptions): string[] {
    const {
        prompt,
        sessionId,
        resume = false,
        allowedTools,
        dangerouslySkipPermissions = false,
        noSessionPersistence = false,
        maxTurns = 25,
        outputFormat = 'json',
        appendSystemPrompt,
    } = options;

    const args: string[] = ['-p', prompt];

    if (sessionId) args.push('--session-id', sessionId);
    if (resume) args.push('--resume');
    if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
    if (noSessionPersistence) args.push('--no-session-persistence');
    if (allowedTools && allowedTools.length > 0) {
        args.push('--allowedTools', ...allowedTools);
    }
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);

    args.push('--max-turns', String(maxTurns));
    args.push('--output-format', outputFormat);

    return args;
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

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const child = spawn('claude', args, {
            cwd: workingDir,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

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
            resolve({ exitCode: -1, stdout, stderr: stderr || err.message, timedOut });
        });

        child.on('close', (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logger?.debug({ exitCode: code, timedOut }, 'Claude Code finished');
            resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
        });
    });
}


export function parseClaudeOutput(result: ClaudeResult): unknown | null {
    if (result.exitCode !== 0 || result.timedOut) return null;
    try { return JSON.parse(result.stdout); }
    catch { return null; }
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
