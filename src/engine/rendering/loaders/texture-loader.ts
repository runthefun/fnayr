import * as THREE from "three";
import type { AssetLoader } from "../../assets/types";

export type TextureAsset = { texture: THREE.Texture };

export class TextureAssetLoader implements AssetLoader<TextureAsset> {
  private readonly loader: THREE.TextureLoader;

  constructor(loader?: THREE.TextureLoader) {
    this.loader = loader ?? new THREE.TextureLoader();
  }

  load(uri: string): Promise<TextureAsset> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        uri,
        (texture) => resolve({ texture }),
        undefined,
        (error) => reject(error instanceof Error ? error : new Error(String(error)))
      );
    });
  }

  dispose(asset: TextureAsset): void {
    asset.texture.dispose();
  }
}
