import { useRef, useEffect } from "react";
import type { ObjectSchema, SchemaLike } from "../../engine/schema";
import { SchemaField } from "./SchemaField";

type Props = {
  value: Record<string, unknown>;
  schema: ObjectSchema;
  onChange: (value: Record<string, unknown>) => void;
};

const acceptByType: Record<string, string> = {
  texture: "image/*",
  glb: ".glb,.gltf",
  videoClip: "video/*",
  audioClip: "audio/*",
};

export function AssetRefField({ value, schema, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const assetType = value.type as string | undefined;
  const accept = assetType ? acceptByType[assetType] : undefined;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    onChange({ ...value, uri: url });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* URI field with browse button */}
      <div>
        <div className="text-muted text-[10px] mb-0.5">uri</div>
        <div className="flex gap-1">
          <input
            type="text"
            value={(value.uri as string) ?? ""}
            onChange={(e) => onChange({ ...value, uri: e.target.value })}
            className="bg-input border border-subtle rounded px-1.5 py-0.5 w-full text-primary outline-none focus:border-focus min-w-0"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-input border border-subtle rounded px-2 py-0.5 text-primary hover:bg-hover shrink-0 text-xs"
          >
            Browse…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Remaining fields (skip literal types and hidden fields, same as ObjectField) */}
      {Object.entries(schema.properties)
        .filter(
          ([key, propSchema]) =>
            key !== "uri" &&
            propSchema.type !== "literal" &&
            !propSchema.meta?.hidden
        )
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
