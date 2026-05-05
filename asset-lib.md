# Asset Library — Roadmap

This document outlines the future roadmap for a richer asset management experience in the editor.

## Current State

- Asset URL fields are plain text inputs with a "Browse..." button for local file selection.
- Selected files are loaded via Blob URLs for immediate preview.
- The existing asset pipeline (texture, glb, video, audio) handles loading from any URL.

## Future Improvements

### Project Asset Folder
- Designate a project folder for assets on disk.
- Display a tree view of the asset folder inside the editor.
- Drag-and-drop from the asset tree onto entity fields.

### Asset Thumbnails
- Generate and cache thumbnails for images and 3D models.
- Show thumbnails in the asset browser and inspector fields.

### Persistent Paths
- Store relative paths instead of Blob URLs for saved scenes.
- Resolve paths at load time against the project root.

### Drag-and-Drop Import
- Drop files from the OS file explorer directly onto the viewport or inspector.
- Auto-copy dropped files into the project asset folder.

### Asset Type Detection
- Infer asset type from file extension when browsing/dropping.
- Warn on type mismatch (e.g., selecting a `.png` for a `glb` field).
