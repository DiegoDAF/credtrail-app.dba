import { describe, expect, it } from "vitest";
import type { AppBindings } from "../app/types";
import { createNodeRequestAdapter } from "./node-request-adapter";

const bindings: AppBindings = {
  APP_ENV: "production",
  RUNTIME: "node",
  PLATFORM_DOMAIN: "badges.example.edu",
  PUBLIC_APP_ORIGIN: "https://badges.example.edu",
  BADGE_OBJECTS: {
    head: async () => null,
    get: async () => null,
    put: async () => null,
    delete: async () => undefined,
  },
};

describe("Node transport trust boundary", () => {
  it("preserves POST bytes, cookies, signal and query while removing the internal TLS proxy port", async () => {
    const controller = new AbortController();
    const request = new Request("http://internal:8787/v1/auth?tenant=one", {
      method: "POST",
      signal: controller.signal,
      body: new Uint8Array([0, 255, 17, 99]),
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "badges.example.edu",
        cookie: "session=one",
        origin: "https://badges.example.edu",
        "x-forwarded-for": "198.51.100.23",
      },
    });
    const adapted = createNodeRequestAdapter("10.0.0.0/8")(request, "10.0.0.1", bindings);
    expect(adapted.status).toBe("ok");
    if (adapted.status !== "ok") return;
    expect(adapted.request.url).toBe("https://badges.example.edu/v1/auth?tenant=one");
    expect(adapted.request.method).toBe("POST");
    expect(adapted.request.headers.get("cookie")).toBe("session=one");
    expect(new Uint8Array(await adapted.request.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 17, 99]),
    );
    expect(adapted.bindings.REQUEST_CLIENT_IP).toBe("198.51.100.23");
    expect(bindings.REQUEST_CLIENT_IP).toBeUndefined();
    expect(adapted.request.headers.get("origin")).toBe("https://badges.example.edu");
    controller.abort();
    expect(adapted.request.signal.aborted).toBe(true);
  });
  it("ignores every forwarded header from an untrusted socket", () => {
    const request = new Request("http://badges.example.edu:8787/login", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-for": "1.2.3.4",
        "cf-connecting-ip": "5.6.7.8",
      },
    });
    const adapted = createNodeRequestAdapter(undefined)(request, "::ffff:198.51.100.9", bindings);
    expect(adapted.status === "ok" && adapted.request).toBe(request);
    expect(adapted.status === "ok" && adapted.bindings.REQUEST_CLIENT_IP).toBe("198.51.100.9");
  });
  it("walks from the trusted end and stops before a forged leftmost address", () => {
    const adapted = createNodeRequestAdapter("10.0.0.0/8,2001:db8:1::/48")(
      new Request("https://badges.example.edu", {
        headers: { "x-forwarded-for": "1.2.3.4, 2001:db8:2::9, 10.0.0.2" },
      }),
      "2001:db8:1::1",
      bindings,
    );
    expect(adapted.status === "ok" && adapted.bindings.REQUEST_CLIENT_IP).toBe("2001:db8:2::9");
  });
  it.each([
    { "x-forwarded-proto": "https,http", "x-forwarded-host": "badges.example.edu" },
    { "x-forwarded-proto": "https", "x-forwarded-host": "evil@example.edu" },
    { "x-forwarded-proto": "https", "x-forwarded-host": "badges.example.edu/path" },
    { "x-forwarded-proto": "https" },
    { "x-forwarded-for": "garbage" },
  ])("rejects malformed trusted headers %j", (headers) => {
    expect(
      createNodeRequestAdapter("127.0.0.1/32")(
        new Request("http://internal", { headers }),
        "127.0.0.1",
        bindings,
      ).status,
    ).toBe("error");
  });
  it.each(["127.0.0.1/", "127.0.0.1/1e1", "127.0.0.1/0x10", "127.0.0.1/33", "::1/129", "garbage"])(
    "rejects invalid proxy config %s",
    (cidr) => {
      expect(() => createNodeRequestAdapter(cidr)).toThrow("TRUSTED_PROXY_CIDRS");
    },
  );
});

it.each(["badges.example.edu:443", "badges.example.edu:8443"])(
  "accepts explicit public ports %s",
  (host) => {
    const result = createNodeRequestAdapter("127.0.0.1/32")(
      new Request("http://internal:8787/path?q=1", {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": host },
      }),
      "127.0.0.1",
      bindings,
    );
    expect(result.status === "ok" && result.request.url).toBe(
      `https://${host === "badges.example.edu:443" ? "badges.example.edu" : host}/path?q=1`,
    );
  },
);
