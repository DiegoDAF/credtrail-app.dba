import { trustedCredentialContext } from "@credtrail/core-domain";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { registerCommonMiddleware } from "../http/common-middleware";
import { observabilityContext } from "../app/observability";
import type { AppBindings, AppEnv } from "../app/types";
import { registerJsonLdContextRoutes } from "./json-ld-context-routes";
it("publishes the exact signing document with GET, HEAD and conditional caching", async () => {
  const app = new Hono<AppEnv>();
  registerCommonMiddleware({ app, observabilityContext });
  registerJsonLdContextRoutes(app);
  const env: AppBindings = {
    APP_ENV: "production",
    PLATFORM_DOMAIN: "badges.example.edu",
    PUBLIC_APP_ORIGIN: "https://badges.example.edu",
    BADGE_OBJECTS: {
      head: async () => null,
      get: async () => null,
      put: async () => null,
      delete: async () => undefined,
    },
  };
  const response = await app.request(
    "https://badges.example.edu/ns/trusted-credential/v1",
    {},
    env,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("public,");
  expect(await response.json()).toEqual(trustedCredentialContext);
  expect(response.headers.get("content-type")).toContain("application/ld+json");
  const head = await app.request(
    "https://badges.example.edu/ns/trusted-credential/v1",
    { method: "HEAD" },
    env,
  );
  expect(await head.text()).toBe("");
  expect(head.headers.get("etag")).toBe(response.headers.get("etag"));
  expect(
    (
      await app.request(
        "https://badges.example.edu/ns/trusted-credential/v1",
        {
          headers: { "if-none-match": response.headers.get("etag") ?? "" },
        },
        env,
      )
    ).status,
  ).toBe(304);
});
