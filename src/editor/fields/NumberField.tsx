import type { NumberSchema } from "../../engine/schema";

type Props = {
  label?: string;
  value: number;
  schema: NumberSchema;
  onChange: (value: number) => void;
};

export function NumberField({ label, value, schema, onChange }: Props) {
  return (
    <label className="flex items-center gap-2">
      {label && <span className="text-muted w-8 text-right shrink-0">{label}</span>}
      <input
        type="number"
        value={value}
        min={schema.min}
        max={schema.max}
        step={schema.integer ? 1 : schema.min !== undefined && schema.max !== undefined ? 0.01 : 0.1}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="bg-input border border-subtle rounded px-1.5 py-0.5 w-full text-primary outline-none focus:border-focus"
      />
    </label>
  );
}
