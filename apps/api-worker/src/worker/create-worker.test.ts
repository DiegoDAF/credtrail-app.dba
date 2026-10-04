import { Hono } from "hono";
import { expect, it } from "vitest";
import type { AppEnv, AppBindings } from "../app/types";
import { observabilityContext } from "../app/observability";
import { createNodeExecutionContext } from "../runtime/node-runtime";
import { createApiWorker, type WorkerRuntimeBindings } from "./create-worker";

it("factory-owns Worker runtime identity and trusts only validated Cloudflare edge IP", async () => {
  const app = new Hono<AppEnv>();
  app.get("/identity", (c) => c.json({ runtime: c.env.RUNTIME, ip: c.env.REQUEST_CLIENT_IP }));
  const scheduledBindings: AppBindings[] = [];
  const worker = createApiWorker({
    app,
    observabilityContext,
    processScheduledQueue: async (env) => {
      scheduledBindings.push(env);
      return {
        leased: 0,
        processed: 0,
        succeeded: 0,
        retried: 0,
        deadLettered: 0,
        failedToFinalize: 0,
      };
    },
  });
  const env: WorkerRuntimeBindings = {
    RUNTIME: "node",
    REQUEST_CLIENT_IP: "forged",
    APP_ENV: "production",
    PLATFORM_DOMAIN: "badges.example.edu",
    PUBLIC_APP_ORIGIN: "https://badges.example.edu", // SAFETY: this factory test never invokes storage operations.
    BADGE_OBJECTS: {} as R2Bucket,
  };
  const fetchHandler = worker.fetch;
  if (fetchHandler === undefined) throw new Error("Missing fetch handler");
  for (const ip of ["198.51.100.9", "2001:db8::1", "malformed", ""]) {
    const response = await fetchHandler(
      // SAFETY: the factory consumes only standard Request headers, not Cloudflare cf metadata.
      new Request("https://badges.example.edu/identity", {
        headers: { "cf-connecting-ip": ip, "x-forwarded-for": "203.0.113.1" },
      }) as Request<unknown, IncomingRequestCfProperties>,
      env,
      createNodeExecutionContext(),
    );
    expect(await response.json()).toEqual({
      runtime: "worker",
      ip: ip === "malformed" || ip === "" ? "unknown" : ip,
    });
  }
  if (worker.scheduled === undefined) throw new Error("Missing scheduled handler");
  await worker.scheduled(
    { cron: "* * * * *", scheduledTime: Date.now(), noRetry: () => undefined },
    env,
    createNodeExecutionContext(),
  );
  expect(scheduledBindings[0]?.RUNTIME).toBe("worker");
  expect(env.RUNTIME).toBe("node");
});
