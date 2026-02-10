export type AssetType = "texture" | "glb" | "videoClip" | "audioClip";

const EXT_MAP: Record<string, AssetType> = {
  // Textures
  ".png": "texture",
  ".jpg": "texture",
  ".jpeg": "texture",
  ".webp": "texture",
  ".gif": "texture",
  ".bmp": "texture",
  ".svg": "texture",
  ".tga": "texture",
  ".exr": "texture",
  ".hdr": "texture",
  // 3D models
  ".glb": "glb",
  ".gltf": "glb",
  // Video
  ".mp4": "videoClip",
  ".webm": "videoClip",
  ".mov": "videoClip",
  ".avi": "videoClip",
  // Audio
  ".mp3": "audioClip",
  ".wav": "audioClip",
  ".ogg": "audioClip",
  ".flac": "audioClip",
  ".aac": "audioClip",
};

export function inferAssetType(filename: string): AssetType | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

export function isTypeCompatible(
  expected: AssetType | string,
  inferred: AssetType | null,
): boolean {
  if (!inferred) return true; // unknown extension, allow
  return expected === inferred;
}
