import type { TupleSchema, NumberSchema } from "../../engine/schema";

type Props = {
  value: [number, number, number, number];
  schema: TupleSchema;
  onChange: (value: [number, number, number, number]) => void;
};

const LABELS = ["R", "G", "B", "A"];

export function ColorField({ value, schema, onChange }: Props) {
  // Convert [0-1] RGBA to hex for color swatch
  const r = Math.round(value[0] * 255);
  const g = Math.round(value[1] * 255);
  const b = Math.round(value[2] * 255);
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={hex}
          onChange={(e) => {
            const h = e.target.value;
            const nr = parseInt(h.slice(1, 3), 16) / 255;
            const ng = parseInt(h.slice(3, 5), 16) / 255;
            const nb = parseInt(h.slice(5, 7), 16) / 255;
            onChange([nr, ng, nb, value[3]]);
          }}
          className="w-6 h-6 rounded border border-subtle cursor-pointer bg-transparent p-0"
        />
        <div className="flex gap-1 flex-1">
          {LABELS.map((label, i) => {
            const itemSchema = schema.items[i] as NumberSchema;
            return (
              <label key={label} className="flex items-center gap-0.5 flex-1 min-w-0">
                <span className="text-muted text-[10px] shrink-0">{label}</span>
                <input
                  type="number"
                  value={value[i]}
                  step={0.01}
                  min={itemSchema.min ?? 0}
                  max={itemSchema.max ?? 1}
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
      </div>
    </div>
  );
}
