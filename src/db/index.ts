import Database from 'better-sqlite3';

import type { Logger } from 'pino';

export interface ConversationMessage {
    id: number;
    chat_id: number;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

export class DatabaseManager {
    private db: Database.Database;
    private logger?: Logger;

    constructor(dbPath: string, logger?: Logger) {
        this.logger = logger;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.init();
    }

    private init() {
        try {
            // In production/container, schema should be loaded from file
            // For simplicity here, we'll embed the schema loading or assume it's next to this file
            // In a real build, we'd need to make sure schema.sql is copied to dist/

            // For now, let's use the schema definition directly or read from file if we can resolve it
            // To be robust across raw ts-node and built js, let's try to read relative to __dirname
            // But since we are using ESM, __dirname is not available directly without some work.
            // Let's hardcode the schema for reliability in this phase, or better, allow passing schema path.

            // Actually, reading from file is better for maintenance.
            // We will assume the schema.sql is in the same directory.
            // When running via tsx, it's in src/db/schema.sql
            // When running via node dist/..., it should be in dist/db/schema.sql

            // Let's just execute the SQL directly here to avoid fs issues for now, matching the plan's schema
            const schema = `
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER NOT NULL,
          role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_chat_id ON conversations(chat_id);

        CREATE TABLE IF NOT EXISTS cron_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          schedule TEXT NOT NULL,
          prompt TEXT NOT NULL,
          output TEXT DEFAULT 'telegram',
          enabled INTEGER DEFAULT 1,
          timezone TEXT DEFAULT 'America/Chicago',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cron_executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          exit_code INTEGER,
          timed_out INTEGER DEFAULT 0,
          output_destination TEXT,
          response_preview TEXT,
          error TEXT
        );
      `;

            this.db.exec(schema);
            this.logger?.debug('Database initialized and migrations run');
        } catch (error) {
            this.logger?.error({ err: error }, 'Failed to initialize database');
            throw error;
        }
    }

    public saveMessage(chatId: number, role: 'user' | 'assistant', content: string): void {
        const stmt = this.db.prepare(
            'INSERT INTO conversations (chat_id, role, content) VALUES (?, ?, ?)'
        );
        stmt.run(chatId, role, content);
    }

    public getRecentContext(chatId: number, limit: number = 25): ConversationMessage[] {
        const stmt = this.db.prepare(
            'SELECT * FROM conversations WHERE chat_id = ? ORDER BY id DESC LIMIT ?'
        );
        const rows = stmt.all(chatId, limit) as ConversationMessage[];
        // Return in chronological order (oldest first) for context injection
        return rows.reverse();
    }

    public close() {
        this.db.close();
    }

    // Cron Jobs
    public createCronJob(job: { name: string; schedule: string; prompt: string; output?: string; enabled?: number; timezone?: string }): CronJobRow {
        const stmt = this.db.prepare(
            'INSERT INTO cron_jobs (name, schedule, prompt, output, enabled, timezone) VALUES (?, ?, ?, ?, ?, ?)'
        );
        stmt.run(job.name, job.schedule, job.prompt, job.output || 'telegram', job.enabled ?? 1, job.timezone || 'America/Chicago');
        return this.getCronJob(job.name)!;
    }

    public getCronJob(name: string): CronJobRow | undefined {
        const stmt = this.db.prepare('SELECT * FROM cron_jobs WHERE name = ?');
        return stmt.get(name) as CronJobRow | undefined;
    }

    public listCronJobs(): CronJobRow[] {
        const stmt = this.db.prepare('SELECT * FROM cron_jobs');
        return stmt.all() as CronJobRow[];
    }

    public updateCronJob(name: string, updates: Partial<Omit<CronJobRow, 'id' | 'created_at' | 'updated_at'>>): CronJobRow | undefined {
        const current = this.getCronJob(name);
        if (!current) return undefined;

        const fields: string[] = [];
        const values: any[] = [];

        if (updates.schedule !== undefined) { fields.push('schedule = ?'); values.push(updates.schedule); }
        if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }
        if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled); }
        if (updates.timezone !== undefined) { fields.push('timezone = ?'); values.push(updates.timezone); }

        if (fields.length === 0) return current;

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(name);

        const stmt = this.db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE name = ?`);
        stmt.run(...values);

        return this.getCronJob(name);
    }

    public deleteCronJob(name: string): boolean {
        const stmt = this.db.prepare('DELETE FROM cron_jobs WHERE name = ?');
        const result = stmt.run(name);
        return result.changes > 0;
    }

    public logCronExecution(entry: { job_name: string; started_at: string; finished_at?: string; exit_code?: number; timed_out?: number; output_destination?: string; response_preview?: string; error?: string }): void {
        const stmt = this.db.prepare(
            `INSERT INTO cron_executions 
       (job_name, started_at, finished_at, exit_code, timed_out, output_destination, response_preview, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
            entry.job_name,
            entry.started_at,
            entry.finished_at || null,
            entry.exit_code ?? null,
            entry.timed_out ?? 0,
            entry.output_destination ?? null,
            entry.response_preview ?? null,
            entry.error ?? null
        );
    }

    public getRecentCronExecutions(jobName?: string, limit: number = 20): CronExecution[] {
        let sql = 'SELECT * FROM cron_executions';
        const params: (string | number)[] = [];
        if (jobName) {
            sql += ' WHERE job_name = ?';
            params.push(jobName);
        }
        sql += ' ORDER BY id DESC LIMIT ?';
        params.push(limit);
        const stmt = this.db.prepare(sql);
        return stmt.all(...params) as CronExecution[];
    }
}

export interface CronJobRow {
    id: number;
    name: string;
    schedule: string;
    prompt: string;
    output: string;
    enabled: number;
    timezone: string;
    created_at: string;
    updated_at: string;
}

export interface CronExecution {
    id: number;
    job_name: string;
    started_at: string;
    finished_at: string | null;
    exit_code: number | null;
    timed_out: number;
    output_destination: string | null;
    response_preview: string | null;
    error: string | null;
}
