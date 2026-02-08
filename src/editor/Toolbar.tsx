import { useRef } from "react";
import { Save, FolderOpen, Focus } from "lucide-react";
import { useEditor, useSelectedEntity } from "./useEditor";
import { worldToJson } from "../engine/ecs/bridge";
import { parseWorld } from "../engine/world";
import { renderingRegistry } from "../engine/rendering/components";
import type { ComponentType, ComponentData } from "../engine/ecs/types";

type Registry = typeof renderingRegistry;

export function Toolbar() {
  const { store, world, hierarchy, binding, controls } = useEditor();
  const selectedEntity = useSelectedEntity();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSave() {
    const { json } = worldToJson(renderingRegistry, world, { hierarchy });
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scene.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleLoad() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        loadScene(json);
      } catch (err) {
        console.error("Failed to load scene:", err);
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be loaded again
    e.target.value = "";
  }

  function loadScene(json: unknown) {
    // 1. Deselect entity (gizmo auto-detaches via selection subscription)
    store.selectEntity(null);

    // 2. Destroy all existing entities
    const allEntities: number[] = [];
    world.forEachEntity((e) => allEntities.push(e));
    for (const e of allEntities) {
      if (world.isAlive(e)) {
        world.destroyEntity(e);
      }
    }

    // 3. Parse the loaded JSON
    const parsed = parseWorld(renderingRegistry, json, {
      allowUnknownComponents: true,
    });

    // 4. Recreate entities with new IDs, mapping old to new
    const idMap = new Map<number, number>();
    for (const entityData of parsed.world.entities) {
      const newEntity = world.createEntity();
      idMap.set(entityData.id, newEntity);
      for (const [compName, compValue] of Object.entries(
        entityData.components
      )) {
        if (compValue !== undefined) {
          world.setComponent(
            newEntity,
            compName as ComponentType<Registry>,
            compValue as ComponentData<Registry, ComponentType<Registry>>
          );
        }
      }
    }

    // 5. Restore hierarchy with mapped IDs
    for (const entityData of parsed.world.entities) {
      if (entityData.parent !== undefined) {
        const newChild = idMap.get(entityData.id);
        const newParent = idMap.get(entityData.parent);
        if (newChild !== undefined && newParent !== undefined) {
          hierarchy.setParent(newChild, newParent);
        }
      }
    }
  }

  return (
    <div className="flex gap-2 px-2 py-1.5 border-b border-subtle bg-panel">
      <button
        onClick={handleSave}
        className="flex items-center gap-1 px-2 py-0.5 bg-surface hover:bg-subtle text-primary text-[11px] rounded border border-subtle"
      >
        <Save size={14} />
        Save
      </button>
      <button
        onClick={handleLoad}
        className="flex items-center gap-1 px-2 py-0.5 bg-surface hover:bg-subtle text-primary text-[11px] rounded border border-subtle"
      >
        <FolderOpen size={14} />
        Load
      </button>
      <button
        onClick={() => {
          if (selectedEntity == null) return;
          const obj = binding.get(selectedEntity);
          if (obj) controls.focusOnObject(obj);
        }}
        disabled={selectedEntity == null}
        className="flex items-center gap-1 px-2 py-0.5 bg-surface hover:bg-subtle text-primary text-[11px] rounded border border-subtle disabled:opacity-40 disabled:cursor-default"
      >
        <Focus size={14} />
        Focus
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
