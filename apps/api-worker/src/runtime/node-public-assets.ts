import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const PUBLIC_ASSET_PREFIX = "/assets/ui/";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

export type NodePublicAssetHandler = (request: Request) => Promise<Response | null>;

/**
 * Serves the hashed UI assets under `/assets/ui/*` from the built `public` directory.
 *
 * On Cloudflare Workers the static assets binding serves `apps/api-worker/public` before the
 * Worker runs. The Node runtime has no such layer, so without this every page loads without its
 * CSS and JavaScript (the login form cannot submit). Mirrors `public/_headers`: the files are
 * content-hashed, so they are cached as immutable.
 *
 * Returns `null` when the request is not a readable asset, so the caller falls through to the app.
 */
export const createNodePublicAssetHandler = (publicDir: string): NodePublicAssetHandler => {
  const root = resolve(publicDir);

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return null;
    }

    const pathname = new URL(request.url).pathname;

    if (!pathname.startsWith(PUBLIC_ASSET_PREFIX)) {
      return null;
    }

    let decodedPath: string;

    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return null;
    }

    const filePath = resolve(root, `.${decodedPath}`);

    if (!filePath.startsWith(root + sep)) {
      return null;
    }

    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()];

    if (contentType === undefined) {
      return null;
    }

    let body: Buffer;

    try {
      body = await readFile(filePath);
    } catch {
      return null;
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });

    return new Response(request.method === "HEAD" ? null : new Uint8Array(body), {
      status: 200,
      headers,
    });
  };
};
