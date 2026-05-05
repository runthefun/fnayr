import { describe, it, expect } from "vitest";
import { inferAssetType, isTypeCompatible } from "./assetTypeDetection";

describe("inferAssetType", () => {
  it("maps image extensions to texture", () => {
    expect(inferAssetType("brick.png")).toBe("texture");
    expect(inferAssetType("photo.jpg")).toBe("texture");
    expect(inferAssetType("icon.webp")).toBe("texture");
  });

  it("maps model extensions to glb", () => {
    expect(inferAssetType("robot.glb")).toBe("glb");
    expect(inferAssetType("scene.gltf")).toBe("glb");
  });

  it("maps video extensions to videoClip", () => {
    expect(inferAssetType("clip.mp4")).toBe("videoClip");
    expect(inferAssetType("intro.webm")).toBe("videoClip");
  });

  it("maps audio extensions to audioClip", () => {
    expect(inferAssetType("song.mp3")).toBe("audioClip");
    expect(inferAssetType("effect.wav")).toBe("audioClip");
    expect(inferAssetType("music.ogg")).toBe("audioClip");
  });

  it("is case insensitive", () => {
    expect(inferAssetType("Brick.PNG")).toBe("texture");
    expect(inferAssetType("Robot.GLB")).toBe("glb");
    expect(inferAssetType("Song.MP3")).toBe("audioClip");
  });

  it("returns null for unknown extensions", () => {
    expect(inferAssetType("readme.txt")).toBeNull();
    expect(inferAssetType("data.json")).toBeNull();
  });

  it("returns null for files with no extension", () => {
    expect(inferAssetType("Makefile")).toBeNull();
  });
});

describe("isTypeCompatible", () => {
  it("returns true when types match", () => {
    expect(isTypeCompatible("texture", "texture")).toBe(true);
    expect(isTypeCompatible("glb", "glb")).toBe(true);
  });

  it("returns false when types mismatch", () => {
    expect(isTypeCompatible("texture", "glb")).toBe(false);
    expect(isTypeCompatible("glb", "audioClip")).toBe(false);
  });

  it("returns true when inferred is null (unknown extension)", () => {
    expect(isTypeCompatible("texture", null)).toBe(true);
  });
});
