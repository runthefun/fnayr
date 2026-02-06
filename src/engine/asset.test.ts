import { describe, expect, it } from "vitest";
import { assetRefCodec } from "./asset";

describe("assetRefCodec", () => {
  it("encodes valid asset refs as canonical objects", () => {
    const result = assetRefCodec.encode({
      kind: "asset",
      type: "texture",
      uri: "tex.png",
    });

    expect(result.json).toEqual({
      kind: "asset",
      type: "texture",
      uri: "tex.png",
    });
    expect(result.issues).toEqual([]);
  });

  it("decodes valid asset refs with optional fields omitted", () => {
    const result = assetRefCodec.decode({
      kind: "asset",
      type: "glb",
      uri: "model.glb",
    });

    expect(result.value).toEqual({
      kind: "asset",
      type: "glb",
      uri: "model.glb",
    });
    expect(result.issues).toEqual([]);
  });

  it("reports invalid asset types", () => {
    const result = assetRefCodec.decode({
      kind: "asset",
      type: "unknown",
      uri: "x",
    });

    expect(result.issues).toEqual([
      {
        path: "$.type",
        message: "Expected one of texture, glb, videoClip, audioClip",
      },
    ]);
  });

  it("reports missing required fields when defaults are disabled", () => {
    const result = assetRefCodec.decode(
      { kind: "asset", type: "audioClip" },
      { applyDefaults: false }
    );

    expect(result.issues).toEqual([
      { path: "$.uri", message: "Missing required property" },
    ]);
  });

  it("preserves freeform options objects", () => {
    const result = assetRefCodec.decode({
      kind: "asset",
      type: "videoClip",
      uri: "v.mp4",
      options: { loop: true, tags: ["ui"] },
    });

    expect(result.value).toEqual({
      kind: "asset",
      type: "videoClip",
      uri: "v.mp4",
      options: { loop: true, tags: ["ui"] },
    });
    expect(result.issues).toEqual([]);
  });
});
