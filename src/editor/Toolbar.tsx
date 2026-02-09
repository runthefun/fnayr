import { useRef } from "react";
import { Save, SaveAll, FolderOpen, Focus } from "lucide-react";
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
  const fileHandleRef = useRef<any>(null);

  function getSceneContents() {
    const { json } = worldToJson(renderingRegistry, world, { hierarchy });
    return JSON.stringify(json, null, 2);
  }

  async function writeToHandle(handle: any, contents: string) {
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async function handleSave() {
    const contents = getSceneContents();

    if (fileHandleRef.current) {
      try {
        await writeToHandle(fileHandleRef.current, contents);
        return;
      } catch (err: any) {
        // Permission revoked or file gone — fall through to Save As
      }
    }

    await handleSaveAs();
  }

  async function handleSaveAs() {
    const contents = getSceneContents();

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: "scene.json",
          types: [
            {
              description: "JSON Scene",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        await writeToHandle(handle, contents);
        fileHandleRef.current = handle;
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
      }
    }

    // Fallback: download
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scene.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleLoad() {
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: "JSON Scene",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const file = await handle.getFile();
        const text = await file.text();
        const json = JSON.parse(text);
        loadScene(json);
        fileHandleRef.current = handle;
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
      }
    }

    // Fallback: file input
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
        fileHandleRef.current = null;
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
    <div className="flex gap-1 px-2 py-1.5 border-b border-subtle bg-panel overflow-x-auto">
      <button
        onClick={handleSave}
        className="p-1 bg-surface hover:bg-subtle text-primary rounded border border-subtle"
        title="Save"
      >
        <Save size={14} />
      </button>
      <button
        onClick={handleSaveAs}
        className="p-1 bg-surface hover:bg-subtle text-primary rounded border border-subtle"
        title="Save As"
      >
        <SaveAll size={14} />
      </button>
      <button
        onClick={handleLoad}
        className="p-1 bg-surface hover:bg-subtle text-primary rounded border border-subtle"
        title="Load"
      >
        <FolderOpen size={14} />
      </button>
      <button
        onClick={() => {
          if (selectedEntity == null) return;
          const obj = binding.get(selectedEntity);
          if (obj) controls.focusOnObject(obj);
        }}
        disabled={selectedEntity == null}
        className="p-1 bg-surface hover:bg-subtle text-primary rounded border border-subtle disabled:opacity-40 disabled:cursor-default"
        title="Focus"
      >
        <Focus size={14} />
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
