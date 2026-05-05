import type { SceneRow, TreeNode, BlobMeta } from "../../shared/types.js";

export type { SceneRow, TreeNode, BlobMeta };

export interface IDatabase {
  listScenes(): Promise<SceneRow[]>;
  getScene(id: string): Promise<SceneRow | null>;
  createScene(name: string, data: string): Promise<SceneRow>;
  updateScene(id: string, name: string, data: string): Promise<SceneRow>;
  deleteScene(id: string): Promise<void>;
  close(): void;
}

export interface IBlobStorage {
  read(path: string): Promise<{ data: Buffer; mime: string } | null>;
  write(path: string, data: Buffer, mime: string): Promise<BlobMeta>;
  remove(path: string): Promise<void>;
  list(): Promise<TreeNode[]>;
  exists(path: string): Promise<boolean>;
}

export interface IJobQueue {
  enqueue<T>(jobType: string, payload: T): Promise<string>;
  process(jobType: string, handler: (payload: any) => Promise<void>): void;
  close(): Promise<void>;
}
