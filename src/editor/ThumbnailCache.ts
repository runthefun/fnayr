import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { ProjectFolder } from "./ProjectFolder";
import { inferAssetType } from "./assetTypeDetection";

type ThumbnailEntry = {
  dataUrl: string | null;
  loading: boolean;
};

const IMAGE_SIZE = 48;
const MODEL_SIZE = 96;

export class ThumbnailCache {
  private _cache = new Map<string, ThumbnailEntry>();
  private _listeners = new Set<() => void>();
  private _version = 0;

  // Lazily created offscreen renderer shared across all GLB thumbnails
  private _offscreenRenderer: THREE.WebGLRenderer | null = null;
  private _gltfLoader: GLTFLoader | null = null;

  constructor(private _projectFolder: ProjectFolder) {}

  getThumbnail(relativePath: string): string | null {
    const existing = this._cache.get(relativePath);
    if (existing) return existing.dataUrl;

    // Start async generation
    this._cache.set(relativePath, { dataUrl: null, loading: true });
    this._generate(relativePath);
    return null;
  }

  private async _generate(relativePath: string): Promise<void> {
    // Yield to avoid notifying during a React render cycle
    await Promise.resolve();
    try {
      const type = inferAssetType(relativePath);
      let dataUrl: string | null = null;

      if (type === "texture") {
        dataUrl = await this._generateImageThumbnail(relativePath);
      } else if (type === "glb") {
        dataUrl = await this._generateModelThumbnail(relativePath);
      }

      this._cache.set(relativePath, { dataUrl, loading: false });
      this._notify();
    } catch {
      this._cache.set(relativePath, { dataUrl: null, loading: false });
      this._notify();
    }
  }

  private async _generateImageThumbnail(relativePath: string): Promise<string> {
    const file = await this._projectFolder.getFile(relativePath);
    const blobUrl = URL.createObjectURL(file);

    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = IMAGE_SIZE;
        canvas.height = IMAGE_SIZE;
        const ctx = canvas.getContext("2d")!;

        // Fit image into square, centered
        const scale = Math.min(IMAGE_SIZE / img.width, IMAGE_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (IMAGE_SIZE - w) / 2;
        const y = (IMAGE_SIZE - h) / 2;

        ctx.drawImage(img, x, y, w, h);
        URL.revokeObjectURL(blobUrl);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("Failed to load image"));
      };
      img.src = blobUrl;
    });
  }

  private _getOffscreenRenderer(): THREE.WebGLRenderer {
    if (!this._offscreenRenderer) {
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_SIZE;
      canvas.height = MODEL_SIZE;
      this._offscreenRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      this._offscreenRenderer.setSize(MODEL_SIZE, MODEL_SIZE, false);
      this._offscreenRenderer.setClearColor(0x000000, 0);
    }
    return this._offscreenRenderer;
  }

  private _getGltfLoader(): GLTFLoader {
    if (!this._gltfLoader) {
      const draco = new DRACOLoader();
      draco.setDecoderPath(
        "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
      );
      this._gltfLoader = new GLTFLoader();
      this._gltfLoader.setDRACOLoader(draco);
    }
    return this._gltfLoader;
  }

  private async _generateModelThumbnail(relativePath: string): Promise<string> {
    const file = await this._projectFolder.getFile(relativePath);
    const blobUrl = URL.createObjectURL(file);

    try {
      const gltf = await new Promise<THREE.Group>((resolve, reject) => {
        this._getGltfLoader().load(
          blobUrl,
          (result) => resolve(result.scene),
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });

      const renderer = this._getOffscreenRenderer();

      // Build a tiny scene
      const scene = new THREE.Scene();
      scene.add(gltf);

      // Lights
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(1, 2, 3);
      scene.add(ambient, dir);

      // Auto-frame camera from bounding box
      const box = new THREE.Box3().setFromObject(gltf);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, maxDim * 10);
      const dist = maxDim / (2 * Math.tan((Math.PI * 45) / 360));
      camera.position.set(
        center.x + dist * 0.7,
        center.y + dist * 0.5,
        center.z + dist,
      );
      camera.lookAt(center);

      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");

      // Dispose the loaded model
      gltf.traverse((node) => {
        if ((node as any).geometry) (node as any).geometry.dispose();
        if ((node as any).material) {
          const mats = Array.isArray((node as any).material)
            ? (node as any).material
            : [(node as any).material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });

      return dataUrl;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  invalidate(relativePath: string): void {
    this._cache.delete(relativePath);
    this._notify();
  }

  clear(): void {
    this._cache.clear();
    this._notify();
  }

  dispose(): void {
    this._offscreenRenderer?.dispose();
    this._offscreenRenderer = null;
    this._cache.clear();
  }

  // useSyncExternalStore integration
  subscribe = (cb: () => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  getSnapshot = (): number => {
    return this._version;
  };

  private _notify(): void {
    this._version++;
    for (const cb of this._listeners) cb();
  }
}
