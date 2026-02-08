import type { TupleSchema, NumberSchema } from "../../engine/schema";

type Props = {
  value: number[];
  schema: TupleSchema;
  onChange: (value: number[]) => void;
};

export function ColorField({ value, schema, onChange }: Props) {
  const hasAlpha = schema.items.length >= 4;

  // Convert [0-1] RGB to hex for color picker
  const r = Math.round(value[0] * 255);
  const g = Math.round(value[1] * 255);
  const b = Math.round(value[2] * 255);
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const h = e.target.value;
          const nr = parseInt(h.slice(1, 3), 16) / 255;
          const ng = parseInt(h.slice(3, 5), 16) / 255;
          const nb = parseInt(h.slice(5, 7), 16) / 255;
          if (hasAlpha) {
            onChange([nr, ng, nb, value[3]]);
          } else {
            onChange([nr, ng, nb]);
          }
        }}
        className="w-6 h-6 rounded border border-subtle cursor-pointer bg-transparent p-0 shrink-0"
      />
      {hasAlpha && (
        <>
          <span className="text-muted text-[10px] shrink-0">A</span>
          <input
            type="range"
            value={value[3]}
            min={(schema.items[3] as NumberSchema).min ?? 0}
            max={(schema.items[3] as NumberSchema).max ?? 1}
            step={0.01}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange([value[0], value[1], value[2], v]);
            }}
            className="flex-1 min-w-0 accent-blue-500"
          />
          <span className="text-muted text-[10px] w-6 text-right shrink-0">
            {Math.round(value[3] * 100)}%
          </span>
        </>
      )}
    </div>
  );
}
