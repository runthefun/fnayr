import type { ObjectSchema, SchemaLike } from "../../engine/schema";
import { SchemaField } from "./SchemaField";

type Props = {
  value: Record<string, unknown>;
  schema: ObjectSchema;
  onChange: (value: Record<string, unknown>) => void;
};

export function ObjectField({ value, schema, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(schema.properties)
        .filter(([, propSchema]) => propSchema.type !== "literal" && !propSchema.meta?.hidden)
        .map(([key, propSchema]) => (
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
