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
}
