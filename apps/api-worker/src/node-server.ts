import "./node-jsx-runtime";
import { serve } from "@hono/node-server";
import { app } from "./app";
import { applyForwardedRequestOrigin } from "./runtime/node-forwarded-origin";
import { createNodePublicAssetHandler } from "./runtime/node-public-assets";
import {
  createNodeExecutionContext,
  createNodeRuntimeBindings,
  parseNodeRuntimePort,
  parseNodeRuntimeTrustProxyHeaders,
} from "./runtime/node-runtime";

const workerBindings = createNodeRuntimeBindings(process.env);
const executionContext = createNodeExecutionContext();
const port = parseNodeRuntimePort(process.env);
const trustProxyHeaders = parseNodeRuntimeTrustProxyHeaders(process.env);
const servePublicAsset = createNodePublicAssetHandler(process.env.PUBLIC_ASSETS_DIR ?? "public");

serve(
  {
    port,
    hostname: "0.0.0.0",
    fetch: async (request) => {
      const publicAsset = await servePublicAsset(request);

      if (publicAsset !== null) {
        return publicAsset;
      }

      return app.fetch(
        trustProxyHeaders ? applyForwardedRequestOrigin(request) : request,
        workerBindings,
        executionContext,
      );
    },
  },
  (info) => {
    console.info(
      JSON.stringify({
        message: "node_server_started",
        host: info.address,
        port: info.port,
      }),
    );
  },
);
