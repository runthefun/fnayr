import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetUriResolver } from "./AssetUriResolver";
import type { ProjectFolder } from "./ProjectFolder";

function makeMockFolder(open = true): ProjectFolder {
  return {
    isOpen: open,
    createObjectURL: vi.fn(async (path: string) => `blob:mock/${path}`),
  } as unknown as ProjectFolder;
}

describe("AssetUriResolver", () => {
  describe("isRelativePath", () => {
    it("returns true for relative paths", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("textures/brick.png")).toBe(true);
      expect(resolver.isRelativePath("models/car.glb")).toBe(true);
    });

    it("returns false for absolute/blob/data URIs", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("http://example.com/a.png")).toBe(false);
      expect(resolver.isRelativePath("https://example.com/a.png")).toBe(false);
      expect(resolver.isRelativePath("blob:abc123")).toBe(false);
      expect(resolver.isRelativePath("data:image/png;base64,")).toBe(false);
    });

    it("returns false for empty string", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(resolver.isRelativePath("")).toBe(false);
    });
  });

  describe("resolve", () => {
    it("passes through absolute URIs", async () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(await resolver.resolve("http://example.com/a.png")).toBe("http://example.com/a.png");
      expect(await resolver.resolve("blob:abc")).toBe("blob:abc");
    });

    it("passes through empty string", async () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(await resolver.resolve("")).toBe("");
    });

    it("resolves relative path via project folder", async () => {
      const folder = makeMockFolder();
      const resolver = new AssetUriResolver(folder);
      const result = await resolver.resolve("textures/brick.png");
      expect(result).toBe("blob:mock/textures/brick.png");
      expect(folder.createObjectURL).toHaveBeenCalledWith("textures/brick.png");
    });

    it("caches resolved URLs and increments refcount", async () => {
      const folder = makeMockFolder();
      const resolver = new AssetUriResolver(folder);
      const r1 = await resolver.resolve("textures/brick.png");
      const r2 = await resolver.resolve("textures/brick.png");
      expect(r1).toBe(r2);
      expect(folder.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("passes through relative paths when folder is not open", async () => {
      const folder = makeMockFolder(false);
      const resolver = new AssetUriResolver(folder);
      expect(await resolver.resolve("textures/brick.png")).toBe("textures/brick.png");
    });
  });

  describe("release", () => {
    it("revokes URL when refcount reaches 0", async () => {
      const revokespy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const resolver = new AssetUriResolver(makeMockFolder());
      await resolver.resolve("textures/brick.png");
      resolver.release("textures/brick.png");
      expect(revokespy).toHaveBeenCalledWith("blob:mock/textures/brick.png");
      revokespy.mockRestore();
    });

    it("does not revoke URL when refcount > 0", async () => {
      const revokespy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const resolver = new AssetUriResolver(makeMockFolder());
      await resolver.resolve("textures/brick.png");
      await resolver.resolve("textures/brick.png");
      resolver.release("textures/brick.png");
      expect(revokespy).not.toHaveBeenCalled();
      revokespy.mockRestore();
    });

    it("ignores release for unknown URI", () => {
      const resolver = new AssetUriResolver(makeMockFolder());
      expect(() => resolver.release("unknown/path")).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("revokes all cached URLs", async () => {
      const revokespy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const resolver = new AssetUriResolver(makeMockFolder());
      await resolver.resolve("textures/a.png");
      await resolver.resolve("models/b.glb");
      resolver.dispose();
      expect(revokespy).toHaveBeenCalledTimes(2);
      revokespy.mockRestore();
    });
  });
});
