import { Cron } from 'croner';
import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { Dispatcher } from '../dispatcher/index.js';
import type { DatabaseManager, CronJobRow } from '../db/index.js';
import { extractResponseText } from '../claude/invoke.js';
import { invokeApi } from '../claude/invoke-api.js';
import { resolveModel } from '../claude/models.js';

export interface ApiConfig {
    anthropicApiKey: string;
    defaultModel?: string;
}

export interface CronSchedulerConfig {
    dispatcher: Dispatcher;
    vaultPath: string;
    logger: Logger;
    db: DatabaseManager;
    sendTelegram?: (text: string) => Promise<void>;
    globalModel?: string;
    apiConfig?: ApiConfig;
    chatId?: number;
    ollamaBaseUrl?: string;
}

export interface JobStatus {
    name: string;
    schedule: string;
    nextRun: Date | null;
    running: boolean;
}

export class CronScheduler {
    private jobs: Map<string, Cron> = new Map();
    private config: CronSchedulerConfig;
    private logger: Logger;

    constructor(config: CronSchedulerConfig) {
        this.config = config;
        this.logger = config.logger.child({ module: 'cron' });
    }

    public start(): void {
        this.logger.info('Starting Cron Scheduler');
        const jobs = this.config.db.listCronJobs();
        for (const job of jobs) {
            if (job.enabled) {
                this.addJob(job);
            }
        }
        this.logger.info({ count: this.jobs.size }, 'Loaded cron jobs');
    }

    public stop(): void {
        this.logger.info('Stopping Cron Scheduler');
        for (const job of this.jobs.values()) {
            job.stop();
        }
        this.jobs.clear();
    }

    public addJob(job: CronJobRow): void {
        // Remove existing instance if any (e.g. update)
        this.removeJob(job.name);

        if (!job.enabled) return;

        try {
            const cron = new Cron(job.schedule, {
                name: job.name,
                timezone: job.timezone,
                catch: true,
                unref: true // Don't hold the process open
            }, () => this.executeJob(job));

            this.jobs.set(job.name, cron);
            this.logger.info({ event: 'cron_scheduled', name: job.name, schedule: job.schedule, timezone: job.timezone }, 'Scheduled job');
        } catch (error) {
            this.logger.error({ err: error, name: job.name, schedule: job.schedule }, 'Failed to schedule job');
        }
    }

    public removeJob(name: string): void {
        const job = this.jobs.get(name);
        if (job) {
            job.stop();
            this.jobs.delete(name);
            this.logger.debug({ name }, 'Removed job');
        }
    }

    public getStatus(): JobStatus[] {
        const statuses: JobStatus[] = [];
        for (const [name, cron] of this.jobs) {
            statuses.push({
                name,
                schedule: cron.getPattern() || '',
                nextRun: cron.nextRun(),
                running: cron.isBusy()
            });
        }
        return statuses;
    }

    /**
     * Read the history file for a job and return previous entries as context.
     * History files live at {vaultPath}/agent-files/{jobName}-history.md
     */
    private async getHistoryContext(jobName: string): Promise<string> {
        const historyPath = join(this.config.vaultPath, 'agent-files', `${jobName}-history.md`);

        try {
            const content = (await readFile(historyPath, 'utf-8')).trim();
            if (!content) return '';
            return `\n\n---\nPREVIOUS RESULTS — do not repeat these stories/items:\n${content}\n---\n`;
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
            this.logger.warn({ err, jobName }, 'Failed to read history file');
            return '';
        }
    }

    /**
     * Append today's results to the history file with a date header.
     */
    private async appendToHistoryFile(jobName: string, responseText: string): Promise<void> {
        const historyPath = join(this.config.vaultPath, 'agent-files', `${jobName}-history.md`);
        const today = new Date().toISOString().split('T')[0];

        const dedupMarker = '---DEDUP---';
        const dedupIndex = responseText.indexOf(dedupMarker);
        let trimmedResponse: string;

        if (dedupIndex !== -1) {
            // Extract only the dedup block for history storage
            trimmedResponse = responseText.slice(dedupIndex + dedupMarker.length).trim();
        } else {
            trimmedResponse = responseText;
        }

        const entry = `\n## ${today}\n${trimmedResponse}\n`;

        try {
            await mkdir(dirname(historyPath), { recursive: true });

            let existing = '';
            try {
                existing = await readFile(historyPath, 'utf-8');
            } catch (err: unknown) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            }
            const updated = this.trimHistory(existing + entry, 14);
            await writeFile(historyPath, updated, 'utf-8');
            this.logger.debug({ jobName, historyPath }, 'Updated history file');
        } catch (err) {
            this.logger.warn({ err, jobName }, 'Failed to update history file');
        }
    }

    /**
     * Trim history entries older than `maxAgeDays` days.
     * Entries are identified by `## YYYY-MM-DD` headers.
     */
    private trimHistory(content: string, maxAgeDays: number): string {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAgeDays);

        const sections = content.split(/(?=^## \d{4}-\d{2}-\d{2})/m);
        const kept = sections.filter(section => {
            const match = section.match(/^## (\d{4}-\d{2}-\d{2})/);
            if (!match) return false; // Discard non-dated content
            return new Date(match[1]) >= cutoff;
        });

        return kept.join('').trim() + '\n';
    }

    public async triggerJob(name: string): Promise<boolean> {
        const job = this.config.db.getCronJob(name);
        if (!job) return false;
        await this.executeJob(job);
        return true;
    }

    private async executeJob(job: CronJobRow): Promise<void> {
        if (job.execution_mode === 'api') {
            await this.executeJobApi(job);
        } else {
            if (job.execution_mode !== 'cli') {
                this.logger.warn({ name: job.name, execution_mode: job.execution_mode }, 'Unknown execution_mode, defaulting to CLI');
            }
            await this.executeJobCli(job);
        }
    }

    private async executeJobApi(job: CronJobRow): Promise<void> {
        this.logger.info({ event: 'cron_triggered', name: job.name, mode: 'api' }, 'Executing cron job via API');
        const startTime = new Date().toISOString();

        if (!this.config.apiConfig) {
            this.logger.error({ name: job.name }, 'Job has execution_mode: api but no API config provided');
            return;
        }

        const historyContext = await this.getHistoryContext(job.name);
        const enrichedPrompt = job.prompt + historyContext;
        const resolved = resolveModel(job.model ?? this.config.apiConfig.defaultModel ?? this.config.globalModel ?? undefined);
        const model = resolved?.model;

        try {
            const result = await invokeApi({
                prompt: enrichedPrompt,
                workingDir: this.config.vaultPath,
                allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                maxTurns: job.max_turns || undefined,
                model,
                logger: this.logger,
            });

            const finishedAt = new Date().toISOString();

            // Log execution
            this.config.db.logCronExecution({
                job_name: job.name,
                started_at: startTime,
                finished_at: finishedAt,
                exit_code: result.error ? 1 : 0,
                timed_out: 0,
                output_destination: job.output,
                response_preview: result.text,
                error: result.error,
                cost_usd: result.costUsd
            });

            // Save to history for dedup on next run
            if (!result.error && result.text.trim()) {
                await this.appendToHistoryFile(job.name, result.text);
            }

            // Context injection: save as assistant message for Telegram context
            const chatId = this.config.chatId;
            if (chatId && result.text.trim()) {
                this.config.db.saveMessage(chatId, 'assistant', `[Background: ${job.name}]\n\n${result.text}`);
            }

            // Route output
            this.routeOutput(job, result.text);
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error({ err: error, name: job.name }, 'API cron job failed');
            this.config.db.logCronExecution({
                job_name: job.name,
                started_at: startTime,
                error: error.message,
                finished_at: new Date().toISOString(),
                exit_code: -1,
                timed_out: 0
            });
            if (this.config.sendTelegram) {
                try {
                    await this.config.sendTelegram(`[${job.name}] Error: ${error.message}`);
                } catch (telegramErr) {
                    this.logger.error({ err: telegramErr }, 'Failed to send error notification to Telegram');
                }
            }
        }
    }

    private async executeJobCli(job: CronJobRow): Promise<void> {
        this.logger.info({ event: 'cron_triggered', name: job.name, mode: 'cli' }, 'Executing cron job via CLI');
        const startTime = new Date().toISOString();

        // Inject history context into the prompt for dedup
        const historyContext = await this.getHistoryContext(job.name);
        const enrichedPrompt = job.prompt + historyContext;
        const resolved = resolveModel(job.model ?? this.config.globalModel ?? undefined);

        this.config.dispatcher.enqueue({
            id: `cron-${job.name}-${Date.now()}`,
            source: 'cron',
            prompt: enrichedPrompt,
            workingDir: this.config.vaultPath,
            logger: this.logger,
            noSessionPersistence: true,
            allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            maxTurns: job.max_turns || undefined,
            model: resolved?.model,
            providerEnv: resolved?.provider === 'ollama' ? this.getOllamaEnv() : undefined,
            outputFormat: 'stream-json',
            onComplete: async (result) => {
                const responseText = extractResponseText(result);
                const finishedAt = new Date().toISOString();

                // Log execution
                this.config.db.logCronExecution({
                    job_name: job.name,
                    started_at: startTime,
                    finished_at: finishedAt,
                    exit_code: result.exitCode,
                    timed_out: result.timedOut ? 1 : 0,
                    output_destination: job.output,
                    response_preview: responseText,
                    error: result.stderr
                });

                // Save to history for dedup on next run
                if (result.exitCode === 0 && responseText.trim()) {
                    await this.appendToHistoryFile(job.name, responseText);
                }

                // Route output
                this.routeOutput(job, responseText);
            },
            onError: async (err) => {
                this.logger.error({ err, name: job.name }, 'Cron job failed');
                this.config.db.logCronExecution({
                    job_name: job.name,
                    started_at: startTime,
                    error: err.message,
                    finished_at: new Date().toISOString(),
                    exit_code: -1
                });
                if (this.config.sendTelegram) {
                    try {
                        await this.config.sendTelegram(`[${job.name}] Error: ${err.message}`);
                    } catch (telegramErr) {
                        this.logger.error({ err: telegramErr }, 'Failed to send error notification to Telegram');
                    }
                }
            }
        });
    }

    private getOllamaEnv(): Record<string, string> {
        return {
            ANTHROPIC_BASE_URL: this.config.ollamaBaseUrl || 'http://localhost:11434',
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            ANTHROPIC_API_KEY: '',
        };
    }

    private routeOutput(job: CronJobRow, responseText: string): void {
        if (job.output === 'telegram') {
            if (this.config.sendTelegram) {
                const message = `[${job.name}]\n\n${responseText}`;
                this.config.sendTelegram(message).catch(err => {
                    this.logger.error({ err }, 'Failed to send cron output to Telegram');
                });
            } else {
                this.logger.warn({ name: job.name }, 'Job execution finished, but no Telegram bot available');
                this.logger.info({ name: job.name, output: responseText }, 'Cron Job Output');
            }
        } else if (job.output === 'log') {
            this.logger.info({ name: job.name, output: responseText }, 'Cron Job Output');
        }
        // 'silent' does nothing
    }
}
