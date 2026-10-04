import { Hono } from "hono";
import { expect, it } from "vitest";
import type { AppBindings, AppEnv } from "../app/types";
import { observabilityContext } from "../app/observability";
import { asJsonObject } from "../utils/value-parsers";
import { registerCommonMiddleware } from "./common-middleware";
import { createLoadJsonObjectFromUrl } from "./json-object-loader";
const env: AppBindings = {
  APP_ENV: "production",
  PUBLIC_APP_ORIGIN: "https://badges.example.edu",
  PLATFORM_DOMAIN: "badges.example.edu",
  BADGE_OBJECTS: {
    head: async () => null,
    get: async () => null,
    put: async () => null,
    delete: async () => undefined,
  },
};
it("dispatches a canonical absolute URL through real production middleware and preserves request contract", async () => {
  const app = new Hono<AppEnv>();
  registerCommonMiddleware({ app, observabilityContext });
  app.get("/resource", (c) =>
    c.json({
      query: c.req.query("value"),
      accept: c.req.header("accept"),
      agent: c.req.header("user-agent"),
      method: c.req.method,
    }),
  );
  app.get("/invalid", (c) => c.text("invalid"));
  const load = createLoadJsonObjectFromUrl<AppBindings>({
    appRequest: async (url, init, bindings) => app.request(url, init, bindings),
    asJsonObject,
    publicAppOrigin: (bindings) => bindings.PUBLIC_APP_ORIGIN,
    publicResourceNetwork: () => {
      throw new Error("Network must not be used for local resources");
    },
  });
  expect(
    await load(
      { env },
      "https://badges.example.edu/resource?value=retained",
      "application/ld+json",
    ),
  ).toMatchObject({
    status: "ok",
    value: {
      query: "retained",
      accept: "application/ld+json",
      method: "GET",
      agent: expect.stringContaining("CredTrail"),
    },
  });
  expect(await load({ env }, "https://badges.example.edu/missing", "application/json")).toEqual({
    status: "error",
    reason: "HTTP 404",
  });
  expect(await load({ env }, "https://badges.example.edu/invalid", "application/json")).toEqual({
    status: "error",
    reason: "response is not a JSON object",
  });
  expect(await load({ env }, "https://alias.example.edu/resource", "application/json")).toEqual({
    status: "error",
    reason: "request failed",
  });
  expect((await app.request("https://alias.example.edu/resource", {}, env)).status).toBe(308);
});
