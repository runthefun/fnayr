# Asset & Scene Workflow

End-to-end data flow from UI through Vite proxy to Hono server and service implementations.

## Architecture

```
Browser (React + Three.js)
  → fetch /api/*
    → Vite dev proxy (localhost:5173 → localhost:3001)
      → Hono server
        → middleware injects services into context
        → route handler calls IDatabase / IBlobStorage / IJobQueue
          → SqliteDatabase (data/fnayr.db)
          → LocalBlobStorage (data/blobs/)
          → InlineJobQueue (await handler directly)
```

## Connection (startup)

```
setup.ts → projectFolder.restore()
  → projectFolder.open()
    → fetch GET /api/health
      → project.ts: returns { status: "ok" }
    ← _connected = true, _notify()
```

## Asset Upload

Example: drag an image onto an AssetRefField or use Browse button.

```
AssetRefField.handleDrop() / handleFileChange()
  → projectFolder.importFile(file)
    → fetch POST /api/assets/upload  (FormData with file)
      → Hono middleware injects services into context
      → assets.ts route handler:
          c.get("storage")                    ← IBlobStorage from context
          inferSubfolder(file.name, mime)      ← shared/types.ts picks "textures/"
          deduplicateName(existing, name)      ← avoids collisions
          storage.write("textures/brick.png", buffer, "image/png")
            → LocalBlobStorage._safePath()    ← path traversal check
            → fs.writeFile("data/blobs/textures/brick.png")
          returns { path: "textures/brick.png" }
    ← projectFolder stores path, calls _notify()
  → onChange({ ...value, uri: "textures/brick.png" })
```

## Asset Resolve (Three.js loading)

When the engine needs to load a texture/model referenced by a component:

```
AssetManager.load("textures/brick.png")
  → uriResolver("textures/brick.png")             ← wired in setup.ts
    → AssetUriResolver.resolve("textures/brick.png")
      → projectFolder.createObjectURL("textures/brick.png")
        → returns "/api/assets/file/textures/brick.png"   ← stable URL, no blob
    ← Three.js TextureLoader fetches that URL
      → Vite proxy → localhost:3001
        → assets.ts GET /api/assets/file/*
          → storage.read("textures/brick.png")
            → LocalBlobStorage reads data/blobs/textures/brick.png
          ← Response with image bytes + Content-Type header
```

## Asset Tree (Asset Browser)

```
AssetBrowser → projectFolder.listTree()
  → fetch GET /api/assets/tree
    → storage.list()
      → LocalBlobStorage._scanDir() recursively
      → returns TreeNode[] (directories first, sorted alphabetically)
    ← JSON response
```

## Asset Delete

```
AssetBrowser delete action → projectFolder.deleteFile(path)
  → fetch DELETE /api/assets/file/{path}
    → storage.remove(path)
      → LocalBlobStorage: fs.rm(safePath)
    ← 204 No Content
```

## Scene Save

```
Toolbar.handleSave()
  → if sceneIdRef.current exists:
      fetch PUT /api/scenes/:id  { name, data: worldToJson() }
        → scenes.ts route:
            c.get("db").updateScene(id, name, JSON.stringify(data))
              → SqliteDatabase: UPDATE scenes SET ... WHERE id = ?
                → better-sqlite3 writes to data/fnayr.db
  → else handleSaveAs():
      window.prompt("Scene name:")
      fetch POST /api/scenes  { name, data }
        → db.createScene(name, data)
          → INSERT INTO scenes ... with crypto.randomUUID()
        ← returns { id, name, data, created_at, updated_at }
      sceneIdRef.current = id   ← subsequent saves use PUT
```

## Scene Load

```
Toolbar.handleLoad()
  → fetch GET /api/scenes
    → db.listScenes()             ← returns summaries (no data field)
  → window.prompt() picker
  → fetch GET /api/scenes/:id
    → db.getScene(id)             ← returns full row, data parsed as JSON
  → loadScene(scene.data)
    → destroys all entities
    → parseWorld() + recreates with new IDs
    → restores hierarchy
  → sceneIdRef.current = id
```

## Key Design Decisions

- **Stable URLs instead of blob URLs**: `createObjectURL()` returns `/api/assets/file/{path}` — no caching, no ref-counting, no revocation needed. `AssetUriResolver.release()` and `dispose()` are no-ops.
- **Server handles subfolder inference**: `inferSubfolder()` moved to `shared/types.ts`, used by both the upload route and (previously) the client. The server picks the right subfolder (textures/, models/, etc.) based on MIME type and file extension.
- **Service interfaces are swappable**: `IDatabase`, `IBlobStorage`, `IJobQueue` can be replaced with PostgreSQL, S3, BullMQ without changing routes or client code.
- **No IndexedDB or File System Access API**: The old browser-only code (directory picker, IDB handle persistence) is fully replaced by `fetch()` calls. Works in any browser.
