import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadFoundersBoard, FOUNDERS_FACILITY_PANEL, PROJECT_BASE_FACILITY_STOCK } from "@nomad-city-online/game-core";
import {
  createRoomSocketApplication,
  migrateRoomStore,
  migrateSessionStore,
  SessionService,
  facilityCardView,
} from "@nomad-city-online/server";

/** Development harness only. Production RoomSocketModule never installs these fixture or static routes. */
export async function createLocalApplication({
  dataDirectory,
  origin,
  port = 5173,
}) {
  const canonical = new URL(origin);
  if (
    !["http:", "https:"].includes(canonical.protocol) ||
    canonical.origin !== origin
  )
    throw Error("Invalid local origin");
  await mkdir(dataDirectory, { recursive: true });
  const db = new PGlite(dataDirectory),
    sql = {
      query: async (text, values) => {
        const r = await db.query(text, values);
        return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      },
    };
  let app;
  try {
    await migrateRoomStore(sql);
    await migrateSessionStore(sql);
    const dist = resolve("packages/web/dist");
    const catalog = {
      three: loadFoundersBoard("three-player"),
      four: loadFoundersBoard("four-player"),
      facilities: { cards: PROJECT_BASE_FACILITY_STOCK.cards.map(c => facilityCardView(c.id)), cells: FOUNDERS_FACILITY_PANEL.cells },
    };
    app = await createRoomSocketApplication({
      sql,
      allowedOrigins: [origin],
      configureHttp: (host) => {
        host.use(async (req, res, next) => {
          const listenPort = req.socket.localPort ?? port;
          const allowedHosts = new Set([
            canonical.host,
            `127.0.0.1:${listenPort}`,
            `localhost:${listenPort}`,
          ]);
          if (!allowedHosts.has(req.headers.host ?? "")) {
            res.statusCode = 403;
            res.end();
            return;
          }
          const path = new URL(req.url, origin).pathname;
          const json = (status, body) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(body));
          };
          if (path === "/__local/session") {
            if (
              req.method !== "POST" ||
              req.headers.origin !== origin ||
              !req.headers["content-type"]?.startsWith("application/json")
            ) {
              json(403, { error: "LOCAL_ONLY" });
              return;
            }
            const chunks = [];
            let size = 0,
              body;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 4096) {
                json(413, { error: "INVALID_FIXTURE" });
                return;
              }
              chunks.push(chunk);
            }
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              json(400, { error: "INVALID_FIXTURE" });
              return;
            }
            if (
              !body ||
              Object.keys(body).length !== 1 ||
              !Number.isInteger(body.fixtureId) ||
              body.fixtureId < 1 ||
              body.fixtureId > 4
            ) {
              json(400, { error: "INVALID_FIXTURE" });
              return;
            }
            try {
              json(
                200,
                await host
                  .get(SessionService)
                  .issue(`local-user-${body.fixtureId}`),
              );
            } catch {
              json(503, { error: "LOCAL_UNAVAILABLE" });
            }
            return;
          }
          if (path === "/__local/catalog" && req.method === "GET") {
            json(200, catalog);
            return;
          }
          if (!["GET", "HEAD"].includes(req.method)) {
            next();
            return;
          }
          const file =
            path === "/"
              ? resolve(dist, "index.html")
              : resolve(dist, `.${path}`);
          if (!file.startsWith(`${dist}${sep}`)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const ext = file.split(".").at(-1),
            type = {
              html: "text/html",
              js: "text/javascript",
              css: "text/css",
              svg: "image/svg+xml",
            }[ext];
          if (!type) {
            res.statusCode = 404;
            res.end();
            return;
          }
          try {
            const bytes = await readFile(file);
            res.setHeader("Content-Type", `${type}; charset=utf-8`);
            res.setHeader("Cache-Control", "no-store");
            res.end(req.method === "HEAD" ? undefined : bytes);
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
      },
    });
    return {
      app,
      sql,
      close: async () => {
        await app.close();
        await db.close();
      },
    };
  } catch (error) {
    if (app) await app.close();
    await db.close();
    throw error;
  }
}
