import {
  isBlockedNetworkHostname,
  isPublicNetworkAddress,
  literalNetworkAddress,
} from "./public-network-address";

/** Parses a public HTTP URL; hostname resolution is checked separately before fetching. */
export const publicHttpUrl = (value: string, base?: string | URL): URL | null => {
  if (value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value, base);
    const address = literalNetworkAddress(url.hostname);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      isBlockedNetworkHostname(url.hostname) ||
      (address !== null && !isPublicNetworkAddress(address))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};
