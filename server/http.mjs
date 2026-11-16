import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const assets = new Map([
  ["/estudiantes.html", "text/html; charset=utf-8"],
  ["/admin.html", "text/html; charset=utf-8"],
  ["/styles.css", "text/css; charset=utf-8"],
  ["/script.js", "text/javascript; charset=utf-8"],
]);
const cookieName = "biblioteca_sesion";
const mutations = new Map([
  ["POST books", { call: "createBook", args: "body" }],
  ["PATCH books/id", { call: "editBook", args: "id+body" }],
  ["DELETE books/id", { call: "deleteBook", args: "id" }],
  ["POST reviews", { call: "createReview", args: "body" }],
  ["PATCH reviews/id", { call: "editReview", args: "id+body" }],
  ["DELETE reviews/id", { call: "deleteReview", args: "id" }],
  ["POST loans", { call: "createLoan", args: "body" }],
  ["POST loans/id/return", { call: "returnLoan", args: "id" }],
  ["POST requests", { call: "createRequest", args: "body" }],
  ["PATCH requests/id", { call: "resolveRequest", args: "id+body" }],
]);

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw failure(415, "JSON_REQUIRED", "Envía los datos en formato JSON.");
  }
  const maxSize = 16 * 1024;
  if (Number(request.headers["content-length"]) > maxSize) {
    throw failure(413, "BODY_TOO_LARGE", "La solicitud es demasiado grande.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxSize) throw failure(413, "BODY_TOO_LARGE", "La solicitud es demasiado grande.");
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new TypeError();
    return result;
  } catch {
    throw failure(400, "INVALID_JSON", "Los datos de la solicitud no son válidos.");
  }
}

function sessionCookie(token, maxAge) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function checkRequest(request) {
  const host = request.headers.host;
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(host || "")) {
    throw failure(403, "LOCAL_ONLY", "Abre la biblioteca desde el equipo donde está el servidor.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.origin;
    if ((origin && origin !== `http://${host}`) || request.headers["sec-fetch-site"] === "cross-site") {
      throw failure(403, "INVALID_ORIGIN", "La solicitud debe proceder de la biblioteca.");
    }
  }
}

export function createHttpServer({ auth, library }) {
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      checkRequest(request);
      const { method } = request;
      const { pathname } = new URL(request.url, "http://127.0.0.1");
      if (method === "GET" || method === "HEAD") {
        if (pathname === "/") {
          response.writeHead(302, { Location: "/estudiantes.html" }).end();
          return;
        }
        if (assets.has(pathname)) {
          const asset = await readFile(new URL(`..${pathname}`, import.meta.url));
          response.writeHead(200, { "Content-Type": assets.get(pathname) });
          response.end(method === "HEAD" ? undefined : asset);
          return;
        }
      }

      const token = request.headers.cookie?.match(/(?:^|;\s*)biblioteca_sesion=([\w-]+)/)?.[1];
      if (method === "POST" && pathname === "/api/login") {
        const { user, token: newToken, maxAge } = await auth.login(await readJson(request), request.socket.remoteAddress);
        if (token) await auth.logout(token);
        response.setHeader("Set-Cookie", sessionCookie(newToken, maxAge));
        sendJson(response, 200, { user });
        return;
      }
      if (method === "POST" && pathname === "/api/logout") {
        await auth.logout(token);
        response.setHeader("Set-Cookie", sessionCookie("", 0));
        response.writeHead(204).end();
        return;
      }
      if (pathname.startsWith("/api/")) {
        const user = await auth.authenticate(token);
        if (!user) throw failure(401, "LOGIN_REQUIRED", "Inicia sesión para continuar.");
        if (method === "GET" && pathname === "/api/state") {
          sendJson(response, 200, { user, ...await library.state(user) });
          return;
        }
        if (method === "GET" && pathname === "/api/audit") {
          sendJson(response, 200, { entries: await library.audit(user) });
          return;
        }
        const resource = pathname.match(/^\/api\/(books|reviews|loans|requests)(?:\/([\w-]+)(\/return)?)?$/);
        if (resource) {
          const [, collection, id, suffix = ""] = resource;
          const mutation = mutations.get(`${method} ${collection}${id ? "/id" : ""}${suffix}`);
          if (mutation) {
            const expectedActor = request.headers["x-biblioteca-actor"];
            if (expectedActor !== undefined && expectedActor !== user.id) {
              throw failure(409, "SESSION_CHANGED", "La sesión cambió. Revisa el usuario activo antes de continuar.");
            }
            const args = [user];
            if (mutation.args.includes("id")) args.push(id);
            if (mutation.args.includes("body")) args.push(await readJson(request));
            await library[mutation.call](...args);
            response.writeHead(204).end();
            return;
          }
        }
      }
      throw failure(404, "NOT_FOUND", "No se encontró lo solicitado.");
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error("Error interno de biblioteca:", error.name, error.code || "");
      if (error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
      request.resume();
      sendJson(response, status, status === 500
        ? { code: "SERVER_ERROR", message: "Ocurrió un error. Vuelve a intentar." }
        : { code: error.code, message: error.message });
    }
  });
}
