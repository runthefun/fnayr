import type { TupleSchema, NumberSchema } from "../../engine/schema";
import { DraggableNumber } from "./DraggableNumber";

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
          <DraggableNumber
            key={label}
            label={label}
            value={value[i]}
            schema={itemSchema}
            onChange={(v) => {
              const next = [...value] as [number, number, number, number];
              next[i] = v;
              onChange(next);
            }}
          />
        );
      })}
    </div>
  );
}
