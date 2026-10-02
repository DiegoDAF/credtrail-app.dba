import { describe, expect, it } from "vitest";

import { applyForwardedRequestOrigin } from "./node-forwarded-origin";
import { parseNodeRuntimeTrustProxyHeaders } from "./node-runtime";

describe("applyForwardedRequestOrigin", () => {
  it("returns the same request when no forwarded protocol is present", () => {
    const request = new Request("http://badges.example.edu/healthz");

    expect(applyForwardedRequestOrigin(request)).toBe(request);
  });

  it("ignores forwarded protocols other than http and https", () => {
    const request = new Request("http://badges.example.edu/healthz", {
      headers: { "x-forwarded-proto": "ftp" },
    });

    expect(applyForwardedRequestOrigin(request)).toBe(request);
  });

  it("upgrades the request URL to the forwarded protocol", () => {
    const request = new Request("http://badges.example.edu/v1/things?page=2", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(applyForwardedRequestOrigin(request).url).toBe(
      "https://badges.example.edu/v1/things?page=2",
    );
  });

  it("uses the forwarded host and the first value of a forwarded list", () => {
    const request = new Request("http://app:8787/healthz", {
      headers: {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "badges.example.edu, internal.example.edu",
      },
    });

    expect(applyForwardedRequestOrigin(request).url).toBe("https://badges.example.edu/healthz");
  });

  it("returns the same request when the URL already matches", () => {
    const request = new Request("https://badges.example.edu/healthz", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "badges.example.edu" },
    });

    expect(applyForwardedRequestOrigin(request)).toBe(request);
  });

  it("keeps method, headers and body", async () => {
    const request = new Request("http://badges.example.edu/v1/auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ email: "learner@example.edu" }),
    });

    const forwarded = applyForwardedRequestOrigin(request);

    expect(forwarded.url).toBe("https://badges.example.edu/v1/auth");
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("content-type")).toBe("application/json");
    await expect(forwarded.json()).resolves.toEqual({ email: "learner@example.edu" });
  });
});

describe("parseNodeRuntimeTrustProxyHeaders", () => {
  it("is off unless TRUST_PROXY_HEADERS is enabled", () => {
    expect(parseNodeRuntimeTrustProxyHeaders({})).toBe(false);
    expect(parseNodeRuntimeTrustProxyHeaders({ TRUST_PROXY_HEADERS: "false" })).toBe(false);
    expect(parseNodeRuntimeTrustProxyHeaders({ TRUST_PROXY_HEADERS: "true" })).toBe(true);
  });
});
