# Asset Library — Implementation Plan

## Context

Asset URL fields in the editor are plain text inputs with a "Browse…" button. Selected files are loaded via blob URLs. This means saved scenes contain blob URLs that break on reload. The roadmap (`asset-lib.md`) calls for a project asset folder, thumbnails, persistent paths, drag-and-drop import, and asset type detection. This plan implements all five features in dependency order.

---

## Phase 1: Project Folder + Persistent Paths

These are tightly coupled — the project folder provides the root for relative path computation.

**Key design decision:** Store relative paths (e.g. `textures/brick.png`) directly in ECS components, never blob URLs (when a project folder is open). An `AssetUriResolver` converts relative paths to object URLs at load time for Three.js loaders.

### 1A. `ProjectFolder` service class

**New file:** `src/editor/ProjectFolder.ts`

Wraps `FileSystemDirectoryHandle` (File System Access API). Key methods:
- `open()` — prompt user with `showDirectoryPicker()`
- `close()` — detach the current folder
- `restore()` — retrieve handle from IndexedDB + `requestPermission()` on startup
- `resolveRelativePath(fileHandle)` — uses `handle.resolve()` → `string[]` segments → join with `/`
- `getFile(relativePath)` — walk directory handles, return `File`
- `createObjectURL(relativePath)` — `getFile()` → `URL.createObjectURL()`
- `importFile(file, subfolder?)` — copy a `File` into the project folder, deduplicate names, return relative path. Infers subfolder from type: `textures/`, `models/`, etc.
- `listTree()` — recursive directory scan → `FolderNode | FileNode` tree
- `subscribe / getSnapshot` — for `useSyncExternalStore`

Handles are persisted to IndexedDB (`fnayr-editor` db, `handles` store) so the folder is restored across sessions.

### 1B. `AssetUriResolver`

**New file:** `src/editor/AssetUriResolver.ts`

Bridges relative paths → loadable URLs for Three.js loaders:
- `isRelativePath(uri)` — returns true if not `http://`, `blob:`, `data:`
- `resolve(uri)` — relative paths go through `ProjectFolder.createObjectURL()`, absolutes pass through. Caches with refcount.
- `release(uri)` — decrement refcount, revoke when 0

### 1C. Wire into editor session

**Modify:** `src/editor/setup.ts`
- Create `ProjectFolder` + `AssetUriResolver`, call `projectFolder.restore()`
- Set `assetManager.uriResolver = (uri) => resolver.resolve(uri)`
- Add to `EditorSession` type, expose via `__editor`

**Modify:** `src/engine/assets/manager.ts`
- Add optional `uriResolver?: (uri: string) => Promise<string>` field
- In `request()`, resolve URI before passing to loader

**Modify:** `src/editor/EditorContext.tsx` — add `projectFolder` to `EditorContextValue`
**Modify:** `src/editor/EditorApp.tsx` — pass `session.projectFolder` into context
**Modify:** `src/editor/useEditor.ts` — add `useProjectFolder()` hook using `useSyncExternalStore`

### 1D. Update AssetRefField for relative paths

**Modify:** `src/editor/fields/AssetRefField.tsx`

In `handleFileChange`: if project folder is open, call `projectFolder.importFile(file)` and store the returned relative path as the `uri`. Fall back to blob URL when no project folder.

### 1E. "Open Project Folder" button

**Modify:** `src/editor/Toolbar.tsx`
- Add a `FolderRoot` icon button that calls `projectFolder.open()`
- Show folder name in tooltip when open

### 1F. Tests

New `src/editor/ProjectFolder.test.ts` and `src/editor/AssetUriResolver.test.ts`:
- Relative path detection and resolution
- Reference counting and URL revocation
- Filename deduplication in `importFile`

---

## Phase 2: Asset Browser Panel

### 2A. Panel placement

Insert between EntityTree and Inspector in the right sidebar:

```
Toolbar
EntityTree (max-h-[40%])
AssetBrowser            ← new, collapsible
Inspector (flex-1)
```

### 2B. `AssetBrowser` component

**New file:** `src/editor/AssetBrowser.tsx`

- Shows "Open Project Folder…" prompt when no folder is open
- Collapsible header: "Assets — {folderName}" with refresh button
- Recursive tree of `FolderNode` / `FileNode` from `projectFolder.listTree()`
- Directory nodes expand/collapse
- File nodes show icon by type (lucide: `Image`, `Box`, `Film`, `Music`, `FileIcon`)
- File nodes are `draggable` — set `application/x-fnayr-asset` data (JSON with `path` and `type`)

### 2C. Layout integration

**Modify:** `src/editor/EditorApp.tsx` — insert `<AssetBrowser />` between EntityTree and Inspector

### 2D. Drop target on AssetRefField

**Modify:** `src/editor/fields/AssetRefField.tsx`
- `onDragOver` / `onDrop` on the URI input area
- Accept `application/x-fnayr-asset` data, extract `path`, set as `uri`
- Visual feedback: accent border highlight during drag-over

---

## Phase 3: Asset Type Detection

### 3A. Extension-to-type utility

**New file:** `src/editor/assetTypeDetection.ts`

- `inferAssetType(filename) → AssetType | null` — maps `.png`→`texture`, `.glb`→`glb`, `.mp4`→`videoClip`, `.mp3`→`audioClip`, etc.
- `isTypeCompatible(expected, inferred) → boolean`

### 3B. Integration points

**Modify:** `src/editor/fields/AssetRefField.tsx`
- On drop (internal or external) and on Browse file pick: infer type, warn if mismatch
- Show warning as `text-amber-400 text-[10px]` below URI field

**Modify:** `src/editor/AssetBrowser.tsx` — use `inferAssetType` for file icons and drag data

### 3C. Tests

New `src/editor/assetTypeDetection.test.ts`: extension mapping, case insensitivity, unknown extensions

---

## Phase 4: Drag-and-Drop Import from OS

### 4A. Viewport drop target

**Modify:** `src/editor/Viewport.tsx`
- `onDragOver` / `onDrop` on the viewport container
- On drop with `dataTransfer.files`: infer type, call `projectFolder.importFile(file)`, create entity with appropriate component (`ModelVisual` for glb, `MeshVisual` with plane+texture for images)
- Show overlay during drag: `bg-accent/10 border-2 border-accent border-dashed`

### 4B. Inspector field drop from OS

**Modify:** `src/editor/fields/AssetRefField.tsx`
- Extend drop handler to also check `dataTransfer.files` (external OS drop)
- If project folder open: auto-import then set relative path
- If not: fall back to blob URL

### 4C. Import subfolder strategy

In `ProjectFolder.importFile()`:
- Default subfolders by type: textures → `textures/`, glb → `models/`, video → `videos/`, audio → `audio/`
- Create directories if missing
- Deduplicate filenames with numeric suffix (`brick_1.png`, etc.)

---

## Phase 5: Asset Thumbnails

### 5A. `ThumbnailCache` service

**New file:** `src/editor/ThumbnailCache.ts`

- `getThumbnail(relativePath) → string | null` — returns cached data URL or triggers async generation
- Image thumbnails: load into `Image`, draw onto 48x48 canvas, `.toDataURL("image/png")`
- 3D model thumbnails: offscreen `WebGLRenderer` (96x96), load GLB, auto-frame with bounding box, render one frame, `.toDataURL()`
- `subscribe / getSnapshot` for React integration

### 5B. Integrate into editor session & context

**Modify:** `src/editor/setup.ts` — create `ThumbnailCache`
**Modify:** `src/editor/EditorContext.tsx` — add `thumbnailCache`
**Modify:** `src/editor/useEditor.ts` — add `useThumbnailCache()` hook

### 5C. Show thumbnails

**Modify:** `src/editor/AssetBrowser.tsx` — show 16x16 thumbnail next to file name
**Modify:** `src/editor/fields/AssetRefField.tsx` — show 32x32 thumbnail preview next to URI input

---

## Files Summary

| Phase | New Files | Modified Files |
|-------|-----------|---------------|
| 1 | `ProjectFolder.ts`, `AssetUriResolver.ts`, `ProjectFolder.test.ts`, `AssetUriResolver.test.ts` | `setup.ts`, `EditorContext.tsx`, `EditorApp.tsx`, `useEditor.ts`, `Toolbar.tsx`, `AssetRefField.tsx`, `manager.ts` |
| 2 | `AssetBrowser.tsx` | `EditorApp.tsx` |
| 3 | `assetTypeDetection.ts`, `assetTypeDetection.test.ts` | `AssetRefField.tsx`, `AssetBrowser.tsx` |
| 4 | — | `Viewport.tsx`, `AssetRefField.tsx`, `ProjectFolder.ts` |
| 5 | `ThumbnailCache.ts` | `setup.ts`, `EditorContext.tsx`, `useEditor.ts`, `AssetBrowser.tsx`, `AssetRefField.tsx` |

All new files go in `src/editor/` (editor-level concerns, not engine-level).

## Verification

After each phase:
1. `pnpm typecheck` — no type errors
2. `pnpm test:run` — all tests pass including new ones
3. `pnpm dev` — manual verification in browser:
   - Phase 1: Open project folder → Browse file → URI shows relative path → Save scene → JSON contains relative paths → Load scene → assets render correctly
   - Phase 2: Asset browser shows tree → drag file onto AssetRefField → URI updates
   - Phase 3: Drop wrong type → warning appears
   - Phase 4: Drag .glb from OS onto viewport → entity created → file copied to project folder
   - Phase 5: Thumbnails appear in asset browser and inspector fields
