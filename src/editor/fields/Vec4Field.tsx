import type { TupleSchema, NumberSchema } from "../../engine/schema";

type Props = {
  value: [number, number, number, number];
  schema: TupleSchema;
  onChange: (value: [number, number, number, number]) => void;
};

const LABELS = ["X", "Y", "Z", "W"];

export function Vec4Field({ value, schema, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {LABELS.map((label, i) => {
        const itemSchema = schema.items[i] as NumberSchema;
        return (
          <label key={label} className="flex items-center gap-0.5 flex-1 min-w-0">
            <span className="text-muted text-[10px] shrink-0">{label}</span>
            <input
              type="number"
              value={value[i]}
              step={0.1}
              min={itemSchema.min}
              max={itemSchema.max}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isNaN(v)) return;
                const next = [...value] as [number, number, number, number];
                next[i] = v;
                onChange(next);
              }}
              className="bg-input border border-subtle rounded px-1 py-0.5 w-full text-primary outline-none focus:border-focus min-w-0"
            />
          </label>
        );
      })}
    </div>
  );
}
