import type { NumberSchema } from "../../engine/schema";

type Props = {
  label?: string;
  value: number;
  schema: NumberSchema;
  onChange: (value: number) => void;
};

export function NumberField({ label, value, schema, onChange }: Props) {
  const hasRange = schema.min !== undefined && schema.max !== undefined;
  const step = schema.integer ? 1 : hasRange ? 0.01 : 0.1;

  return (
    <label className="flex items-center gap-2">
      {label && <span className="text-muted w-8 text-right shrink-0">{label}</span>}
      {hasRange && (
        <input
          type="range"
          value={value}
          min={schema.min}
          max={schema.max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="flex-1 min-w-0 accent-blue-500"
        />
      )}
      <input
        type="number"
        value={value}
        min={schema.min}
        max={schema.max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className={`bg-input border border-subtle rounded px-1.5 py-0.5 text-primary outline-none focus:border-focus ${hasRange ? "w-16 shrink-0" : "w-full"}`}
      />
    </label>
  );
}
