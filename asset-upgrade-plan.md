# Plan: Lightweight Backend with 3 Abstract Services

## Context

The editor's save/load and asset management is entirely browser-based (File System Access API, IndexedDB, blob URLs). This limits it to Chromium, single-user, local-only. We're adding a Node.js backend with 3 abstract service interfaces, each with a zero-setup local implementation that can be swapped for production services later.

| Service | Local (zero-setup) | Prod (swap later) |
|---|---|---|
| Database | SQLite (`better-sqlite3`) | PostgreSQL |
| Object Storage | Local filesystem (`data/blobs/`) | S3 / R2 |
| Job Queue | Inline async (`await fn()`) | BullMQ + Redis |

## New Dependencies

```
pnpm add hono @hono/node-server better-sqlite3
pnpm add -D @types/better-sqlite3 tsx concurrently
```

## File Structure

### New files to create

```
shared/
  types.ts                          — TreeNode, SceneRow, BlobMeta (shared client+server types)

server/
  tsconfig.json                     — Node TS config (ES2022, separate from client)
  index.ts                          — Hono app entry, wire services, start server on :3001
  context.ts                        — Hono ServiceContext type (typed c.get("db") etc.)
  services/
    types.ts                        — IDatabase, IBlobStorage, IJobQueue interfaces
    database/
      sqlite.ts                     — SqliteDatabase: better-sqlite3, file at data/fnayr.db
    blob-storage/
      local-fs.ts                   — LocalBlobStorage: fs read/write under data/blobs/
    job-queue/
      inline.ts                     — InlineJobQueue: just await handler(payload) directly
  routes/
    project.ts                      — GET /api/health
    scenes.ts                       — CRUD: GET/POST/PUT/DELETE /api/scenes
    assets.ts                       — GET /api/assets/tree, GET/POST/DELETE /api/assets/file/*
```

### Files to modify

| File | Change |
|---|---|
| `src/editor/ProjectFolder.ts` | Rewrite internals: replace File System Access API with `fetch()` calls to server. Same class name, same public API. Remove IndexedDB/FileSystemHandle code. |
| `src/editor/AssetUriResolver.ts` | Simplify: remove ref-counted blob URL cache. `resolve()` just calls `projectFolder.createObjectURL()` which now returns a stable server URL. `release()`/`dispose()` become no-ops. |
| `src/editor/AssetUriResolver.test.ts` | Update: remove ref-counting/revocation tests, test new simple pass-through behavior |
| `src/editor/Toolbar.tsx` | Replace File System Access save/load with server API. Add `sceneIdRef` for tracking current scene. Save → `PUT /api/scenes/:id`. Save As → `POST /api/scenes`. Load → fetch scene list, pick, load. |
| `src/editor/fields/AssetRefField.tsx` | Remove blob URL fallback paths (lines 64-67, 113-116). Always go through `projectFolder.importFile()`. |
| `vite.config.ts` | Add `/api` proxy to `localhost:3001`, add `data/` to watch ignore list |
| `package.json` | Add deps, add scripts: `dev:server`, `dev:client`, update `dev` to use `concurrently` |
| `.gitignore` | Add `data/` |

### Files that do NOT change

- `src/editor/setup.ts` — `projectFolder.restore()` stays, now does a health check
- `src/editor/EditorContext.tsx` — type references unchanged
- `src/editor/useEditor.ts` — hooks unchanged
- `src/editor/ThumbnailCache.ts` — calls `projectFolder.getFile()` which still works (now via fetch)
- `src/editor/AssetBrowser.tsx` — calls `listTree()/importFile()/deleteFile()` which route through server
- `src/engine/**/*` — entire engine untouched

---

## Service Interfaces

### IDatabase

```typescript
interface SceneRow {
  id: string;
  name: string;
  data: string;       // scene JSON string
  created_at: string;
  updated_at: string;
}

interface IDatabase {
  listScenes(): Promise<SceneRow[]>;
  getScene(id: string): Promise<SceneRow | null>;
  createScene(name: string, data: string): Promise<SceneRow>;
  updateScene(id: string, name: string, data: string): Promise<SceneRow>;
  deleteScene(id: string): Promise<void>;
  close(): void;
}
```

SQLite impl: single `scenes` table, UUIDs via `crypto.randomUUID()`, db file at `data/fnayr.db`.

### IBlobStorage

```typescript
interface IBlobStorage {
  read(path: string): Promise<{ data: Buffer; mime: string } | null>;
  write(path: string, data: Buffer, mime: string): Promise<BlobMeta>;
  remove(path: string): Promise<void>;
  list(): Promise<TreeNode[]>;
  exists(path: string): Promise<boolean>;
}
```

Local impl: `fs` operations under `data/blobs/`. Path traversal protection (reject `..`, resolve against root). Same folder-by-type organization as current `ProjectFolder` (`inferSubfolder` logic moves to `shared/`).

### IJobQueue

```typescript
interface IJobQueue {
  enqueue<T>(jobType: string, payload: T): Promise<string>;
  process(jobType: string, handler: (payload: any) => Promise<void>): void;
  close(): Promise<void>;
}
```

Inline impl: `enqueue()` immediately `await`s the registered handler. No Redis, no queue.

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check, returns `{ status: "ok" }` |
| `GET` | `/api/scenes` | List all scenes (summary) |
| `GET` | `/api/scenes/:id` | Get scene with parsed data |
| `POST` | `/api/scenes` | Create scene `{ name, data }` → 201 |
| `PUT` | `/api/scenes/:id` | Update scene `{ name, data }` |
| `DELETE` | `/api/scenes/:id` | Delete scene → 204 |
| `GET` | `/api/assets/tree` | List asset tree (same shape as `ProjectFolder.listTree()`) |
| `GET` | `/api/assets/file/*` | Serve binary file with correct Content-Type |
| `POST` | `/api/assets/upload` | Multipart upload, returns `{ path }` |
| `DELETE` | `/api/assets/file/*` | Delete asset → 204 |

---

## Key Client Changes

### ProjectFolder.ts — Server-backed rewrite

Same public API. Internals change to `fetch()` calls:
- `open()` → `fetch("/api/health")`, set `_connected = true`
- `restore()` → same as `open()` (auto-connect if server running)
- `getFile(path)` → `fetch("/api/assets/file/{path}")` → return as `File`
- `importFile(file)` → `FormData` POST to `/api/assets/upload` → return path
- `deleteFile(path)` → `DELETE /api/assets/file/{path}`
- `createObjectURL(path)` → return `/api/assets/file/{path}` (stable URL, no blob)
- `listTree()` → `GET /api/assets/tree`
- `name` → `"Server Project"` when connected
- `assetRootName` → `"assets"` when connected

### AssetUriResolver.ts — Simplified

No more caching or ref-counting. `resolve()` calls `projectFolder.createObjectURL()` which returns a stable server URL like `/api/assets/file/textures/wood.png`. `release()` and `dispose()` become no-ops.

### Toolbar.tsx — Server scene CRUD

- `handleSave()`: if `sceneIdRef.current`, PUT to update. Else, `handleSaveAs()`.
- `handleSaveAs()`: `window.prompt()` for name, POST to create, store returned ID.
- `handleLoad()`: fetch scene list, show simple picker (could be `window.prompt` with list for now), GET scene data, call existing `loadScene()`.
- Remove `fileHandleRef`, `showSaveFilePicker`, `showOpenFilePicker`, hidden file input.

---

## Implementation Steps (test-validated)

### Step 1: Shared types + service interfaces
- Create `shared/types.ts` (extract `TreeNode` from `ProjectFolder.ts`)
- Create `server/services/types.ts` (3 interfaces)
- Typecheck only — no runtime code yet

### Step 2: SqliteDatabase + tests
- Implement `server/services/database/sqlite.ts`
- Test file: `server/services/database/sqlite.test.ts`
- Tests: create scene, get, list, update, delete, get nonexistent → null
- Runs against temp db file, cleaned up after each test

### Step 3: LocalBlobStorage + tests
- Implement `server/services/blob-storage/local-fs.ts`
- Test file: `server/services/blob-storage/local-fs.test.ts`
- Tests: write/read/delete/list/exists, path traversal rejection, inferSubfolder
- Runs against temp directory, cleaned up after each test

### Step 4: InlineJobQueue + tests
- Implement `server/services/job-queue/inline.ts`
- Test file: `server/services/job-queue/inline.test.ts`
- Tests: enqueue calls handler immediately, returns job ID, throws if no handler

### Step 5: API routes + integration tests
- Implement routes: `project.ts`, `scenes.ts`, `assets.ts`
- Wire up in `server/index.ts`
- Test file: `server/routes/routes.test.ts`
- Use Hono's `app.request()` (no real HTTP server needed)
- Tests: scene CRUD endpoints, asset upload/download/tree/delete

### Step 6: Client adaptation + updated tests
- Rewrite `ProjectFolder.ts` (fetch-based)
- Simplify `AssetUriResolver.ts`
- Update `AssetUriResolver.test.ts`
- Update `Toolbar.tsx` (server scene CRUD)
- Clean up `AssetRefField.tsx` (remove blob fallback)
- Update `vite.config.ts`, `package.json`, `.gitignore`

### Step 7: End-to-end verification
- `pnpm dev` starts both server and client
- Manual smoke test: upload asset, drag to entity, save scene, reload, load scene
- `pnpm test:run` — all tests pass
- `pnpm typecheck` — both client and server typecheck
