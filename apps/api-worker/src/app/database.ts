import type { SqlDatabase } from "@credtrail/db";
import { createPostgresDatabase } from "@credtrail/db/postgres";
import type { AppBindings } from "./types";

export const createDatabaseResolver = (
  createDatabase: typeof createPostgresDatabase = createPostgresDatabase,
): ((bindings: AppBindings) => SqlDatabase) => {
  const databasesByCacheKey = new Map<string, SqlDatabase>();
  return (bindings) => {
    const hyperdriveConnectionString = bindings.HYPERDRIVE?.connectionString.trim();

    if (hyperdriveConnectionString !== undefined && hyperdriveConnectionString.length > 0) {
      return createDatabase({
        databaseUrl: hyperdriveConnectionString,
        connectionMode: "single-use",
      });
    }

    if (bindings.APP_ENV === "production" && bindings.RUNTIME !== "node") {
      throw new Error("HYPERDRIVE is required in production");
    }

    if (bindings.DATABASE_URL === undefined) {
      throw new Error("DATABASE_URL or HYPERDRIVE is required");
    }

    const databaseUrl = bindings.DATABASE_URL.trim();

    if (databaseUrl.length === 0) {
      throw new Error("DATABASE_URL or HYPERDRIVE is required");
    }

    const connectionMode = bindings.APP_ENV === "development" ? "single-use" : "pool";
    const databaseCacheKey = `${connectionMode}:${databaseUrl}`;
    const existingDatabase = databasesByCacheKey.get(databaseCacheKey);

    if (existingDatabase !== undefined) {
      return existingDatabase;
    }

    const database = createDatabase({
      databaseUrl,
      connectionMode,
    });
    databasesByCacheKey.set(databaseCacheKey, database);
    return database;
  };
};

export const resolveDatabase = createDatabaseResolver();
