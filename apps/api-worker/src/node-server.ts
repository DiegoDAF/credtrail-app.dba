import "./node-jsx-runtime";
import { fileURLToPath } from "node:url";
import { createNodeRequestAdapter } from "./runtime/node-request-adapter";
import { createNodePublicAssets } from "./runtime/node-public-assets";
import { serve } from "@hono/node-server";
import { app } from "./app";
import {
  createNodeExecutionContext,
  createNodeRuntimeBindings,
  parseNodeRuntimePort,
} from "./runtime/node-runtime";

const workerBindings = {
  ...createNodeRuntimeBindings(process.env),
  PUBLIC_ASSETS: createNodePublicAssets(
    fileURLToPath(new URL("../../public/assets/ui/", import.meta.url)),
  ),
};
const executionContext = createNodeExecutionContext();
const port = parseNodeRuntimePort(process.env);
const adaptRequest = createNodeRequestAdapter(process.env.TRUSTED_PROXY_CIDRS);

serve(
  {
    port,
    hostname: "0.0.0.0",
    fetch: async (request, transport) => {
      const adapted = adaptRequest(
        request,
        transport.incoming.socket.remoteAddress,
        workerBindings,
      );
      if (adapted.status === "error") return adapted.response;
      return app.fetch(adapted.request, adapted.bindings, executionContext);
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
