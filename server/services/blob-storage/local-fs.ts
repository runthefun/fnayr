import { readFile, writeFile, rm, stat, readdir, mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve, relative, dirname, extname, join } from "node:path";
import type { IBlobStorage } from "../types.js";
import type { BlobMeta, TreeNode } from "../../../shared/types.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "application/octet-stream",
  ".obj": "text/plain",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export class LocalBlobStorage implements IBlobStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
  }

  private _safePath(path: string): string {
    if (path.includes("..")) {
      throw new Error(`Path traversal not allowed: ${path}`);
    }
    const full = resolve(this.rootDir, path);
    if (!full.startsWith(this.rootDir)) {
      throw new Error(`Path traversal not allowed: ${path}`);
    }
    return full;
  }

  async read(path: string): Promise<{ data: Buffer; mime: string } | null> {
    const full = this._safePath(path);
    try {
      const data = await readFile(full);
      const mime = guessMime(full);
      return { data, mime };
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async write(path: string, data: Buffer, mime: string): Promise<BlobMeta> {
    const full = this._safePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { path, mime, size: data.length };
  }

  async remove(path: string): Promise<void> {
    const full = this._safePath(path);
    try {
      await rm(full);
    } catch (err: any) {
      if (err.code === "ENOENT") return;
      throw err;
    }
  }

  async list(): Promise<TreeNode[]> {
    return this._scanDir(this.rootDir);
  }

  async exists(path: string): Promise<boolean> {
    const full = this._safePath(path);
    try {
      await stat(full);
      return true;
    } catch {
      return false;
    }
  }

  private async _scanDir(dir: string): Promise<TreeNode[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const dirs: TreeNode[] = [];
    const files: TreeNode[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(this.rootDir, fullPath);

      if (entry.isDirectory()) {
        const children = await this._scanDir(fullPath);
        dirs.push({ kind: "directory", name: entry.name, path: relPath, children });
      } else {
        files.push({ kind: "file", name: entry.name, path: relPath });
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return [...dirs, ...files];
  }
}
