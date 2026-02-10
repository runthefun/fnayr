const DB_NAME = "fnayr-editor";
const STORE_NAME = "handles";
const HANDLE_KEY = "projectFolder";

export type FileNode = { kind: "file"; name: string; path: string };
export type FolderNode = {
  kind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
};
export type TreeNode = FileNode | FolderNode;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const SUBFOLDER_BY_MIME: [RegExp, string][] = [
  [/^image\//, "textures"],
  [/^video\//, "videos"],
  [/^audio\//, "audio"],
];

const SUBFOLDER_BY_EXT: Record<string, string> = {
  ".glb": "models",
  ".gltf": "models",
  ".fbx": "models",
  ".obj": "models",
};

function inferSubfolder(file: File): string {
  for (const [re, folder] of SUBFOLDER_BY_MIME) {
    if (re.test(file.type)) return folder;
  }
  const ext = file.name.includes(".")
    ? "." + file.name.split(".").pop()!.toLowerCase()
    : "";
  return SUBFOLDER_BY_EXT[ext] ?? "assets";
}

function deduplicateName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  while (existing.has(`${base}_${i}${ext}`)) i++;
  return `${base}_${i}${ext}`;
}

export class ProjectFolder {
  /** The root handle the user picked (project root). */
  private _rootHandle: FileSystemDirectoryHandle | null = null;
  /** The asset root — `public/` inside the project root, or the root itself. */
  private _assetHandle: FileSystemDirectoryHandle | null = null;
  private _listeners = new Set<() => void>();
  private _version = 0;

  get isOpen(): boolean {
    return this._assetHandle !== null;
  }

  /** Display name: project root folder name. */
  get name(): string | null {
    return this._rootHandle?.name ?? null;
  }

  /** Name of the directory used as asset root (e.g. "public"). */
  get assetRootName(): string | null {
    if (!this._assetHandle) return null;
    return this._assetHandle === this._rootHandle
      ? this._rootHandle!.name
      : this._assetHandle.name;
  }

  get handle(): FileSystemDirectoryHandle | null {
    return this._assetHandle;
  }

  async open(): Promise<boolean> {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      await this._setRoot(handle);
      await idbPut(HANDLE_KEY, handle);
      this._notify();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this._rootHandle = null;
    this._assetHandle = null;
    idbDelete(HANDLE_KEY);
    this._notify();
  }

  async restore(): Promise<boolean> {
    try {
      const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
      if (!handle) return false;
      const perm = await (handle as any).requestPermission({ mode: "readwrite" });
      if (perm !== "granted") return false;
      await this._setRoot(handle);
      this._notify();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store the root handle and auto-detect `public/` as the asset root.
   * Falls back to the root itself if `public/` doesn't exist.
   */
  private async _setRoot(handle: FileSystemDirectoryHandle): Promise<void> {
    this._rootHandle = handle;
    try {
      this._assetHandle = await handle.getDirectoryHandle("public");
    } catch {
      // No public/ folder — use the root directly
      this._assetHandle = handle;
    }
  }

  async resolveRelativePath(fileHandle: FileSystemFileHandle): Promise<string | null> {
    if (!this._assetHandle) return null;
    const segments = await this._assetHandle.resolve(fileHandle);
    if (!segments) return null;
    return segments.join("/");
  }

  async getFile(relativePath: string): Promise<File> {
    if (!this._assetHandle) throw new Error("No project folder open");
    const parts = relativePath.split("/");
    let dir: FileSystemDirectoryHandle = this._assetHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    return fileHandle.getFile();
  }

  async deleteFile(relativePath: string): Promise<void> {
    if (!this._assetHandle) throw new Error("No project folder open");
    const parts = relativePath.split("/");
    let dir: FileSystemDirectoryHandle = this._assetHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    await dir.removeEntry(parts[parts.length - 1]);
    this._notify();
  }

  async createObjectURL(relativePath: string): Promise<string> {
    const file = await this.getFile(relativePath);
    return URL.createObjectURL(file);
  }

  async importFile(file: File, subfolder?: string): Promise<string> {
    if (!this._assetHandle) throw new Error("No project folder open");
    const folder = subfolder ?? inferSubfolder(file);

    // Ensure subfolder exists
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this._assetHandle.getDirectoryHandle(folder, { create: true });
    } catch {
      dir = this._assetHandle;
    }

    // Deduplicate name
    const existing = new Set<string>();
    for await (const key of (dir as any).keys()) {
      existing.add(key);
    }
    const finalName = deduplicateName(existing, file.name);

    // Write file
    const fileHandle = await dir.getFileHandle(finalName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(file);
    await writable.close();

    this._notify();
    return `${folder}/${finalName}`;
  }

  async listTree(): Promise<TreeNode[]> {
    if (!this._assetHandle) return [];
    return this._scanDir(this._assetHandle, "");
  }

  private async _scanDir(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];
    for await (const entry of (dir as any).values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "file") {
        nodes.push({ kind: "file", name: entry.name, path });
      } else {
        const children = await this._scanDir(entry, path);
        nodes.push({ kind: "directory", name: entry.name, path, children });
      }
    }
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
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
