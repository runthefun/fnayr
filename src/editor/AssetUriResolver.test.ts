import { describe, it, expect, vi } from "vitest";
import { AssetUriResolver } from "./AssetUriResolver";
import type { ProjectFolder } from "./ProjectFolder";

function makeMockFolder(open = true): ProjectFolder {
  return {
    isOpen: open,
    createObjectURL: vi.fn((path: string) => `/api/assets/file/${path}`),
  } as unknown as ProjectFolder;
}

describe("AssetUriResolver", () => {
  describe("isRelativePath", () => {
    it("returns true for relative paths", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("textures/brick.png")).toBe(true);
      expect(resolver.isRelativePath("models/car.glb")).toBe(true);
    });

    it("returns false for absolute/blob/data/api URIs", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("http://example.com/a.png")).toBe(false);
      expect(resolver.isRelativePath("https://example.com/a.png")).toBe(false);
      expect(resolver.isRelativePath("blob:abc123")).toBe(false);
      expect(resolver.isRelativePath("data:image/png;base64,")).toBe(false);
      expect(resolver.isRelativePath("/api/assets/file/textures/a.png")).toBe(false);
    });

    it("returns false for empty string", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("")).toBe(false);
    });
  });

  describe("resolve", () => {
    it("passes through absolute URIs", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.resolve("http://example.com/a.png")).toBe("http://example.com/a.png");
      expect(resolver.resolve("blob:abc")).toBe("blob:abc");
    });

    it("passes through empty string", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.resolve("")).toBe("");
    });

    it("resolves relative path to server URL", () => {
      const folder = makeMockFolder();
      const resolver = new AssetUriResolver(folder);
      const result = resolver.resolve("textures/brick.png");
      expect(result).toBe("/api/assets/file/textures/brick.png");
      expect(folder.createObjectURL).toHaveBeenCalledWith("textures/brick.png");
    });

    it("passes through relative paths when folder is not open", () => {
      const folder = makeMockFolder(false);
      const resolver = new AssetUriResolver(folder);
      expect(resolver.resolve("textures/brick.png")).toBe("textures/brick.png");
    });
  });

  describe("release", () => {
    it("is a no-op (does not throw)", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(() => resolver.release("textures/brick.png")).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("is a no-op (does not throw)", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(() => resolver.dispose()).not.toThrow();
    });
  });
});
