import { type ChangeEvent } from "react";
import { useEditor, useSelectedEntity } from "./useEditor";
import { SchemaField } from "./fields/SchemaField";
import { getDefault } from "../engine/schema";
import type { SchemaLike, TaggedUnionSchema } from "../engine/schema";
import type { renderingRegistry } from "../engine/rendering/components";

type ComponentKey = keyof typeof renderingRegistry;

export function Inspector() {
  const { world } = useEditor();
  const selectedEntity = useSelectedEntity();

  if (selectedEntity === null) {
    return (
      <div className="p-3 text-muted text-center">
        No entity selected
      </div>
    );
  }

  if (!world.isAlive(selectedEntity)) {
    return (
      <div className="p-3 text-muted text-center">
        Entity not alive
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
      const schema = world.registry[type] as TaggedUnionSchema;
      const variantSchema = schema.variants[variant];
      world.setComponent(selectedEntity!, type, getDefault(variantSchema) as never);
    }
  }

  function handleRemoveComponent(type: ComponentKey) {
    world.removeComponent(selectedEntity!, type);
  }

  return (
    <div>
      <div className="px-2 py-1.5 text-muted font-medium uppercase tracking-wider text-[10px] border-b border-subtle">
        Inspector — Entity {selectedEntity}
      </div>
      {componentTypes.map((type) => {
        const schema = world.registry[type] as SchemaLike;
        const data = world.getComponent(selectedEntity, type);

        return (
          <div key={type} className="border-b border-subtle">
            <div className="px-2 py-1.5 bg-surface text-primary font-medium text-[11px] flex items-center justify-between">
              <span>{type}</span>
              <button
                onClick={() => handleRemoveComponent(type)}
                className="text-muted hover:text-primary text-[10px] cursor-pointer"
                title={`Remove ${type}`}
              >
                x
              </button>
            </div>
            <div className="px-2 py-1.5">
              <SchemaField
                value={data}
                schema={schema}
                onChange={(newValue) => {
                  world.setComponent(selectedEntity, type, newValue as never);
                }}
              />
            </div>
          </div>
        );
      })}
      {availableComponents.length > 0 && (
        <div className="px-2 py-2 border-b border-subtle">
          <select
            onChange={handleAddComponent}
            value=""
            className="w-full bg-surface text-primary text-[11px] px-2 py-1 border border-subtle rounded cursor-pointer outline-none focus:border-focus"
          >
            <option value="" disabled>
              Add Component...
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
