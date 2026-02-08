import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { AssetLoader } from "../../assets/types";

export type GltfAsset = { gltf: GLTF };

export class GltfAssetLoader implements AssetLoader<GltfAsset> {
  private readonly loader: GLTFLoader;
  private readonly dracoLoader: DRACOLoader;

  constructor(loader?: GLTFLoader) {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.loader = loader ?? new GLTFLoader();
    this.loader.setDRACOLoader(this.dracoLoader);
  }

  load(uri: string): Promise<GltfAsset> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        uri,
        (gltf) => resolve({ gltf }),
        undefined,
        (error) => reject(error instanceof Error ? error : new Error(String(error)))
      );
    });
  }

  dispose(asset: GltfAsset): void {
    asset.gltf.scene.traverse((node) => {
      if ("geometry" in node && node.geometry) {
        (node.geometry as any).dispose();
      }
      if ("material" in node && node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat.map) mat.map.dispose();
          if (mat.normalMap) mat.normalMap.dispose();
          if (mat.roughnessMap) mat.roughnessMap.dispose();
          if (mat.metalnessMap) mat.metalnessMap.dispose();
          if (mat.emissiveMap) mat.emissiveMap.dispose();
          if (mat.aoMap) mat.aoMap.dispose();
          mat.dispose();
        }
      }
    });
  }
}
