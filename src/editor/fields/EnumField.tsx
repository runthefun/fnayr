import type { EnumSchema } from "../../engine/schema";

type Props = {
  value: string;
  schema: EnumSchema;
  onChange: (value: string) => void;
};

export function EnumField({ value, schema, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-input border border-subtle rounded px-1.5 py-1 w-full text-primary outline-none focus:border-focus hover:border-border cursor-pointer text-body"
    >
      {schema.values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}
