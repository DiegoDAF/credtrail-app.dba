const firstHeaderValue = (value: string | null): string | undefined => {
  const first = value?.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
};

/**
 * Rebuilds the request URL from `X-Forwarded-Proto` and `X-Forwarded-Host`.
 *
 * The Node server derives the request scheme from the socket, so behind a
 * TLS-terminating reverse proxy every request looks like `http://`. In
 * production that never matches `PUBLIC_APP_ORIGIN` and the canonical-origin
 * middleware answers 308 forever. Only use this when the app port is reachable
 * solely through a proxy that sets (and overwrites) those headers.
 */
export const applyForwardedRequestOrigin = (request: Request): Request => {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();

  if (forwardedProto !== "http" && forwardedProto !== "https") {
    return request;
  }

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const url = new URL(request.url);
  const originalHref = url.href;

  url.protocol = `${forwardedProto}:`;

  if (forwardedHost !== undefined) {
    // The host setter keeps the current port when the new value has none.
    url.port = "";
    url.host = forwardedHost;
  }

  if (url.href === originalHref) {
    return request;
  }

  return new Request(url, request);
};
