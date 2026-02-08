import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { AssetManager } from "./manager";
import type { AssetLoader } from "./types";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const TYPE = "test";
const URIS = ["a", "b", "c", "d"];

// ─── Controllable loader ──────────────────────────────────

type PendingPromise = {
  uri: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

function createControllableLoader() {
  const pending: PendingPromise[] = [];
  const disposed: unknown[] = [];
  const loader: AssetLoader<unknown> = {
    load: (uri: string) =>
      new Promise((resolve, reject) => {
        pending.push({ uri, resolve, reject });
      }),
    dispose: (asset) => disposed.push(asset),
  };
  return { loader, pending, disposed };
}

// ─── Model ────────────────────────────────────────────────

type ModelEntry = {
  refCount: number;
  status: "loading" | "ready" | "error";
  generation: number;
};

type Model = {
  entries: Map<string, ModelEntry>;
  pendingLoads: Array<{ uri: string; key: string; generation: number }>;
  nextGen: number;
  expectedDisposals: number;
};

function initModel(): Model {
  return { entries: new Map(), pendingLoads: [], nextGen: 0, expectedDisposals: 0 };
}

type Real = { mgr: AssetManager; pending: PendingPromise[]; disposed: unknown[] };

// ─── Invariant checks ─────────────────────────────────────

function assertInvariants(model: Model, { mgr, pending, disposed }: Real) {
  const stats = mgr.getStats();

  // Stats internal consistency
  expect(stats.total).toBe(stats.loading + stats.ready + stats.error);

  // Entry count matches model
  expect(stats.total).toBe(model.entries.size);

  // Per-key checks
  for (const [key, m] of model.entries) {
    const r = mgr.peek(key);
    expect(r, `missing entry for ${key}`).toBeDefined();
    expect(r!.refCount).toBe(m.refCount);
    expect(r!.status).toBe(m.status);
    expect(r!.refCount).toBeGreaterThan(0);

    // Structural: status ↔ fields coherence
    if (r!.status === "loading") {
      expect(r!.asset).toBeUndefined();
    }
    if (r!.status === "ready") {
      expect(r!.asset).toBeDefined();
    }
    if (r!.status === "error") {
      expect(r!.error).toBeDefined();
    }
  }

  // No ghost entries
  for (const uri of URIS) {
    const key = AssetManager.cacheKey(TYPE, uri);
    if (!model.entries.has(key)) {
      expect(mgr.peek(key)).toBeUndefined();
    }
  }

  // Disposal count matches expectations
  expect(disposed.length).toBe(model.expectedDisposals);

  // Pending loads in sync between model and real
  expect(pending.length).toBe(model.pendingLoads.length);
}

// ─── Commands ─────────────────────────────────────────────

class RequestCmd implements fc.AsyncCommand<Model, Real> {
  constructor(readonly uri: string) {}
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    const isNew = !m.entries.has(key);
    r.mgr.request(TYPE, this.uri);
    if (isNew) {
      const gen = m.nextGen++;
      m.entries.set(key, { refCount: 1, status: "loading", generation: gen });
      m.pendingLoads.push({ uri: this.uri, key, generation: gen });
    } else {
      m.entries.get(key)!.refCount++;
    }
    assertInvariants(m, r);
  }
  toString() {
    return `Request("${this.uri}")`;
  }
}

class ReleaseCmd implements fc.AsyncCommand<Model, Real> {
  constructor(readonly uri: string) {}
  check(m: Readonly<Model>) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    return (m.entries.get(key)?.refCount ?? 0) > 0;
  }
  async run(m: Model, r: Real) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    const me = m.entries.get(key)!;
    r.mgr.release(key);
    me.refCount--;
    if (me.refCount === 0) {
      if (me.status === "ready") m.expectedDisposals++;
      m.entries.delete(key);
    }
    assertInvariants(m, r);
  }
  toString() {
    return `Release("${this.uri}")`;
  }
}

class SettleOkCmd implements fc.AsyncCommand<Model, Real> {
  check(m: Readonly<Model>) {
    return m.pendingLoads.length > 0;
  }
  async run(m: Model, r: Real) {
    const pl = m.pendingLoads.shift()!;
    r.pending.shift()!.resolve(`asset:${pl.uri}`);
    await flush();
    const me = m.entries.get(pl.key);
    if (me && me.generation === pl.generation && me.status === "loading") {
      me.status = "ready";
    } else {
      // Stale: resolved asset disposed by stale-settle guard
      m.expectedDisposals++;
    }
    assertInvariants(m, r);
  }
  toString() {
    return "SettleOk";
  }
}

class SettleFailCmd implements fc.AsyncCommand<Model, Real> {
  check(m: Readonly<Model>) {
    return m.pendingLoads.length > 0;
  }
  async run(m: Model, r: Real) {
    const pl = m.pendingLoads.shift()!;
    r.pending.shift()!.reject(new Error(`fail:${pl.uri}`));
    await flush();
    const me = m.entries.get(pl.key);
    if (me && me.generation === pl.generation && me.status === "loading") {
      me.status = "error";
    }
    // Stale failure: no asset to dispose, nothing to track
    assertInvariants(m, r);
  }
  toString() {
    return "SettleFail";
  }
}

class DrainReadyCmd implements fc.AsyncCommand<Model, Real> {
  check() {
    return true;
  }
  async run(_m: Model, r: Real) {
    const s1 = r.mgr.drainReady();
    const s2 = r.mgr.drainReady();
    // Drain-once: second drain is empty
    expect(s2.size).toBe(0);
    // All drained keys are actually ready
    for (const key of s1) {
      const entry = r.mgr.peek(key);
      if (entry) expect(entry.status).toBe("ready");
    }
  }
  toString() {
    return "DrainReady";
  }
}

class DrainFailedCmd implements fc.AsyncCommand<Model, Real> {
  check() {
    return true;
  }
  async run(_m: Model, r: Real) {
    const s1 = r.mgr.drainFailed();
    const s2 = r.mgr.drainFailed();
    // Drain-once: second drain is empty
    expect(s2.size).toBe(0);
    // All drained keys are actually in error state
    for (const key of s1) {
      const entry = r.mgr.peek(key);
      if (entry) expect(entry.status).toBe("error");
    }
  }
  toString() {
    return "DrainFailed";
  }
}

class InvalidateCmd implements fc.AsyncCommand<Model, Real> {
  constructor(readonly uri: string) {}
  check(m: Readonly<Model>) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    return m.entries.get(key)?.status === "error";
  }
  async run(m: Model, r: Real) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    r.mgr.invalidate(key);
    m.entries.delete(key);
    assertInvariants(m, r);
  }
  toString() {
    return `Invalidate("${this.uri}")`;
  }
}

/** Simulates retryFailed: invalidate error entry, then re-request for all holders. */
class RetryCmd implements fc.AsyncCommand<Model, Real> {
  constructor(readonly uri: string) {}
  check(m: Readonly<Model>) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    return m.entries.get(key)?.status === "error";
  }
  async run(m: Model, r: Real) {
    const key = AssetManager.cacheKey(TYPE, this.uri);
    const oldRef = m.entries.get(key)!.refCount;
    // Invalidate removes the error entry
    r.mgr.invalidate(key);
    m.entries.delete(key);
    // Re-request once per holder (rebuilds refcount)
    for (let i = 0; i < oldRef; i++) r.mgr.request(TYPE, this.uri);
    const gen = m.nextGen++;
    m.entries.set(key, { refCount: oldRef, status: "loading", generation: gen });
    m.pendingLoads.push({ uri: this.uri, key, generation: gen });
    assertInvariants(m, r);
  }
  toString() {
    return `Retry("${this.uri}")`;
  }
}

/** Release on a key that was never requested — must be a no-op. */
class ReleaseUnknownCmd implements fc.AsyncCommand<Model, Real> {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    r.mgr.release("unknown::nonexistent");
    assertInvariants(m, r);
  }
  toString() {
    return "ReleaseUnknown";
  }
}

// ─── Command pool ─────────────────────────────────────────

const uriArb = fc.constantFrom(...URIS);

const allCommands = [
  uriArb.map((u) => new RequestCmd(u)),
  uriArb.map((u) => new ReleaseCmd(u)),
  // Weight Settle higher so loads actually complete
  fc.constant(new SettleOkCmd()),
  fc.constant(new SettleOkCmd()),
  fc.constant(new SettleOkCmd()),
  fc.constant(new SettleFailCmd()),
  fc.constant(new SettleFailCmd()),
  fc.constant(new DrainReadyCmd()),
  fc.constant(new DrainFailedCmd()),
  uriArb.map((u) => new InvalidateCmd(u)),
  uriArb.map((u) => new RetryCmd(u)),
  fc.constant(new ReleaseUnknownCmd()),
];

// ─── Tests ────────────────────────────────────────────────

describe("AssetManager (property-based)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("maintains all invariants across arbitrary operation sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(allCommands, { maxCommands: 50 }),
        async (cmds) => {
          const { loader, pending, disposed } = createControllableLoader();
          const mgr = new AssetManager();
          mgr.registerLoader(TYPE, loader);
          await fc.asyncModelRun(
            () => ({ model: initModel(), real: { mgr, pending, disposed } }),
            cmds,
          );
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);

  it("achieves full cleanup with no leaks after draining all operations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(allCommands, { maxCommands: 30 }),
        async (cmds) => {
          const { loader, pending, disposed } = createControllableLoader();
          const mgr = new AssetManager();
          mgr.registerLoader(TYPE, loader);
          const model = initModel();
          const real: Real = { mgr, pending, disposed };

          await fc.asyncModelRun(() => ({ model, real }), cmds);

          // ── Cleanup phase ──
          // Settle all remaining in-flight loads
          while (pending.length > 0) {
            pending.shift()!.resolve("cleanup-asset");
          }
          await flush();

          // Release all remaining refs
          for (const uri of URIS) {
            const key = AssetManager.cacheKey(TYPE, uri);
            while (mgr.peek(key)) mgr.release(key);
          }

          // Cache must be completely empty
          const stats = mgr.getStats();
          expect(stats.total).toBe(0);
          expect(stats.loading).toBe(0);
          expect(stats.ready).toBe(0);
          expect(stats.error).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});
