import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { app } from "../app";
import type { AppBindings } from "../app/types";
import { createNodePublicAssets } from "../runtime/node-public-assets";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const productionBindings = (): AppBindings => ({
  APP_ENV: "production",
  RUNTIME: "node",
  PLATFORM_DOMAIN: "badges.example.edu",
  PUBLIC_APP_ORIGIN: "https://badges.example.edu",
  BADGE_OBJECTS: {
    head: async () => null,
    get: async () => null,
    put: async () => null,
    delete: async () => undefined,
  },
});

it("applies shared response policies to filesystem assets and misses, preserving HEAD and caching", async () => {
  const root = await mkdtemp(join(tmpdir(), "credtrail-asset-route-"));
  directories.push(root);
  await writeFile(join(root, "login.abcdef012345.css"), "body{}");
  const env = { ...productionBindings(), PUBLIC_ASSETS: createNodePublicAssets(root) };

  for (const [file, method, status] of [
    ["login.abcdef012345.css", "GET", 200],
    ["login.abcdef012345.css", "HEAD", 200],
    ["missing.css", "GET", 404],
  ] as const) {
    const response = await app.request(
      `https://badges.example.edu/assets/ui/${file}`,
      { method, headers: { "x-request-id": "asset-policy-request" } },
      env,
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("x-request-id")).toBe("asset-policy-request");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      status === 200 ? "public, max-age=31536000, immutable" : "no-store",
    );
    expect(response.headers.get("content-length")).toBe(status === 200 ? "6" : null);
    expect(await response.text()).toBe(method === "HEAD" || status === 404 ? "" : "body{}");
  }
});

it("uses the shared origin policy and returns a protected 404 without an asset binding", async () => {
  const response = await app.request(
    "https://untrusted.example.edu/assets/ui/login.css",
    undefined,
    productionBindings(),
  );
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://badges.example.edu/assets/ui/login.css");
  expect(response.headers.get("x-request-id")).toBeTruthy();

  const missing = await app.request(
    "https://badges.example.edu/assets/ui/login.css",
    undefined,
    productionBindings(),
  );
  expect(missing.status).toBe(404);
  expect(missing.headers.get("x-content-type-options")).toBe("nosniff");
});
