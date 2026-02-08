import type { AssetEntry, AssetLoader } from "./types";

export class AssetManager {
  private loaders = new Map<string, AssetLoader<unknown>>();
  private cache = new Map<string, AssetEntry>();
  private _justReady = new Set<string>();
  private _justFailed = new Set<string>();

  static cacheKey(type: string, uri: string): string {
    return `${type}::${uri}`;
  }

  registerLoader(type: string, loader: AssetLoader<unknown>): void {
    this.loaders.set(type, loader);
  }

  hasLoader(type: string): boolean {
    return this.loaders.has(type);
  }

  request(
    type: string,
    uri: string,
    options?: Record<string, unknown>,
  ): AssetEntry {
    const loader = this.loaders.get(type);
    if (!loader) {
      throw new Error(`No loader registered for asset type "${type}"`);
    }

    const key = AssetManager.cacheKey(type, uri);
    const existing = this.cache.get(key);

    if (existing) {
      existing.refCount++;
      return existing;
    }

    const entry: AssetEntry = {
      status: "loading",
      asset: undefined,
      error: undefined,
      refCount: 1,
    };
    this.cache.set(key, entry);

    // Capture entry reference for stale-settle safety
    const capturedEntry = entry;

    loader.load(uri, options).then(
      (asset) => {
        // Stale-settle check: if the cache entry for this key is no longer
        // the same object (released-and-re-requested, or released-and-gone),
        // dispose the old asset and bail.
        if (this.cache.get(key) !== capturedEntry) {
          loader.dispose(asset);
          return;
        }
        capturedEntry.status = "ready";
        capturedEntry.asset = asset;
        this._justReady.add(key);
      },
      (err: unknown) => {
        if (this.cache.get(key) !== capturedEntry) {
          return;
        }
        capturedEntry.status = "error";
        capturedEntry.error =
          err instanceof Error ? err : new Error(String(err));
        this._justFailed.add(key);
      },
    );

    return entry;
  }

  release(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      if (entry.status === "ready" && entry.asset !== undefined) {
        // Find the loader type from the key
        const type = key.split("::")[0];
        const loader = this.loaders.get(type);
        if (loader) {
          loader.dispose(entry.asset);
        }
      }
      this.cache.delete(key);
    }
  }

  peek(key: string): AssetEntry | undefined {
    return this.cache.get(key);
  }

  drainReady(): ReadonlySet<string> {
    const set = this._justReady;
    this._justReady = new Set();
    return set;
  }

  drainFailed(): ReadonlySet<string> {
    const set = this._justFailed;
    this._justFailed = new Set();
    return set;
  }

  invalidate(key: string): void {
    const entry = this.cache.get(key);
    if (!entry || entry.status !== "error") return;
    this.cache.delete(key);
    this._justFailed.delete(key);
  }

  getStats(): { total: number; loading: number; ready: number; error: number } {
    let loading = 0;
    let ready = 0;
    let error = 0;
    for (const entry of this.cache.values()) {
      switch (entry.status) {
        case "loading":
          loading++;
          break;
        case "ready":
          ready++;
          break;
        case "error":
          error++;
          break;
      }
    }
    return { total: this.cache.size, loading, ready, error };
  }

  dispose(): void {
    for (const [key, entry] of this.cache) {
      if (entry.status === "ready" && entry.asset !== undefined) {
        const type = key.split("::")[0];
        const loader = this.loaders.get(type);
        if (loader) {
          loader.dispose(entry.asset);
        }
      }
    }
    this.cache.clear();
    this._justReady.clear();
    this._justFailed.clear();
  }
}
