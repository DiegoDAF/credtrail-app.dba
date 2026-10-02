import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodePublicAssetHandler, type NodePublicAssetHandler } from "./node-public-assets";

let workDir: string;
let handler: NodePublicAssetHandler;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "credtrail-public-"));
  const publicDir = join(workDir, "public");
  await mkdir(join(publicDir, "assets", "ui", "fonts"), { recursive: true });
  await writeFile(join(publicDir, "assets", "ui", "foundation.abc123.css"), "body{margin:0}");
  await writeFile(join(publicDir, "assets", "ui", "auth-login.def456.js"), "console.log(1);");
  await writeFile(join(publicDir, "assets", "ui", "fonts", "inter.woff2"), "wOF2");
  await writeFile(join(publicDir, "assets", "ui", "notes.txt"), "not an asset type");
  await writeFile(join(publicDir, "_headers"), "/assets/ui/*");
  await writeFile(join(workDir, "secret.css"), "outside the public directory");
  handler = createNodePublicAssetHandler(publicDir);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const get = (path: string, method = "GET") =>
  handler(new Request(`http://badges.example.edu${path}`, { method }));

describe("createNodePublicAssetHandler", () => {
  it("serves CSS with immutable caching and nosniff", async () => {
    const response = await get("/assets/ui/foundation.abc123.css");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response?.text()).resolves.toBe("body{margin:0}");
  });

  it("serves JavaScript and fonts with their content types", async () => {
    const script = await get("/assets/ui/auth-login.def456.js");
    const font = await get("/assets/ui/fonts/inter.woff2");

    expect(script?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(font?.headers.get("content-type")).toBe("font/woff2");
  });

  it("answers HEAD without a body", async () => {
    const response = await get("/assets/ui/foundation.abc123.css", "HEAD");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBe("14");
    await expect(response?.text()).resolves.toBe("");
  });

  it("falls through for other paths, methods, missing files and unknown types", async () => {
    await expect(get("/login")).resolves.toBeNull();
    await expect(get("/_headers")).resolves.toBeNull();
    await expect(get("/assets/ui/foundation.abc123.css", "POST")).resolves.toBeNull();
    await expect(get("/assets/ui/missing.css")).resolves.toBeNull();
    await expect(get("/assets/ui/notes.txt")).resolves.toBeNull();
  });

  it("never reads outside the public directory", async () => {
    await expect(get("/assets/ui/%2e%2e/%2e%2e/%2e%2e/secret.css")).resolves.toBeNull();
    await expect(get("/assets/ui/..%2f..%2f..%2fsecret.css")).resolves.toBeNull();
    await expect(get("/assets/ui/%E0%A4%A")).resolves.toBeNull();
  });
});
