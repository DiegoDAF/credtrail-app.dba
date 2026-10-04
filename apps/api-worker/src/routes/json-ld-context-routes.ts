import { trustedCredentialContext } from "@credtrail/core-domain";
import { sha256Hex } from "../utils/crypto";
import type { Hono } from "hono";
import type { AppEnv } from "../app/types";

export const registerJsonLdContextRoutes = (app: Hono<AppEnv>): void => {
  const body = JSON.stringify(trustedCredentialContext, null, 2);
  const etag = sha256Hex(body).then((digest) => `"${digest}"`);
  app.on(["GET", "HEAD"], "/ns/trusted-credential/v1", async (c) => {
    const tag = await etag;
    const headers = {
      "content-type": "application/ld+json; charset=utf-8",
      "cache-control": "public, max-age=86400",
      etag: tag,
    };
    if (c.req.header("if-none-match") === tag) return new Response(null, { status: 304, headers });
    return new Response(c.req.method === "HEAD" ? null : body, { headers });
  });
};
