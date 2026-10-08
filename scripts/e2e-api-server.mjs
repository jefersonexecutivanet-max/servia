import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "demo-servia-e2e";
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9098") {
  throw new Error("API de teste exige somente os emuladores locais demo-servia-e2e.");
}
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: projectId, client_email: "e2e-admin@demo-servia-e2e.iam.gserviceaccount.com", private_key: privateKey });

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1:4175");
  if (url.pathname === "/__health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  const match = url.pathname.match(/^\/api\/([a-z-]+(?:\/[a-z-]+)*)$/);
  if (!match) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "API de teste não encontrada." } }));
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_000_000) throw new Error("Payload excede o limite local de teste.");
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    request.body = rawBody ? JSON.parse(rawBody) : {};
    request.query = Object.fromEntries(url.searchParams.entries());
    response.status = function status(code) { this.statusCode = code; return this; };
    response.json = function json(value) {
      if (!this.headersSent) this.setHeader("content-type", "application/json; charset=utf-8");
      this.end(JSON.stringify(value));
      return this;
    };
    response.send = function send(value) { this.end(value); return this; };
    const handlerUrl = pathToFileURL(path.join(root, "api", match[1] + ".js")).href;
    const handlerModule = await import(handlerUrl);
    await handlerModule.default(request, response);
    if (!response.writableEnded) response.end();
  } catch (error) {
    console.error("Local test API error:", error && error.message ? error.message : error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    if (!response.writableEnded) response.end(JSON.stringify({ error: { code: "internal", message: error && error.message ? error.message : "Falha na API local." } }));
  }
});
server.listen(4175, "127.0.0.1", () => console.log("Test API bridge listening on 127.0.0.1:4175"));
