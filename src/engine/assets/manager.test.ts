import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "./manager";
import type { AssetLoader } from "./types";

/** Helper: a loader that returns a controllable promise. */
function deferredLoader() {
  const disposed: unknown[] = [];
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;

  const loader: AssetLoader<unknown> = {
    load: vi.fn(
      () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    ),
    dispose: vi.fn((asset) => disposed.push(asset)),
  };

  return { loader, resolve: (v: unknown) => resolve(v), reject: (e: Error) => reject(e), disposed };
}

/** Helper: a loader that resolves immediately with the given value. */
function immediateLoader(value: unknown = "ASSET") {
  const disposed: unknown[] = [];
  const loader: AssetLoader<unknown> = {
    load: vi.fn(() => Promise.resolve(value)),
    dispose: vi.fn((asset) => disposed.push(asset)),
  };
  return { loader, disposed };
}

/** Flush microtask queue so promises settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AssetManager", () => {
  // ── cacheKey ──────────────────────────────────────────────
  it("cacheKey static method works correctly", () => {
    expect(AssetManager.cacheKey("texture", "foo.png")).toBe("texture::foo.png");
    expect(AssetManager.cacheKey("glb", "model.glb")).toBe("glb::model.glb");
  });

  // ── hasLoader ─────────────────────────────────────────────
  it("hasLoader returns true/false correctly", () => {
    const mgr = new AssetManager();
    const { loader } = immediateLoader();

    expect(mgr.hasLoader("texture")).toBe(false);
    mgr.registerLoader("texture", loader);
    expect(mgr.hasLoader("texture")).toBe(true);
    expect(mgr.hasLoader("glb")).toBe(false);
  });

  // ── request throws on unregistered type ───────────────────
  it("request with unregistered type throws", () => {
    const mgr = new AssetManager();
    expect(() => mgr.request("texture", "foo.png")).toThrow(
      'No loader registered for asset type "texture"',
    );
  });

  // ── dedup request / refcount ──────────────────────────────
  it("dedup request increments refCount, single load call", () => {
    const mgr = new AssetManager();
    const { loader } = deferredLoader();
    mgr.registerLoader("texture", loader);

    const e1 = mgr.request("texture", "a.png");
    const e2 = mgr.request("texture", "a.png");

    expect(e1).toBe(e2);
    expect(e1.refCount).toBe(2);
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  // ── same URI different options => one cache entry ─────────
  it("same URI different options shares one cache entry", () => {
    const mgr = new AssetManager();
    const { loader } = deferredLoader();
    mgr.registerLoader("texture", loader);

    const e1 = mgr.request("texture", "a.png", { quality: "high" });
    const e2 = mgr.request("texture", "a.png", { quality: "low" });

    expect(e1).toBe(e2);
    expect(e1.refCount).toBe(2);
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  // ── ready transition + drainReady ─────────────────────────
  it("ready transition populates drainReady, second drain is empty", async () => {
    const mgr = new AssetManager();
    const { loader } = immediateLoader("IMG");
    mgr.registerLoader("texture", loader);

    mgr.request("texture", "a.png");
    await flush();

    const key = AssetManager.cacheKey("texture", "a.png");
    const ready1 = mgr.drainReady();
    expect(ready1.has(key)).toBe(true);
    expect(ready1.size).toBe(1);

    const ready2 = mgr.drainReady();
    expect(ready2.size).toBe(0);

    const entry = mgr.peek(key);
    expect(entry?.status).toBe("ready");
    expect(entry?.asset).toBe("IMG");
  });

  // ── failed transition + drainFailed ───────────────────────
  it("failed transition populates drainFailed, second drain is empty", async () => {
    const mgr = new AssetManager();
    const { loader, reject } = deferredLoader();
    mgr.registerLoader("texture", loader);

    mgr.request("texture", "bad.png");
    reject(new Error("404"));
    await flush();

    const key = AssetManager.cacheKey("texture", "bad.png");
    const failed1 = mgr.drainFailed();
    expect(failed1.has(key)).toBe(true);
    expect(failed1.size).toBe(1);

    const failed2 = mgr.drainFailed();
    expect(failed2.size).toBe(0);

    const entry = mgr.peek(key);
    expect(entry?.status).toBe("error");
    expect(entry?.error?.message).toBe("404");
  });

  // ── release to zero disposes and evicts ───────────────────
  it("release to zero disposes asset and evicts from cache", async () => {
    const mgr = new AssetManager();
    const { loader, disposed } = immediateLoader("TEX");
    mgr.registerLoader("texture", loader);

    const key = AssetManager.cacheKey("texture", "a.png");
    mgr.request("texture", "a.png");
    await flush();

    expect(mgr.peek(key)?.status).toBe("ready");

    mgr.release(key);
    expect(mgr.peek(key)).toBeUndefined();
    expect(disposed).toEqual(["TEX"]);
  });

  // ── release on missing key is no-op ───────────────────────
  it("release on missing key is a no-op", () => {
    const mgr = new AssetManager();
    // Should not throw
    mgr.release("texture::nonexistent.png");
  });

  // ── release during load → stale settle safety ─────────────
  it("release during load: settled asset is disposed, not added to ready set", async () => {
    const mgr = new AssetManager();
    const { loader, resolve, disposed } = deferredLoader();
    mgr.registerLoader("texture", loader);

    const key = AssetManager.cacheKey("texture", "a.png");
    mgr.request("texture", "a.png");

    // Release while still loading → entry evicted from cache
    mgr.release(key);
    expect(mgr.peek(key)).toBeUndefined();

    // Now the promise settles
    resolve("LATE_ASSET");
    await flush();

    // Asset should have been disposed by stale-settle guard
    expect(disposed).toEqual(["LATE_ASSET"]);
    // Should NOT appear in ready set
    expect(mgr.drainReady().size).toBe(0);
    // Cache still empty
    expect(mgr.peek(key)).toBeUndefined();
  });

  // ── release then re-request before old settles ────────────
  it("release then re-request: old settle disposes old asset, does not corrupt new entry", async () => {
    const mgr = new AssetManager();

    // We need two separate deferred loaders for the two requests
    const disposed: unknown[] = [];
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    let callCount = 0;

    const loader: AssetLoader<unknown> = {
      load: vi.fn(
        () =>
          new Promise((res) => {
            callCount++;
            if (callCount === 1) resolveFirst = res;
            else resolveSecond = res;
          }),
      ),
      dispose: vi.fn((asset) => disposed.push(asset)),
    };
    mgr.registerLoader("texture", loader);

    const key = AssetManager.cacheKey("texture", "a.png");

    // First request
    const entry1 = mgr.request("texture", "a.png");

    // Release (entry evicted while in-flight)
    mgr.release(key);
    expect(mgr.peek(key)).toBeUndefined();

    // Re-request → new entry, new load call
    const entry2 = mgr.request("texture", "a.png");
    expect(entry2).not.toBe(entry1);
    expect(loader.load).toHaveBeenCalledTimes(2);

    // Old promise settles → stale-settle guard fires
    resolveFirst("OLD_ASSET");
    await flush();

    expect(disposed).toEqual(["OLD_ASSET"]);
    // New entry untouched
    expect(entry2.status).toBe("loading");
    expect(entry2.asset).toBeUndefined();
    // Old asset not in ready set
    expect(mgr.drainReady().size).toBe(0);

    // New promise settles normally
    resolveSecond("NEW_ASSET");
    await flush();

    expect(entry2.status).toBe("ready");
    expect(entry2.asset).toBe("NEW_ASSET");
    expect(mgr.drainReady().has(key)).toBe(true);
  });

  // ── invalidate error entry ────────────────────────────────
  it("invalidate removes error entry, allows retry", async () => {
    const mgr = new AssetManager();
    const { loader, reject } = deferredLoader();
    mgr.registerLoader("texture", loader);

    const key = AssetManager.cacheKey("texture", "fail.png");
    mgr.request("texture", "fail.png");
    reject(new Error("oops"));
    await flush();

    expect(mgr.peek(key)?.status).toBe("error");

    mgr.invalidate(key);
    expect(mgr.peek(key)).toBeUndefined();
  });

  // ── invalidate missing / non-error is no-op ───────────────
  it("invalidate on missing or non-error key is a no-op", async () => {
    const mgr = new AssetManager();
    const { loader } = immediateLoader("OK");
    mgr.registerLoader("texture", loader);

    const key = AssetManager.cacheKey("texture", "a.png");
    mgr.request("texture", "a.png");
    await flush();

    // Non-error entry → no-op
    mgr.invalidate(key);
    expect(mgr.peek(key)?.status).toBe("ready");

    // Missing key → no-op, no throw
    mgr.invalidate("texture::nope.png");
  });

  // ── stats counts ──────────────────────────────────────────
  it("getStats returns correct counts", async () => {
    const mgr = new AssetManager();
    const { loader: imm } = immediateLoader("OK");
    const { loader: def, reject } = deferredLoader();

    mgr.registerLoader("texture", imm);
    mgr.registerLoader("glb", def);

    mgr.request("texture", "a.png");
    mgr.request("glb", "model.glb");

    // Before any settle: 1 loading (texture promise not yet flushed), 1 loading (glb deferred)
    // Actually texture's promise is micro-task-resolved but not yet flushed
    expect(mgr.getStats().total).toBe(2);

    await flush();
    // texture resolved, glb still loading
    expect(mgr.getStats()).toEqual({ total: 2, loading: 1, ready: 1, error: 0 });

    reject(new Error("fail"));
    await flush();
    expect(mgr.getStats()).toEqual({ total: 2, loading: 0, ready: 1, error: 1 });
  });

  // ── dispose cleans up all entries ─────────────────────────
  it("dispose cleans up all entries", async () => {
    const mgr = new AssetManager();
    const { loader, disposed } = immediateLoader("A");
    mgr.registerLoader("texture", loader);

    mgr.request("texture", "a.png");
    mgr.request("texture", "b.png");
    await flush();

    mgr.dispose();

    expect(disposed).toEqual(["A", "A"]);
    expect(mgr.peek(AssetManager.cacheKey("texture", "a.png"))).toBeUndefined();
    expect(mgr.peek(AssetManager.cacheKey("texture", "b.png"))).toBeUndefined();
    expect(mgr.drainReady().size).toBe(0);
    expect(mgr.drainFailed().size).toBe(0);
  });
});
