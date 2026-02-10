import { type ChangeEvent, useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { useEditor, useSelectedEntity } from "./useEditor";
import { SchemaField } from "./fields/SchemaField";
import { getDefault } from "../engine/schema";
import type { SchemaLike, TaggedUnionSchema } from "../engine/schema";
import type { renderingRegistry } from "../engine/rendering/components";

type ComponentKey = keyof typeof renderingRegistry;

export function Inspector() {
  const { world } = useEditor();
  const selectedEntity = useSelectedEntity();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of Object.keys(world.registry)) {
      if (key !== "Transform3D") initial[key] = true;
    }
    return initial;
  });

  if (selectedEntity === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 text-muted">
        <span className="text-label">No entity selected</span>
      </div>
    );
  }

  if (!world.isAlive(selectedEntity)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 text-muted">
        <span className="text-label">Entity not alive</span>
      </div>
    );
  }

  const allKeys = Object.keys(world.registry) as ComponentKey[];
  const componentTypes = allKeys.filter((type) =>
    world.hasComponent(selectedEntity, type)
  );
  const availableComponents = allKeys.filter(
    (type) => !world.hasComponent(selectedEntity, type)
  );

  function handleAddComponent(e: ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    if (!raw) return;

    // Format: "ComponentKey" or "ComponentKey::variantName"
    const sepIdx = raw.indexOf("::");
    if (sepIdx === -1) {
      const type = raw as ComponentKey;
      const schema = world.registry[type] as SchemaLike;
      world.setComponent(selectedEntity!, type, getDefault(schema) as never);
    } else {
      const type = raw.slice(0, sepIdx) as ComponentKey;
      const variant = raw.slice(sepIdx + 2);
      const schema = world.registry[type] as unknown as TaggedUnionSchema;
      const variantSchema = schema.variants[variant];
      world.setComponent(selectedEntity!, type, getDefault(variantSchema) as never);
    }
  }

  function handleRemoveComponent(type: ComponentKey) {
    world.removeComponent(selectedEntity!, type);
  }

  return (
    <div>
      {/* Panel header */}
      <div className="px-3 py-2 text-muted font-medium uppercase tracking-widest text-header border-b border-subtle flex items-center gap-2">
        <span>Inspector</span>
        <span className="text-header font-mono text-muted/60 font-normal normal-case tracking-normal">#{selectedEntity}</span>
      </div>

      {componentTypes.map((type) => {
        const schema = world.registry[type] as SchemaLike;
        const data = world.getComponent(selectedEntity, type);
        const isCollapsed = collapsed[type];

        return (
          <div key={type} className="border-b border-subtle">
            {/* Component header */}
            <div
              className="px-3 py-1.5 bg-surface/50 text-primary text-body flex items-center justify-between cursor-pointer select-none hover:bg-surface"
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }))
              }
            >
              <span className="flex items-center gap-1.5 font-medium">
                {isCollapsed ? (
                  <ChevronRight size={11} strokeWidth={2} className="text-muted" />
                ) : (
                  <ChevronDown size={11} strokeWidth={2} className="text-muted" />
                )}
                {type}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveComponent(type);
                }}
                className="text-muted hover:text-danger cursor-pointer p-0.5 rounded hover:bg-danger-dim"
                title={`Remove ${type}`}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
            {!isCollapsed && (
              <div className="px-3 py-2">
                <SchemaField
                  value={data}
                  schema={schema}
                  onChange={(newValue) => {
                    world.setComponent(selectedEntity, type, newValue as never);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}

      {availableComponents.length > 0 && (
        <div className="px-3 py-2.5">
          <select
            onChange={handleAddComponent}
            value=""
            className="w-full bg-surface text-secondary text-body px-2 py-1.5 border border-subtle rounded cursor-pointer outline-none focus:border-focus hover:border-border"
          >
            <option value="" disabled>
              + Add Component...
            </option>
            {availableComponents.map((type) => {
              const schema = world.registry[type] as SchemaLike;
              if (schema.type === "taggedUnion") {
                const tu = schema as TaggedUnionSchema;
                return (
                  <optgroup key={type} label={type}>
                    {Object.keys(tu.variants).map((variant) => (
                      <option key={variant} value={`${type}::${variant}`}>
                        {variant}
                      </option>
                    ))}
                  </optgroup>
                );
              }
              return (
                <option key={type} value={type}>
                  {type}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}
