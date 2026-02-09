import { useState, useRef, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useEditor, useSelectedEntity, useEntities } from "./useEditor";

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

  function handleCreateEntity() {
    const entity = world.createEntity();
    world.setComponent(entity, "Transform3D", {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    store.selectEntity(entity);
  }

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
          className={`w-full text-left px-2 py-1 flex items-center gap-1.5 hover:bg-surface ${
            isSelected ? "bg-selected" : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
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
              className="min-w-0 flex-1 bg-transparent text-primary text-[inherit] font-[inherit] p-0 rounded outline outline-1 outline-accent"
            />
          ) : (
            <button
              onClick={() => store.selectEntity(entity)}
              onDoubleClick={() => startRename(entity, label)}
              className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
            >
              <span className="truncate">
                {label}
              </span>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteEntity(entity);
            }}
            className="text-muted hover:text-primary text-[10px] ml-1 cursor-pointer"
            title="Delete entity"
          >
            <Trash2 size={12} />
          </button>
        </div>
        {children.map((child) => renderEntity(child as number, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      <div className="px-2 py-1.5 text-muted font-medium uppercase tracking-wider text-[10px] border-b border-subtle flex items-center justify-between">
        <span>Entities</span>
        <button
          onClick={handleCreateEntity}
          className="text-muted hover:text-primary text-sm leading-none cursor-pointer"
          title="Create entity"
        >
          <Plus size={14} />
        </button>
      </div>
      {roots.map((entity) => renderEntity(entity, 0))}
    </div>
  );
}
