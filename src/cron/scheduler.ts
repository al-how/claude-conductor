import { Cron } from 'croner';
// import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Dispatcher } from '../dispatcher/index.js';
import type { DatabaseManager, CronJobRow } from '../db/index.js';
import { extractResponseText } from '../claude/invoke.js';

export interface CronSchedulerConfig {
    dispatcher: Dispatcher;
    vaultPath: string;
    logger: Logger;
    db: DatabaseManager;
    sendTelegram?: (text: string) => Promise<void>;
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
                catch: true,
                unref: true // Don't hold the process open
            }, () => this.executeJob(job));

            this.jobs.set(job.name, cron);
            this.logger.info({ name: job.name, schedule: job.schedule }, 'Scheduled job');
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

    private async executeJob(job: CronJobRow): Promise<void> {
        this.logger.info({ name: job.name }, 'Executing cron job');
        const startTime = new Date().toISOString();

        this.config.dispatcher.enqueue({
            id: `cron-${job.name}-${Date.now()}`,
            source: 'cron',
            prompt: job.prompt,
            workingDir: this.config.vaultPath,
            logger: this.logger,
            noSessionPersistence: true,
            allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            maxTurns: 25,
            outputFormat: 'json',
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
                    response_preview: responseText.slice(0, 200),
                    error: result.stderr
                });

                // Route output
                if (job.output === 'telegram') {
                    if (this.config.sendTelegram) {
                        try {
                            const message = `[${job.name}]\n\n${responseText}`;
                            await this.config.sendTelegram(message);
                        } catch (err) {
                            this.logger.error({ err }, 'Failed to send cron output to Telegram');
                        }
                    } else {
                        this.logger.warn({ name: job.name }, 'Job execution finished, but no Telegram bot available');
                        this.logger.info({ name: job.name, output: responseText }, 'Cron Job Output');
                    }
                } else if (job.output === 'log') {
                    this.logger.info({ name: job.name, output: responseText }, 'Cron Job Output');
                }
                // 'silent' does nothing
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
}
