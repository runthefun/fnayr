import type { ObjectSchema, SchemaLike } from "../../engine/schema";
import { SchemaField } from "./SchemaField";

type Props = {
  value: Record<string, unknown>;
  schema: ObjectSchema;
  onChange: (value: Record<string, unknown>) => void;
};

export function ObjectField({ value, schema, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(schema.properties)
        .filter(([, propSchema]) => propSchema.type !== "literal" && !propSchema.meta?.hidden)
        .map(([key, propSchema]) => (
          <div key={key}>
            <div className="text-muted text-label mb-0.5 font-medium">{key}</div>
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
