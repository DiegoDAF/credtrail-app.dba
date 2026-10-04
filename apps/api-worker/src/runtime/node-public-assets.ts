import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const mimeTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Only generated UI assets are exposed; real paths enforce symlink containment. */
export const createNodePublicAssets = (
  root: string,
): ((request: Request) => Promise<Response | null>) => {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/assets/ui/")) return null;
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 404 });
    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice("/assets/ui/".length));
    } catch {
      return new Response(null, { status: 404 });
    }
    if (
      relative.includes("\\") ||
      relative.includes("\0") ||
      relative.split("/").some((part) => part === ".." || part === ".")
    )
      return new Response(null, { status: 404 });
    try {
      const realRoot = await realpath(root);
      const filename = await realpath(resolve(realRoot, relative));
      if (!filename.startsWith(`${realRoot}${sep}`)) return new Response(null, { status: 404 });
      const info = await stat(filename);
      const mime = mimeTypes[extname(filename)];
      if (!info.isFile() || mime === undefined) return new Response(null, { status: 404 });
      const headers = {
        "content-type": mime,
        "content-length": String(info.size),
        "x-content-type-options": "nosniff",
        "cache-control": /[.-][a-f0-9]{8,}[.-]/iu.test(relative)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      };
      return new Response(request.method === "HEAD" ? null : await readFile(filename), { headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
};
