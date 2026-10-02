import { describe, expect, it, vi } from "vitest";

import { createLoadJsonObjectFromUrl } from "./json-object-loader";

const asJsonObject = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, never>)
    : null;

type Bindings = { PUBLIC_APP_ORIGIN: string };
type AppRequest = (requestUrl: string, init: RequestInit, bindings: Bindings) => Promise<Response>;

const createLoader = (appRequest: AppRequest) =>
  createLoadJsonObjectFromUrl<Bindings>({
    appRequest,
    asJsonObject,
    publicAppOrigin: (bindings) => bindings.PUBLIC_APP_ORIGIN,
    publicResourceNetwork: () => {
      throw new Error("same-origin resources must not use the public network");
    },
  });

describe("createLoadJsonObjectFromUrl", () => {
  it("routes same-origin resources to the app with the absolute canonical URL", async () => {
    const appRequest = vi.fn<AppRequest>(async () =>
      Response.json({ type: ["VerifiableCredential", "BitstringStatusListCredential"] }),
    );
    const load = createLoader(appRequest);

    const result = await load(
      { env: { PUBLIC_APP_ORIGIN: "https://badges.example.edu" } },
      "https://badges.example.edu/credentials/v1/status-lists/t1/revocation?v=2",
      "application/ld+json",
    );

    expect(result.status).toBe("ok");
    expect(appRequest).toHaveBeenCalledTimes(1);
    expect(appRequest.mock.calls[0]?.[0]).toBe(
      "https://badges.example.edu/credentials/v1/status-lists/t1/revocation?v=2",
    );
  });

  it("reports a non-OK app response as an error", async () => {
    const appRequest = vi.fn<AppRequest>(async () => new Response(null, { status: 308 }));
    const load = createLoader(appRequest);

    const result = await load(
      { env: { PUBLIC_APP_ORIGIN: "https://badges.example.edu" } },
      "https://badges.example.edu/credentials/v1/status-lists/t1/revocation",
      "application/ld+json",
    );

    expect(result.status).toBe("error");
  });
});
