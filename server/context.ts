import type { IDatabase, IBlobStorage, IJobQueue } from "./services/types.js";

export type ServiceContext = {
  Variables: {
    db: IDatabase;
    storage: IBlobStorage;
    queue: IJobQueue;
  };
};
