import { BlockList, isIP } from "node:net";
import { z } from "zod";
import type { AppBindings } from "../app/types";

const normalizeIp = (value: string): string => {
  return value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
};

const cidrSchema = z.string().transform((value, ctx) => {
  const parts = value.trim().split("/");
  const address = parts[0] ?? "";
  const family = isIP(address);
  const prefix = parts[1] === undefined ? (family === 4 ? 32 : 128) : Number(parts[1]);
  if (
    parts.length > 2 ||
    (parts[1] !== undefined && !/^\d{1,3}$/u.test(parts[1])) ||
    family === 0 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > (family === 4 ? 32 : 128)
  ) {
    ctx.addIssue({ code: "custom", message: "Invalid trusted proxy CIDR" });
    return z.NEVER;
  }
  return { address, prefix, family: family === 4 ? ("ipv4" as const) : ("ipv6" as const) };
});

export type NodeRequestAdaptation =
  | { readonly status: "ok"; readonly request: Request; readonly bindings: AppBindings }
  | { readonly status: "error"; readonly response: Response };

/** Trust is rooted in the transport peer, never in a header supplied by a caller. */
export const createNodeRequestAdapter = (
  trustedProxyCidrs: string | undefined,
): ((
  request: Request,
  peer: string | undefined,
  bindings: AppBindings,
) => NodeRequestAdaptation) => {
  const parsed = z
    .array(cidrSchema)
    .safeParse(trustedProxyCidrs?.trim() ? trustedProxyCidrs.split(",") : []);
  if (!parsed.success) throw new Error("TRUSTED_PROXY_CIDRS must contain valid IPv4 or IPv6 CIDRs");
  const trusted = new BlockList();
  for (const cidr of parsed.data) trusted.addSubnet(cidr.address, cidr.prefix, cidr.family);
  const isTrusted = (address: string): boolean => {
    const family = isIP(address);
    return family !== 0 && trusted.check(address, family === 4 ? "ipv4" : "ipv6");
  };

  return (request, peer, bindings) => {
    const peerIp = normalizeIp(peer ?? "");
    let clientIp = isIP(peerIp) === 0 ? "unknown" : peerIp;
    const url = new URL(request.url);
    if (isTrusted(peerIp)) {
      const proto = request.headers.get("x-forwarded-proto");
      const host = request.headers.get("x-forwarded-host");
      if (proto !== null || host !== null) {
        if (
          (proto !== "https" && proto !== "http") ||
          host === null ||
          !/^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/iu.test(host)
        ) {
          return {
            status: "error",
            response: new Response("Invalid forwarded origin", { status: 400 }),
          };
        }
        let forwarded: URL;
        try {
          forwarded = new URL(`${proto}://${host}`);
        } catch {
          return {
            status: "error",
            response: new Response("Invalid forwarded origin", { status: 400 }),
          };
        }
        if (forwarded.username !== "" || forwarded.password !== "" || forwarded.pathname !== "/") {
          return {
            status: "error",
            response: new Response("Invalid forwarded origin", { status: 400 }),
          };
        }
        url.protocol = forwarded.protocol;
        url.port = "";
        url.host = forwarded.host;
      }
      const forwardedFor = request.headers.get("x-forwarded-for");
      if (forwardedFor !== null) {
        const chain = forwardedFor.split(",").map((address) => normalizeIp(address.trim()));
        if (chain.some((address) => isIP(address) === 0)) {
          return {
            status: "error",
            response: new Response("Invalid forwarded address", { status: 400 }),
          };
        }
        for (const address of chain.reverse()) {
          if (!isTrusted(clientIp)) break;
          clientIp = address;
        }
      }
    }
    return {
      status: "ok",
      request: url.toString() === request.url ? request : new Request(url, request),
      bindings: { ...bindings, REQUEST_CLIENT_IP: clientIp },
    };
  };
};
