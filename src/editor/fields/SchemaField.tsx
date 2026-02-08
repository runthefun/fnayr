import type {
  SchemaLike,
  TupleSchema,
  NumberSchema,
  ObjectSchema,
  EnumSchema,
  TaggedUnionSchema,
} from "../../engine/schema";
import { NumberField } from "./NumberField";
import { StringField } from "./StringField";
import { BooleanField } from "./BooleanField";
import { EnumField } from "./EnumField";
import { Vec3Field } from "./Vec3Field";
import { Vec4Field } from "./Vec4Field";
import { ColorField } from "./ColorField";
import { ObjectField } from "./ObjectField";
import { TagField } from "./TagField";
import { TaggedUnionField } from "./TaggedUnionField";

type Props = {
  value: unknown;
  schema: SchemaLike;
  onChange: (value: unknown) => void;
};

function isColorTuple(schema: TupleSchema): boolean {
  if (schema.items.length !== 4) return false;
  return schema.items.every(
    (item) =>
      item.type === "number" &&
      (item as NumberSchema).min !== undefined &&
      (item as NumberSchema).max !== undefined
  );
}

export function SchemaField({ value, schema, onChange }: Props) {
  switch (schema.type) {
    case "number":
      return (
        <NumberField
          value={value as number}
          schema={schema as NumberSchema}
          onChange={onChange}
        />
      );

    case "string":
      return (
        <StringField
          value={value as string}
          onChange={onChange as (v: string) => void}
        />
      );

    case "boolean":
      return (
        <BooleanField
          value={value as boolean}
          onChange={onChange as (v: boolean) => void}
        />
      );

    case "enum":
      return (
        <EnumField
          value={value as string}
          schema={schema as EnumSchema}
          onChange={onChange as (v: string) => void}
        />
      );

    case "tag":
      return <TagField />;

    case "tuple": {
      const tupleSchema = schema as TupleSchema;
      const items = tupleSchema.items;

      // 3-element numeric tuple → Vec3Field
      if (
        items.length === 3 &&
        items.every((item) => item.type === "number")
      ) {
        return (
          <Vec3Field
            value={value as [number, number, number]}
            schema={tupleSchema}
            onChange={onChange as (v: [number, number, number]) => void}
          />
        );
      }

      // 4-element numeric tuple
      if (
        items.length === 4 &&
        items.every((item) => item.type === "number")
      ) {
        if (isColorTuple(tupleSchema)) {
          return (
            <ColorField
              value={value as [number, number, number, number]}
              schema={tupleSchema}
              onChange={
                onChange as (v: [number, number, number, number]) => void
              }
            />
          );
        }
        return (
          <Vec4Field
            value={value as [number, number, number, number]}
            schema={tupleSchema}
            onChange={
              onChange as (v: [number, number, number, number]) => void
            }
          />
        );
      }

      // Generic tuple fallback
      const arr = value as unknown[];
      return (
        <div className="flex flex-col gap-1">
          {items.map((itemSchema, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-muted text-[10px] w-4 text-right shrink-0">
                {i}
              </span>
              <SchemaField
                value={arr[i]}
                schema={itemSchema}
                onChange={(v) => {
                  const next = [...arr];
                  next[i] = v;
                  onChange(next);
                }}
              />
            </div>
          ))}
        </div>
      );
    }

    case "object":
      return (
        <ObjectField
          value={value as Record<string, unknown>}
          schema={schema as ObjectSchema}
          onChange={onChange as (v: Record<string, unknown>) => void}
        />
      );

    case "taggedUnion":
      return (
        <TaggedUnionField
          value={value as Record<string, unknown>}
          schema={schema as TaggedUnionSchema}
          onChange={onChange as (v: Record<string, unknown>) => void}
        />
      );

    default:
      return (
        <span className="text-muted italic">
          {schema.type}
        </span>
      );
  }
}
