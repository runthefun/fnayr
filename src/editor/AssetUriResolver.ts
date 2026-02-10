import type { ProjectFolder } from "./ProjectFolder";

export class AssetUriResolver {
  private _cache = new Map<string, { url: string; refCount: number }>();

  constructor(private _projectFolder: ProjectFolder) {}

  isRelativePath(uri: string): boolean {
    if (!uri) return false;
    return (
      !uri.startsWith("http://") &&
      !uri.startsWith("https://") &&
      !uri.startsWith("blob:") &&
      !uri.startsWith("data:")
    );
  }

  async resolve(uri: string): Promise<string> {
    if (!uri) return uri;
    if (!this.isRelativePath(uri)) return uri;
    if (!this._projectFolder.isOpen) return uri;

    const cached = this._cache.get(uri);
    if (cached) {
      cached.refCount++;
      return cached.url;
    }

    const url = await this._projectFolder.createObjectURL(uri);
    this._cache.set(uri, { url, refCount: 1 });
    return url;
  }

  release(uri: string): void {
    const cached = this._cache.get(uri);
    if (!cached) return;
    cached.refCount--;
    if (cached.refCount <= 0) {
      URL.revokeObjectURL(cached.url);
      this._cache.delete(uri);
    }
  }

  dispose(): void {
    for (const { url } of this._cache.values()) {
      URL.revokeObjectURL(url);
    }
    this._cache.clear();
  }
}
