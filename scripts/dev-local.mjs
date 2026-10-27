import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalApplication } from "./local-app.mjs";

const portArgument = process.argv.indexOf("--port");
const port = Number(
  portArgument >= 0
    ? process.argv[portArgument + 1]
    : (process.env.PORT ?? 5173),
);
const hostArgument = process.argv.indexOf("--host");
const requestedHost =
  hostArgument >= 0 ? process.argv[hostArgument + 1] : undefined;
// The managed QA proxy requires its standard host flag. Ordinary local runs remain loopback-only.
const bindHost =
  process.env.SITES_MANAGED_LINUX_CONTAINER === "1" &&
  requestedHost === "0.0.0.0"
    ? requestedHost
    : "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid local port");
let configuredOrigin = process.env.NCO_LOCAL_ORIGIN;
if (!configuredOrigin) {
  try {
    configuredOrigin = (
      await readFile(".local/preview-origin.txt", "utf8")
    ).trim();
  } catch {}
}
const origin = configuredOrigin ?? `http://127.0.0.1:${port}`;
const local = await createLocalApplication({
  dataDirectory: resolve(".local/database"),
  origin,
  port,
});
await local.app.listen(port, bindHost);
console.log(`Nomad City Online local: ${origin}`);
console.log(
  "Use separate tabs and different local test identities. Ctrl+C stops the local app.",
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await local.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
