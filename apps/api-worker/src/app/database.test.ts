import type { SqlDatabase } from "@credtrail/db";
import type { CreatePostgresDatabaseOptions } from "@credtrail/db/postgres";
import { describe, expect, it } from "vitest";
import type { AppBindings } from "./types";
import { createDatabaseResolver } from "./database";
const bindings = (input: Partial<AppBindings>): AppBindings => ({
  APP_ENV: "test",
  PLATFORM_DOMAIN: "badges.example.edu",
  PUBLIC_APP_ORIGIN: "https://badges.example.edu",
  BADGE_OBJECTS: {
    head: async () => null,
    get: async () => null,
    put: async () => null,
    delete: async () => undefined,
  },
  ...input,
});
describe("database runtime policy", () => {
  const calls: CreatePostgresDatabaseOptions[] = [];
  const db: SqlDatabase = {
    prepare: () => {
      throw new Error("Recording database is not queried");
    },
  };
  const resolve = createDatabaseResolver((input) => {
    calls.push(input);
    return db;
  });
  it("uses single-use Hyperdrive, including production Workers", () => {
    calls.length = 0;
    resolve(
      bindings({
        APP_ENV: "production",
        HYPERDRIVE: { connectionString: "postgres://pool.example/db" } as Hyperdrive,
      }),
    );
    expect(calls).toEqual([
      { databaseUrl: "postgres://pool.example/db", connectionMode: "single-use" },
    ]);
  });
  it.each([undefined, "worker"] as const)(
    "rejects production without Hyperdrive for %s runtime",
    (runtime) => {
      expect(() =>
        resolve(
          bindings({
            APP_ENV: "production",
            ...(runtime === undefined ? {} : { RUNTIME: runtime }),
            DATABASE_URL: "postgres://direct.example/db",
          }),
        ),
      ).toThrow("HYPERDRIVE is required in production");
    },
  );
  it("permits and reuses pooled production Node connections", () => {
    calls.length = 0;
    const env = bindings({
      APP_ENV: "production",
      RUNTIME: "node",
      DATABASE_URL: "postgres://node.example/db",
    });
    expect(resolve(env)).toBe(db);
    expect(resolve(env)).toBe(db);
    expect(calls).toEqual([{ databaseUrl: "postgres://node.example/db", connectionMode: "pool" }]);
  });
  it("rejects missing Node database URL", () => {
    expect(() =>
      resolve(bindings({ APP_ENV: "production", RUNTIME: "node", DATABASE_URL: " " })),
    ).toThrow("DATABASE_URL");
  });
});
