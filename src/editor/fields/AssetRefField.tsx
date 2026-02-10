import { useRef, useState } from "react";
import type { ObjectSchema, SchemaLike } from "../../engine/schema";
import { SchemaField } from "./SchemaField";
import { useProjectFolder, useThumbnailCache } from "../useEditor";
import { inferAssetType, isTypeCompatible } from "../assetTypeDetection";

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
  const projectFolder = useProjectFolder();
  const thumbnailCache = useThumbnailCache();
  const [dragOver, setDragOver] = useState(false);
  const [typeWarning, setTypeWarning] = useState<string | null>(null);

  const assetType = value.type as string | undefined;
  const accept = assetType ? acceptByType[assetType] : undefined;

  function checkTypeWarning(filename: string): boolean {
    if (!assetType) return false;
    const inferred = inferAssetType(filename);
    if (!isTypeCompatible(assetType, inferred)) {
      setTypeWarning(`Expected ${assetType}, got ${inferred}`);
      return true;
    }
    setTypeWarning(null);
    return false;
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    checkTypeWarning(file.name);

    try {
      const relativePath = await projectFolder.importFile(file);
      onChange({ ...value, uri: relativePath });
    } catch (err) {
      console.warn("Failed to import file:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes("application/x-fnayr-asset") ||
      e.dataTransfer.types.includes("Files")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Internal asset browser drop
    const assetData = e.dataTransfer.getData("application/x-fnayr-asset");
    if (assetData) {
      try {
        const { path } = JSON.parse(assetData) as { path: string; type: string | null };
        checkTypeWarning(path);
        onChange({ ...value, uri: path });
        return;
      } catch {}
    }

    // External file drop from OS
    const file = e.dataTransfer.files?.[0];
    if (file) {
      checkTypeWarning(file.name);

      try {
        const relativePath = await projectFolder.importFile(file);
        onChange({ ...value, uri: relativePath });
      } catch (err) {
        console.warn("Failed to import dropped file:", err);
      }
    }
  };

  const uri = (value.uri as string) ?? "";
  const thumb = uri && projectFolder.isOpen ? thumbnailCache.getThumbnail(uri) : null;

  return (
    <div className="flex flex-col gap-2">
      {/* URI field with browse button */}
      <div>
        <div className="text-muted text-label mb-0.5 font-medium flex items-center gap-2">
          <span>uri</span>
          {thumb && <img src={thumb} alt="" className="w-8 h-8 object-contain rounded border border-subtle" />}
        </div>
        <div
          className={`flex gap-1 rounded ${dragOver ? "ring-1 ring-accent/50" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="text"
            value={uri}
            onChange={(e) => {
              setTypeWarning(null);
              onChange({ ...value, uri: e.target.value });
            }}
            className="bg-input border border-subtle rounded px-1.5 py-1 w-full text-primary outline-none focus:border-focus hover:border-border min-w-0 text-body"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-surface border border-subtle rounded px-2 py-1 text-secondary hover:text-primary hover:bg-surface-hover shrink-0 text-label font-medium cursor-pointer"
          >
            Browse
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
        {typeWarning && (
          <div className="text-amber-400 text-label mt-1">{typeWarning}</div>
        )}
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
