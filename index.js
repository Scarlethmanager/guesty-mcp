import express from "express";
import axios from "axios";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// OAuth Protected Resource Metadata (RFC 9728)
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = `https://${req.headers.host}`;
  res.json({ resource: base, authorization_servers: [base] });
});

app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
  const base = `https://${req.headers.host}`;
  res.json({ resource: `${base}/sse`, authorization_servers: [base] });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = `https://${req.headers.host}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

app.post("/register", (req, res) => {
  res.status(201).json({
    client_id: "guesty-mcp-client",
    token_endpoint_auth_method: "none",
    redirect_uris: req.body.redirect_uris || [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge } = req.query;
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conectar Guesty</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#f0f4f8;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center;width:380px}.icon{font-size:56px;margin-bottom:16px}h1{font-size:22px;color:#1a1a1a;margin-bottom:10px}p{color:#666;font-size:14px;line-height:1.6;margin-bottom:28px}.perms{background:#f8f9fa;border-radius:10px;padding:16px;margin-bottom:24px;text-align:left}.perm{font-size:13px;color:#444;margin-bottom:8px}.btn{background:#00a67e;color:white;border:none;padding:14px;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;width:100%}.btn:hover{background:#007f60}</style></head>
  <body><div class="card"><div class="icon">🏠</div><h1>Conectar Guesty con Claude</h1>
  <p>Claude podrá acceder a tus datos de Guesty.</p>
  <div class="perms"><div class="perm">✅ Reservas y calendarios</div><div class="perm">✅ Propiedades</div><div class="perm">✅ Huéspedes y conversaciones</div><div class="perm">✅ Tareas de limpieza</div></div>
  <form action="/oauth/callback" method="GET">
  <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri||'')}">
  <input type="hidden" name="state" value="${encodeURIComponent(state||'')}">
  <input type="hidden" name="code_challenge" value="${encodeURIComponent(code_challenge||'')}">
  <button class="btn" type="submit">✅ Autorizar acceso</button></form></div></body></html>`);
});

app.get("/oauth/callback", (req, res) => {
  const redirect_uri = decodeURIComponent(req.query.redirect_uri || "");
  const state = decodeURIComponent(req.query.state || "");
  const code = "guesty-code-" + Date.now();
  res.redirect(`${redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
});

app.post("/oauth/token", (req, res) => {
  res.json({ access_token: "guesty-token-" + Date.now(), token_type: "bearer", expires_in: 86400 });
});

async function getGuestyToken() {
  const res = await axios.post(
    "https://open-api.guesty.com/oauth2/token",
    new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.GUESTY_CLIENT_ID, client_secret: process.env.GUESTY_CLIENT_SECRET }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data.access_token;
}

async function getGuestyData(endpoint, params = {}) {
  const token = await getGuestyToken();
  const res = await axios.get(`https://open-api.guesty.com/v1/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, params });
  return res.data;
}

function createMcpServer() {
  const server = new Server({ name: "guesty-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "get_reservations", descript
