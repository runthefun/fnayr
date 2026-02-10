import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Image,
  Box,
  Film,
  Music,
  FileIcon,
  RefreshCw,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useEditor, useProjectFolder, useThumbnailCache } from "./useEditor";
import type { TreeNode, FolderNode } from "./ProjectFolder";
import type { ThumbnailCache } from "./ThumbnailCache";
import type { EcsWorld } from "../engine/ecs/world";
import type { renderingRegistry } from "../engine/rendering/components";
import { inferAssetType } from "./assetTypeDetection";

type Registry = typeof renderingRegistry;

/** Recursively search a value for any `uri` property matching the path. */
function deepHasUri(value: unknown, uri: string): boolean {
  if (value == null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.uri === uri) return true;
  for (const v of Object.values(obj)) {
    if (deepHasUri(v, uri)) return true;
  }
  return false;
}

/** Return entity names that reference the given asset path. */
function findUsages(world: EcsWorld<Registry>, assetPath: string): string[] {
  const users: string[] = [];
  const compTypes = ["MeshVisual", "ModelVisual"] as const;
  world.forEachEntity((entity) => {
    for (const comp of compTypes) {
      if (!world.hasComponent(entity, comp)) continue;
      const data = world.getComponent(entity, comp);
      if (deepHasUri(data, assetPath)) {
        const meta = world.getComponent(entity, "Meta") as { name: string } | undefined;
        users.push(meta?.name || `Entity ${entity}`);
        break;
      }
    }
  });
  return users;
}

function iconForFile(name: string) {
  const type = inferAssetType(name);
  const props = { size: 14, strokeWidth: 1.75 };
  switch (type) {
    case "texture":
      return <Image {...props} />;
    case "glb":
      return <Box {...props} />;
    case "videoClip":
      return <Film {...props} />;
    case "audioClip":
      return <Music {...props} />;
    default:
      return <FileIcon {...props} />;
  }
}

type FileEntryProps = {
  node: TreeNode & { kind: "file" };
  thumbnailCache: ThumbnailCache;
  onDelete: (path: string) => void;
};

function FileEntry({ node, thumbnailCache, onDelete }: FileEntryProps) {
  const thumb = thumbnailCache.getThumbnail(node.path);
  return (
    <div
      draggable
      onDragStart={(e) => {
        const data = JSON.stringify({
          path: node.path,
          type: inferAssetType(node.name),
        });
        e.dataTransfer.setData("application/x-fnayr-asset", data);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group flex items-center gap-2 px-3 py-1 text-secondary hover:text-primary hover:bg-surface/60 cursor-grab text-body"
    >
      {thumb ? (
        <img src={thumb} alt="" className="w-6 h-6 object-contain shrink-0 rounded bg-surface border border-subtle" />
      ) : (
        <span className="text-muted">{iconForFile(node.name)}</span>
      )}
      <span className="truncate flex-1">{node.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node.path);
        }}
        className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
        title="Remove asset"
      >
        <Trash2 size={10} strokeWidth={2} />
      </button>
    </div>
  );
}

type DirEntryProps = {
  node: FolderNode;
  thumbnailCache: ThumbnailCache;
  onDelete: (path: string) => void;
};

function DirEntry({ node, thumbnailCache, onDelete }: DirEntryProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1 w-full text-left text-secondary hover:text-primary hover:bg-surface/60 text-body cursor-pointer"
      >
        {open ? <ChevronDown size={12} strokeWidth={2} className="text-muted" /> : <ChevronRight size={12} strokeWidth={2} className="text-muted" />}
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {open && (
        <div className="pl-3">
          {node.children.map((child) =>
            child.kind === "directory" ? (
              <DirEntry key={child.path} node={child} thumbnailCache={thumbnailCache} onDelete={onDelete} />
            ) : (
              <FileEntry key={child.path} node={child as TreeNode & { kind: "file" }} thumbnailCache={thumbnailCache} onDelete={onDelete} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function AssetBrowser() {
  const { world } = useEditor();
  const projectFolder = useProjectFolder();
  const thumbnailCache = useThumbnailCache();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    projectFolder.listTree().then(setTree);
  }, [projectFolder]);

  useEffect(() => {
    if (projectFolder.isOpen) refresh();
    else setTree([]);
  }, [projectFolder, projectFolder.isOpen, refresh]);

  async function importFiles(files: FileList | File[]) {
    for (const file of files) {
      try {
        await projectFolder.importFile(file);
      } catch (err) {
        console.warn("Failed to import file:", file.name, err);
      }
    }
    refresh();
  }

  async function handleDelete(path: string) {
    const users = findUsages(world, path);
    if (users.length > 0) {
      const names = users.join(", ");
      const ok = window.confirm(
        `"${path}" is used by: ${names}.\n\nDelete anyway?`,
      );
      if (!ok) return;
    }
    try {
      await projectFolder.deleteFile(path);
      thumbnailCache.invalidate(path);
      refresh();
    } catch (err) {
      console.warn("Failed to delete asset:", path, err);
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      importFiles(e.dataTransfer.files);
    }
  };

  const handleBrowse = () => fileInputRef.current?.click();

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      importFiles(files);
    }
    e.target.value = "";
  };

  if (!projectFolder.isOpen) {
    return (
      <div className="border-t border-subtle min-h-[120px]">
        <div className="px-3 py-2 text-muted font-medium uppercase tracking-widest text-header border-b border-subtle">
          Assets
        </div>
        <button
          onClick={() => projectFolder.open()}
          className="flex items-center gap-2 px-3 py-3 text-muted hover:text-accent text-body w-full cursor-pointer"
        >
          <FolderOpen size={14} strokeWidth={1.75} />
          Open Project Folder...
        </button>
      </div>
    );
  }

  return (
    <div
      className={`border-t border-subtle min-h-[120px] ${dragOver ? "ring-1 ring-inset ring-accent/50" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="px-3 py-2 text-muted font-medium uppercase tracking-widest text-header border-b border-subtle flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 cursor-pointer hover:text-primary"
        >
          {collapsed ? <ChevronRight size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
          <span>Assets</span>
          <span className="font-normal normal-case tracking-normal text-muted/50 ml-1">{projectFolder.assetRootName}/</span>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleBrowse}
            className="text-muted hover:text-accent cursor-pointer p-0.5 rounded hover:bg-surface"
            title="Add assets"
          >
            <Plus size={11} strokeWidth={2} />
          </button>
          <button
            onClick={refresh}
            className="text-muted hover:text-accent cursor-pointer p-0.5 rounded hover:bg-surface"
            title="Refresh"
          >
            <RefreshCw size={10} strokeWidth={2} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto">
          {tree.length === 0 ? (
            <div className="px-3 py-4 text-muted text-label text-center">
              Drop files here or click + to add assets
            </div>
          ) : (
            tree.map((node) =>
              node.kind === "directory" ? (
                <DirEntry key={node.path} node={node} thumbnailCache={thumbnailCache} onDelete={handleDelete} />
              ) : (
                <FileEntry key={node.path} node={node as TreeNode & { kind: "file" }} thumbnailCache={thumbnailCache} onDelete={handleDelete} />
              ),
            )
          )}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
}
