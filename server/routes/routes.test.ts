import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { createApp } from "../app.js";
import { SqliteDatabase } from "../services/database/sqlite.js";
import { LocalBlobStorage } from "../services/blob-storage/local-fs.js";
import { InlineJobQueue } from "../services/job-queue/inline.js";

let tmpDir: string;
let db: SqliteDatabase;
let storage: LocalBlobStorage;
let queue: InlineJobQueue;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `routes-test-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  db = new SqliteDatabase(join(tmpDir, "test.db"));
  storage = new LocalBlobStorage(join(tmpDir, "blobs"));
  queue = new InlineJobQueue();
  app = createApp(db, storage, queue);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("Health", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("Scenes CRUD", () => {
  it("POST /api/scenes creates a scene", async () => {
    const res = await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Scene", data: { entities: [] } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Scene");
    expect(body.id).toBeDefined();
    expect(body.data).toEqual({ entities: [] });
  });

  it("GET /api/scenes lists scenes", async () => {
    await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "S1", data: {} }),
    });
    await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "S2", data: {} }),
    });

    const res = await app.request("/api/scenes");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(2);
    // List should not include data
    expect(list[0].data).toBeUndefined();
  });

  it("GET /api/scenes/:id returns a scene", async () => {
    const createRes = await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "S1", data: { hello: true } }),
    });
    const { id } = await createRes.json();

    const res = await app.request(`/api/scenes/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("S1");
    expect(body.data).toEqual({ hello: true });
  });

  it("GET /api/scenes/:id returns 404 for unknown", async () => {
    const res = await app.request("/api/scenes/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PUT /api/scenes/:id updates a scene", async () => {
    const createRes = await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Old", data: {} }),
    });
    const { id } = await createRes.json();

    const res = await app.request(`/api/scenes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", data: { updated: true } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("New");
    expect(body.data).toEqual({ updated: true });
  });

  it("DELETE /api/scenes/:id deletes a scene", async () => {
    const createRes = await app.request("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ToDelete", data: {} }),
    });
    const { id } = await createRes.json();

    const delRes = await app.request(`/api/scenes/${id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/api/scenes/${id}`);
    expect(getRes.status).toBe(404);
  });
});

describe("Assets", () => {
  it("POST /api/assets/upload uploads a file", async () => {
    const formData = new FormData();
    formData.append("file", new File(["pixel data"], "test.png", { type: "image/png" }));

    const res = await app.request("/api/assets/upload", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.path).toBe("textures/test.png");
  });

  it("GET /api/assets/file/* serves an uploaded file", async () => {
    const content = "hello file";
    const formData = new FormData();
    formData.append("file", new File([content], "doc.txt", { type: "text/plain" }));

    await app.request("/api/assets/upload", { method: "POST", body: formData });

    const res = await app.request("/api/assets/file/assets/doc.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(content);
  });

  it("GET /api/assets/file/* returns 404 for missing", async () => {
    const res = await app.request("/api/assets/file/nope.png");
    expect(res.status).toBe(404);
  });

  it("GET /api/assets/tree returns asset tree", async () => {
    const formData = new FormData();
    formData.append("file", new File(["px"], "a.png", { type: "image/png" }));
    await app.request("/api/assets/upload", { method: "POST", body: formData });

    const res = await app.request("/api/assets/tree");
    expect(res.status).toBe(200);
    const tree = await res.json();
    expect(tree.length).toBeGreaterThan(0);
  });

  it("DELETE /api/assets/file/* deletes an asset", async () => {
    const formData = new FormData();
    formData.append("file", new File(["px"], "del.png", { type: "image/png" }));
    const uploadRes = await app.request("/api/assets/upload", { method: "POST", body: formData });
    const { path } = await uploadRes.json();

    const delRes = await app.request(`/api/assets/file/${path}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/api/assets/file/${path}`);
    expect(getRes.status).toBe(404);
  });
});
