import type { Hono } from "hono";
import type { AppEnv } from "../app/types";

/** Serves runtime-provided UI assets behind the app's common HTTP policies. */
export const registerPublicAssetRoutes = (app: Hono<AppEnv>): void => {
  app.on(["GET", "HEAD"], "/assets/ui/*", (c) => {
    const fetchAsset = c.env.PUBLIC_ASSETS;
    return fetchAsset === undefined ? c.notFound() : fetchAsset(c.req.raw);
  });
};
