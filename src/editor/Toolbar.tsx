import { useRef } from "react";
import { Save, SaveAll, FolderOpen, Focus, FolderRoot, FolderSync } from "lucide-react";
import { useEditor, useSelectedEntity, useProjectFolder } from "./useEditor";
import { worldToJson } from "../engine/ecs/bridge";
import { parseWorld } from "../engine/world";
import { renderingRegistry } from "../engine/rendering/components";
import type { ComponentType, ComponentData } from "../engine/ecs/types";

type Registry = typeof renderingRegistry;

function ToolbarButton({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        p-1.5 rounded text-secondary hover:text-primary hover:bg-surface
        disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-secondary
        cursor-pointer
        ${active ? "bg-accent-dim text-accent ring-1 ring-accent/40" : ""}
      `}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-4 bg-subtle mx-0.5" />;
}

export function Toolbar() {
  const { store, world, hierarchy, binding, controls } = useEditor();
  const selectedEntity = useSelectedEntity();
  const projectFolder = useProjectFolder();
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
    <div className="flex items-center gap-0.5">
      <ToolbarButton onClick={handleSave} title="Save (Ctrl+S)">
        <Save size={14} strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton onClick={handleSaveAs} title="Save As...">
        <SaveAll size={14} strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton onClick={handleLoad} title="Open Scene...">
        <FolderOpen size={14} strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        onClick={() => {
          if (selectedEntity == null) return;
          const obj = binding.get(selectedEntity);
          if (obj) controls.focusOnObject(obj);
        }}
        disabled={selectedEntity == null}
        title="Focus Selected (F)"
      >
        <Focus size={14} strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        onClick={() => projectFolder.open()}
        title={projectFolder.isOpen ? `Project: ${projectFolder.name} (${projectFolder.assetRootName}/)` : "Open Project Folder"}
        active={projectFolder.isOpen}
      >
        <FolderRoot size={14} strokeWidth={1.75} />
      </ToolbarButton>
      {projectFolder.isOpen && (
        <ToolbarButton
          onClick={() => projectFolder.open()}
          title="Change Project Folder"
        >
          <FolderSync size={14} strokeWidth={1.75} />
        </ToolbarButton>
      )}
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
