import { describe, expect, it } from "vitest";
import { colorCodec, mat4Codec, vec3Codec } from "./math";

describe("math codecs", () => {
  it("encodes vec3 tuples as canonical arrays", () => {
    const result = vec3Codec.encode([1, 2, 3]);

    expect(result.json).toEqual([1, 2, 3]);
    expect(result.issues).toEqual([]);
  });

  it("decodes mat4 tuples with the expected length", () => {
    const mat4 = Array.from({ length: 16 }, (_, index) => index);

    const result = mat4Codec.decode(mat4);

    expect(result.value).toEqual(mat4);
    expect(result.issues).toEqual([]);
  });

  it("validates color channel ranges", () => {
    const result = colorCodec.decode([-0.1, 0.5, 0.5, 2]);

    expect(result.issues).toEqual([
      { path: "$[0]", message: "Expected number >= 0" },
      { path: "$[3]", message: "Expected number <= 1" },
    ]);
  });
});
