import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Trash2, Box, Circle, Square, Layers, Package } from "lucide-react";
import { useEditor, useSelectedEntity, useEntities } from "./useEditor";

type Preset = {
  label: string;
  name: string;
  icon: React.ReactNode;
  components: Record<string, unknown>;
};

const iconProps = { size: 12, strokeWidth: 2 };

const PRESETS: Preset[] = [
  {
    label: "Empty",
    name: "Entity",
    icon: <Layers {...iconProps} />,
    components: {},
  },
  {
    label: "Cube",
    name: "Cube",
    icon: <Box {...iconProps} />,
    components: {
      MeshVisual: {
        geometry: { kind: "box", width: 1, height: 1, depth: 1 },
        color: [0.8, 0.8, 0.8, 1],
        texture: { kind: "asset", type: "texture", uri: "" },
      },
    },
  },
  {
    label: "Sphere",
    name: "Sphere",
    icon: <Circle {...iconProps} />,
    components: {
      MeshVisual: {
        geometry: { kind: "sphere", radius: 0.5, widthSegments: 32, heightSegments: 16 },
        color: [0.8, 0.8, 0.8, 1],
        texture: { kind: "asset", type: "texture", uri: "" },
      },
    },
  },
  {
    label: "Plane",
    name: "Plane",
    icon: <Square {...iconProps} />,
    components: {
      MeshVisual: {
        geometry: { kind: "plane", width: 1, height: 1 },
        color: [0.8, 0.8, 0.8, 1],
        texture: { kind: "asset", type: "texture", uri: "" },
      },
    },
  },
  {
    label: "Model",
    name: "Model",
    icon: <Package {...iconProps} />,
    components: {
      ModelVisual: {
        asset: { kind: "asset", type: "glb", uri: "" },
      },
    },
  },
];

export function EntityTree() {
  const { world, hierarchy, store } = useEditor();
  const selectedEntity = useSelectedEntity();
  const [renamingEntity, setRenamingEntity] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Subscribe to entity changes so tree re-renders when entities change
  useEntities();

  useEffect(() => {
    if (renamingEntity !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingEntity]);

  const entities: number[] = [];
  world.forEachEntity((e) => entities.push(e));

  // Build root entities (no parent)
  const roots = entities.filter((e) => hierarchy.getParent(e) === undefined);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    function onPointerDown(e: PointerEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [showAddMenu]);

  const handleCreateEntity = useCallback((preset: Preset) => {
    const entity = world.createEntity();
    world.setComponent(entity, "Meta", { name: preset.name });
    world.setComponent(entity, "Transform3D", {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    for (const [comp, data] of Object.entries(preset.components)) {
      world.setComponent(entity, comp as any, data as any);
    }
    store.selectEntity(entity);
    setShowAddMenu(false);
  }, [world, store]);

  function handleDeleteEntity(entity: number) {
    world.destroyEntity(entity);
  }

  function startRename(entity: number, currentName: string) {
    setRenamingEntity(entity);
    setRenameValue(currentName);
  }

  function commitRename(entity: number) {
    const name = renameValue.trim();
    const existing = world.getComponent(entity, "Meta") as { name: string } | undefined;
    world.setComponent(entity, "Meta", { ...existing, name });
    setRenamingEntity(null);
  }

  function cancelRename() {
    setRenamingEntity(null);
  }

  function renderEntity(entity: number, depth: number) {
    const children = hierarchy.getChildren(entity);
    const isSelected = entity === selectedEntity;
    const meta = world.getComponent(entity, "Meta") as { name: string } | undefined;
    const label = meta?.name || "Entity";
    const isRenaming = renamingEntity === entity;

    return (
      <div key={entity}>
        <div
          className={`
            group w-full text-left flex items-center gap-1.5 hover:bg-surface/60
            ${isSelected ? "bg-selected text-primary" : "text-secondary"}
          `}
          style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}
        >
          {/* Depth guide line */}
          {depth > 0 && (
            <div
              className="absolute left-0 top-0 bottom-0 border-l border-subtle/50"
              style={{ marginLeft: `${4 + (depth - 1) * 14}px` }}
            />
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(entity)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(entity);
                if (e.key === "Escape") cancelRename();
              }}
              className="min-w-0 flex-1 bg-input text-primary text-[inherit] font-[inherit] px-1 py-0 rounded border border-accent/60 outline-none"
            />
          ) : (
            <button
              onClick={() => store.selectEntity(entity)}
              onDoubleClick={() => startRename(entity, label)}
              className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
            >
              <span className={`truncate text-body ${isSelected ? "font-medium" : ""}`}>
                {label}
              </span>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteEntity(entity);
            }}
            className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
            title="Delete entity"
          >
            <Trash2 size={11} strokeWidth={1.75} />
          </button>
        </div>
        {children.map((child) => renderEntity(child as number, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      {/* Panel header */}
      <div className="px-3 py-2 text-muted font-medium uppercase tracking-widest text-header border-b border-subtle flex items-center justify-between">
        <span>Scene</span>
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="text-muted hover:text-accent cursor-pointer p-0.5 rounded hover:bg-surface"
            title="Add entity"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1.5 bg-panel border border-border rounded-md shadow-xl shadow-black/40 z-10 min-w-[130px] py-1 overflow-hidden">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleCreateEntity(preset)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-body text-secondary hover:text-primary hover:bg-surface cursor-pointer"
                >
                  <span className="text-muted">{preset.icon}</span>
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {roots.length === 0 ? (
        <div className="px-3 py-4 text-muted text-label text-center">
          No entities in scene
        </div>
      ) : (
        <div className="py-0.5">
          {roots.map((entity) => renderEntity(entity, 0))}
        </div>
      )}
    </div>
  );
}
