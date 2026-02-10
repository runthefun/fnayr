import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { LocalBlobStorage } from "./local-fs.js";

function makeTmpDir(): string {
  return join(tmpdir(), `blob-test-${randomUUID()}`);
}

describe("LocalBlobStorage", () => {
  const dirs: string[] = [];

  function createStorage(): LocalBlobStorage {
    const dir = makeTmpDir();
    dirs.push(dir);
    return new LocalBlobStorage(dir);
  }

  afterEach(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    dirs.length = 0;
  });

  it("write then read: data and mime match", async () => {
    const storage = createStorage();
    const data = Buffer.from("hello world");
    const meta = await storage.write("test.png", data, "image/png");

    expect(meta).toEqual({ path: "test.png", mime: "image/png", size: data.length });

    const result = await storage.read("test.png");
    expect(result).not.toBeNull();
    expect(result!.data).toEqual(data);
    expect(result!.mime).toBe("image/png");
  });

  it("read nonexistent file returns null", async () => {
    const storage = createStorage();
    const result = await storage.read("does-not-exist.png");
    expect(result).toBeNull();
  });

  it("write creates parent directories", async () => {
    const storage = createStorage();
    const data = Buffer.from("nested content");
    await storage.write("sub/deep/file.txt", data, "text/plain");

    const result = await storage.read("sub/deep/file.txt");
    expect(result).not.toBeNull();
    expect(result!.data).toEqual(data);
  });

  it("delete file: exists returns false after", async () => {
    const storage = createStorage();
    const data = Buffer.from("to be deleted");
    await storage.write("deleteme.png", data, "image/png");

    expect(await storage.exists("deleteme.png")).toBe(true);

    await storage.remove("deleteme.png");

    expect(await storage.exists("deleteme.png")).toBe(false);
  });

  it("remove nonexistent file does not throw", async () => {
    const storage = createStorage();
    await expect(storage.remove("nope.txt")).resolves.toBeUndefined();
  });

  it("list returns correct tree structure", async () => {
    const storage = createStorage();
    await storage.write("textures/brick.png", Buffer.from("a"), "image/png");
    await storage.write("textures/stone.png", Buffer.from("b"), "image/png");
    await storage.write("models/cube.glb", Buffer.from("c"), "model/gltf-binary");
    await storage.write("readme.txt", Buffer.from("d"), "text/plain");

    const tree = await storage.list();

    // Directories come first, sorted alphabetically, then files
    expect(tree).toEqual([
      {
        kind: "directory",
        name: "models",
        path: "models",
        children: [{ kind: "file", name: "cube.glb", path: "models/cube.glb" }],
      },
      {
        kind: "directory",
        name: "textures",
        path: "textures",
        children: [
          { kind: "file", name: "brick.png", path: "textures/brick.png" },
          { kind: "file", name: "stone.png", path: "textures/stone.png" },
        ],
      },
      { kind: "file", name: "readme.txt", path: "readme.txt" },
    ]);
  });

  it("path traversal rejection: ../etc/passwd throws", async () => {
    const storage = createStorage();
    await expect(storage.read("../etc/passwd")).rejects.toThrow("Path traversal not allowed");
    await expect(storage.write("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(
      "Path traversal not allowed",
    );
    await expect(storage.remove("../etc/passwd")).rejects.toThrow("Path traversal not allowed");
    await expect(storage.exists("../etc/passwd")).rejects.toThrow("Path traversal not allowed");
  });

  it("exists: true for existing, false for non-existing", async () => {
    const storage = createStorage();
    expect(await storage.exists("nope.png")).toBe(false);

    await storage.write("yes.png", Buffer.from("data"), "image/png");
    expect(await storage.exists("yes.png")).toBe(true);
  });
});
