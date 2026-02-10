import { describe, it, expect, afterEach } from "vitest";
import { SqliteDatabase } from "./sqlite.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

describe("SqliteDatabase", () => {
  let db: SqliteDatabase;
  let dbPath: string;

  function createDb() {
    dbPath = path.join(os.tmpdir(), `fnayr-test-${crypto.randomUUID()}.db`);
    db = new SqliteDatabase(dbPath);
    return db;
  }

  afterEach(() => {
    try {
      db?.close();
    } catch {
      // already closed
    }
    try {
      if (dbPath) fs.unlinkSync(dbPath);
    } catch {
      // file may not exist
    }
  });

  it("creates a scene with id, name, data, and timestamps", async () => {
    createDb();
    const scene = await db.createScene("My Scene", '{"entities":[]}');

    expect(scene.id).toBeDefined();
    expect(typeof scene.id).toBe("string");
    expect(scene.id.length).toBeGreaterThan(0);
    expect(scene.name).toBe("My Scene");
    expect(scene.data).toBe('{"entities":[]}');
    expect(scene.created_at).toBeDefined();
    expect(scene.updated_at).toBeDefined();
    expect(scene.created_at).toBe(scene.updated_at);
  });

  it("gets a scene by id", async () => {
    createDb();
    const created = await db.createScene("Test", "{}");
    const fetched = await db.getScene(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Test");
    expect(fetched!.data).toBe("{}");
    expect(fetched!.created_at).toBe(created.created_at);
    expect(fetched!.updated_at).toBe(created.updated_at);
  });

  it("returns null for a nonexistent scene", async () => {
    createDb();
    const result = await db.getScene("nonexistent-id");
    expect(result).toBeNull();
  });

  it("lists all created scenes", async () => {
    createDb();
    await db.createScene("Scene A", '{"a":1}');
    await db.createScene("Scene B", '{"b":2}');
    await db.createScene("Scene C", '{"c":3}');

    const scenes = await db.listScenes();
    expect(scenes).toHaveLength(3);

    const names = scenes.map((s) => s.name);
    expect(names).toContain("Scene A");
    expect(names).toContain("Scene B");
    expect(names).toContain("Scene C");
  });

  it("updates a scene name and data", async () => {
    createDb();
    const original = await db.createScene("Old Name", '{"old":true}');

    // Small delay to ensure updated_at differs
    await new Promise((r) => setTimeout(r, 10));

    const updated = await db.updateScene(original.id, "New Name", '{"new":true}');

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe("New Name");
    expect(updated.data).toBe('{"new":true}');
    expect(updated.created_at).toBe(original.created_at);
    expect(updated.updated_at).not.toBe(original.updated_at);
  });

  it("deletes a scene so it is no longer retrievable", async () => {
    createDb();
    const scene = await db.createScene("To Delete", "{}");

    await db.deleteScene(scene.id);

    const result = await db.getScene(scene.id);
    expect(result).toBeNull();
  });
});
