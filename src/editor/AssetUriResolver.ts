import type { ProjectFolder } from "./ProjectFolder";

export class AssetUriResolver {
  constructor(private _projectFolder: ProjectFolder) {}

  isRelativePath(uri: string): boolean {
    if (!uri) return false;
    return (
      !uri.startsWith("http://") &&
      !uri.startsWith("https://") &&
      !uri.startsWith("blob:") &&
      !uri.startsWith("data:") &&
      !uri.startsWith("/api/")
    );
  }

  resolve(uri: string): string {
    if (!uri) return uri;
    if (!this.isRelativePath(uri)) return uri;
    if (!this._projectFolder.isOpen) return uri;
    return this._projectFolder.createObjectURL(uri);
  }

  release(_uri: string): void {
    // No-op: server URLs are stable, no blob URLs to revoke
  }

  dispose(): void {
    // No-op: no cached blob URLs to clean up
  }
}
