import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { IDatabase, SceneRow } from "../types.js";

export class SqliteDatabase implements IDatabase {
  private db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  async listScenes(): Promise<SceneRow[]> {
    return this.db
      .prepare("SELECT id, name, data, created_at, updated_at FROM scenes")
      .all() as SceneRow[];
  }

  async getScene(id: string): Promise<SceneRow | null> {
    const row = this.db
      .prepare("SELECT id, name, data, created_at, updated_at FROM scenes WHERE id = ?")
      .get(id) as SceneRow | undefined;
    return row ?? null;
  }

  async createScene(name: string, data: string): Promise<SceneRow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO scenes (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, name, data, now, now);
    return { id, name, data, created_at: now, updated_at: now };
  }

  async updateScene(id: string, name: string, data: string): Promise<SceneRow> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE scenes SET name = ?, data = ?, updated_at = ? WHERE id = ?")
      .run(name, data, now, id);
    if (result.changes === 0) {
      throw new Error(`Scene not found: ${id}`);
    }
    const row = this.db
      .prepare("SELECT id, name, data, created_at, updated_at FROM scenes WHERE id = ?")
      .get(id) as SceneRow;
    return row;
  }

  async deleteScene(id: string): Promise<void> {
    this.db.prepare("DELETE FROM scenes WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
