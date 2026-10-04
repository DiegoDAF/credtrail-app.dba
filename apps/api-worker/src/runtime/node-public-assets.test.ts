import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodePublicAssets } from "./node-public-assets";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
describe("generated Node assets", () => {
  it("serves CSS, JavaScript and fonts with accurate HEAD and caching", async () => {
    const root = await mkdtemp(join(tmpdir(), "credtrail-assets-"));
    directories.push(root);
    await mkdir(join(root, "fonts"));
    for (const [file, body] of [
      ["login.abcdef012345.css", "body{}"],
      ["login.abcdef012345.js", "export{}"],
      ["fonts/newsreader-latin.woff2", "font"],
    ])
      await writeFile(join(root, file ?? ""), body ?? "");
    const serve = createNodePublicAssets(root);
    for (const [file, mime] of [
      ["login.abcdef012345.css", "text/css"],
      ["login.abcdef012345.js", "text/javascript"],
      ["fonts/newsreader-latin.woff2", "font/woff2"],
    ]) {
      const response = await serve(new Request(`https://badges.example.edu/assets/ui/${file}`));
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toContain(mime);
      expect(response?.headers.get("cache-control")).toContain(
        file?.includes("fonts") ? "max-age=3600" : "immutable",
      );
      const head = await serve(
        new Request(`https://badges.example.edu/assets/ui/${file}`, { method: "HEAD" }),
      );
      expect(head?.headers.get("content-length")).toBe(response?.headers.get("content-length"));
      expect(await head?.text()).toBe("");
    }
  });
  it("rejects missing files, encodings, traversal, unsupported methods and escaping symlinks", async () => {
    const parent = await mkdtemp(join(tmpdir(), "credtrail-assets-"));
    directories.push(parent);
    const root = join(parent, "public");
    await mkdir(root);
    await writeFile(join(parent, "secret.js"), "secret");
    await symlink(join(parent, "secret.js"), join(root, "escape.js"));
    const serve = createNodePublicAssets(root);
    for (const file of ["missing.js", "%zz", "..%2fsecret.js", "escape.js"])
      expect(
        (await serve(new Request(`https://badges.example.edu/assets/ui/${file}`)))?.status,
      ).toBe(404);
    expect(
      (await serve(new Request("https://badges.example.edu/assets/ui/a.js", { method: "POST" })))
        ?.status,
    ).toBe(404);
    expect((await serve(new Request("https://badges.example.edu/login"))).status).toBe(404);
  });
});
