export type FileNode = { kind: "file"; name: string; path: string };
export type FolderNode = {
  kind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
};
export type TreeNode = FileNode | FolderNode;

export interface SceneRow {
  id: string;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface BlobMeta {
  path: string;
  mime: string;
  size: number;
}

const SUBFOLDER_BY_MIME: [RegExp, string][] = [
  [/^image\//, "textures"],
  [/^video\//, "videos"],
  [/^audio\//, "audio"],
];

const SUBFOLDER_BY_EXT: Record<string, string> = {
  ".glb": "models",
  ".gltf": "models",
  ".fbx": "models",
  ".obj": "models",
};

export function inferSubfolder(fileName: string, mimeType: string): string {
  for (const [re, folder] of SUBFOLDER_BY_MIME) {
    if (re.test(mimeType)) return folder;
  }
  const ext = fileName.includes(".")
    ? "." + fileName.split(".").pop()!.toLowerCase()
    : "";
  return SUBFOLDER_BY_EXT[ext] ?? "assets";
}

export function deduplicateName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  while (existing.has(`${base}_${i}${ext}`)) i++;
  return `${base}_${i}${ext}`;
}
