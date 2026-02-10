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
  const sceneIdRef = useRef<string | null>(null);

  function getSceneContents() {
    const { json } = worldToJson(renderingRegistry, world, { hierarchy });
    return json;
  }

  async function handleSave() {
    if (sceneIdRef.current) {
      try {
        const data = getSceneContents();
        await fetch(`/api/scenes/${sceneIdRef.current}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Scene", data }),
        });
        return;
      } catch (err) {
        console.error("Failed to save scene:", err);
      }
    }
    await handleSaveAs();
  }

  async function handleSaveAs() {
    const name = window.prompt("Scene name:", "Untitled Scene");
    if (!name) return;

    try {
      const data = getSceneContents();
      const res = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data }),
      });
      if (!res.ok) throw new Error("Failed to create scene");
      const created = await res.json();
      sceneIdRef.current = created.id;
    } catch (err) {
      console.error("Failed to save scene:", err);
    }
  }

  async function handleLoad() {
    try {
      const res = await fetch("/api/scenes");
      if (!res.ok) throw new Error("Failed to fetch scene list");
      const scenes: { id: string; name: string }[] = await res.json();
      if (scenes.length === 0) {
        window.alert("No saved scenes found.");
        return;
      }

      const listStr = scenes.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
      const choice = window.prompt(`Pick a scene (1-${scenes.length}):\n${listStr}`);
      if (!choice) return;
      const idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= scenes.length) return;

      const sceneRes = await fetch(`/api/scenes/${scenes[idx].id}`);
      if (!sceneRes.ok) throw new Error("Failed to fetch scene");
      const scene = await sceneRes.json();
      loadScene(scene.data);
      sceneIdRef.current = scene.id;
    } catch (err) {
      console.error("Failed to load scene:", err);
    }
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
        title={projectFolder.isOpen ? `Project: ${projectFolder.name} (${projectFolder.assetRootName}/)` : "Connect to Server"}
        active={projectFolder.isOpen}
      >
        <FolderRoot size={14} strokeWidth={1.75} />
      </ToolbarButton>
      {projectFolder.isOpen && (
        <ToolbarButton
          onClick={() => projectFolder.close()}
          title="Disconnect"
        >
          <FolderSync size={14} strokeWidth={1.75} />
        </ToolbarButton>
      )}
    </div>
  );
}
