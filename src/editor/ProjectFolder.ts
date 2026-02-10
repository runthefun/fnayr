export type { FileNode, FolderNode, TreeNode } from "../../shared/types";
import type { TreeNode } from "../../shared/types";

export class ProjectFolder {
  private _connected = false;
  private _listeners = new Set<() => void>();
  private _version = 0;

  get isOpen(): boolean {
    return this._connected;
  }

  get name(): string | null {
    return this._connected ? "Server Project" : null;
  }

  get assetRootName(): string | null {
    return this._connected ? "assets" : null;
  }

  async open(): Promise<boolean> {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return false;
      this._connected = true;
      this._notify();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this._connected = false;
    this._notify();
  }

  async restore(): Promise<boolean> {
    return this.open();
  }

  async getFile(relativePath: string): Promise<File> {
    if (!this._connected) throw new Error("Not connected to server");
    const res = await fetch(`/api/assets/file/${relativePath}`);
    if (!res.ok) throw new Error(`Failed to get file: ${relativePath}`);
    const blob = await res.blob();
    const name = relativePath.split("/").pop() ?? relativePath;
    return new File([blob], name, { type: blob.type });
  }

  async deleteFile(relativePath: string): Promise<void> {
    if (!this._connected) throw new Error("Not connected to server");
    const res = await fetch(`/api/assets/file/${relativePath}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete file: ${relativePath}`);
    this._notify();
  }

  createObjectURL(relativePath: string): string {
    return `/api/assets/file/${relativePath}`;
  }

  async importFile(file: File): Promise<string> {
    if (!this._connected) throw new Error("Not connected to server");
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/assets/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Failed to upload file");
    const { path } = await res.json();
    this._notify();
    return path;
  }

  async listTree(): Promise<TreeNode[]> {
    if (!this._connected) return [];
    const res = await fetch("/api/assets/tree");
    if (!res.ok) return [];
    return res.json();
  }

  // useSyncExternalStore integration
  subscribe = (cb: () => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  getSnapshot = (): number => {
    return this._version;
  };

  private _notify(): void {
    this._version++;
    for (const cb of this._listeners) cb();
  }
}
