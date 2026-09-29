import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration suites share this database, including migrations that scan all
    // tenants. Serial files keep those scans from racing fixture cleanup.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
