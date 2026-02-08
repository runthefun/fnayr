import type { TaggedUnionSchema, SchemaLike } from "../../engine/schema";
import { getDefault } from "../../engine/schema";
import { SchemaField } from "./SchemaField";

type Props = {
  value: Record<string, unknown>;
  schema: TaggedUnionSchema;
  onChange: (value: Record<string, unknown>) => void;
};

export function TaggedUnionField({ value, schema, onChange }: Props) {
  const tagKey = schema.tag ?? "kind";
  const activeVariant = value[tagKey] as string;
  const variantSchema = schema.variants[activeVariant];
  const variantKeys = Object.keys(schema.variants);

  // Properties to render: everything in the variant except the tag field itself
  const fieldEntries = variantSchema
    ? Object.entries(variantSchema.properties).filter(([key]) => key !== tagKey)
    : [];

  function handleVariantChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newVariant = e.target.value;
    if (newVariant === activeVariant) return;
    const newSchema = schema.variants[newVariant];
    onChange(getDefault(newSchema) as Record<string, unknown>);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <div className="text-muted text-[10px] mb-0.5">{tagKey}</div>
        <select
          value={activeVariant}
          onChange={handleVariantChange}
          className="w-full bg-surface text-primary text-[11px] px-1.5 py-0.5 border border-subtle rounded cursor-pointer"
        >
          {variantKeys.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {fieldEntries.map(([key, propSchema]) => (
        <div key={key}>
          <div className="text-muted text-[10px] mb-0.5">{key}</div>
          <SchemaField
            value={value[key]}
            schema={propSchema as SchemaLike}
            onChange={(v) => onChange({ ...value, [key]: v })}
          />
        </div>
      ))}
    </div>
  );
}
