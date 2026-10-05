import { describe, expect, it } from "vitest";
import { BETTER_AUTH_SESSION_COOKIE_NAMES } from "../auth/better-auth-config";
import { validateCsrfRequestOrigin } from "./csrf-protection";

describe("browser session origin checks", () => {
  it.each(BETTER_AUTH_SESSION_COOKIE_NAMES)("protects %s sessions", (name) => {
    const input = {
      method: "POST",
      requestUrl: new URL("https://badges.example.edu/tenants/example/admin/sharing"),
      cookieHeader: `other=value; ${name}=disposable`,
    };
    expect(validateCsrfRequestOrigin(input)).toBe(false);
    expect(validateCsrfRequestOrigin({ ...input, originHeader: "https://attacker.example" })).toBe(
      false,
    );
    expect(
      validateCsrfRequestOrigin({ ...input, originHeader: "https://badges.example.edu" }),
    ).toBe(true);
    expect(
      validateCsrfRequestOrigin({
        ...input,
        refererHeader: "https://badges.example.edu/tenants/example/admin/sharing",
      }),
    ).toBe(true);
  });
});
