import express from "express";
import axios from "axios";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = "https://" + req.headers.host;
  res.json({ resource: base, authorization_servers: [base] });
});
app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
  const base = "https://" + req.headers.host;
  res.json({ resource: base + "/sse", authorization_servers: [base] });
});
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = "https://" + req.headers.host;
  res.json({ issuer: base, authorization_endpoint: base + "/oauth/authorize", token_endpoint: base + "/oauth/token", registration_endpoint: base + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
});
app.post("/register", (req, res) => {
  res.status(201).json({ client_id: "guesty-mcp-client", token_endpoint_auth_method: "none", redirect_uris: req.body.redirect_uris || [], grant_types: ["authorization_code"], response_types: ["code"] });
});
app.get("/oauth/authorize", (req, res) => {
  const ru = encodeURIComponent(req.query.redirect_uri || "");
  const st = encodeURIComponent(req.query.state || "");
  const cc = encodeURIComponent(req.query.code_challenge || "");
  const html = ["<!DOCTYPE html><html><head><meta charset='utf-8'><title>Conectar Guesty</title>",
    "<style>body{font-family:Arial,sans-serif;background:#f0f4f8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}",
    ".card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center;width:380px}",
    "h1{font-size:22px;margin-bottom:10px}p{color:#666;font-size:14px;margin-bottom:24px}",
    ".btn{background:#00a67e;color:white;border:none;padding:14px;border-radius:10px;font-size:16px;cursor:pointer;width:100%}",
    ".btn:hover{background:#007f60}</style></head><body>",
    "<div class='card'><div style='font-size:56px'>🏠</div><h1>Conectar Guesty con Claude</h1>",
    "<p>Claude accederá a tus datos de Guesty.</p>",
    "<form action='/oauth/callback' method='GET'>",
    "<input type='hidden' name='redirect_uri' value='" + ru + "'>",
    "<input type='hidden' name='state' value='" + st + "'>",
    "<input type='hidden' name='code_challenge' value='" + cc + "'>",
    "<button class='btn' type='submit'>Autorizar acceso</button></form></div></body></html>"].join("");
  res.send(html);
});
app.get("/oauth/callback", (req, res) => {
  const redirect_uri = decodeURIComponent(req.query.redirect_uri || "");
  const state = decodeURIComponent(req.query.state || "");
  const code = "guesty-code-" + Date.now();
  res.redirect(redirect_uri + "?code=" + encodeURIComponent(code) + "&state=" + encodeURIComponent(state));
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

async function guestyGet(endpoint, params = {}) {
  const token = await getGuestyToken();
  const res = await axios.get("https://open-api.guesty.com/v1/" + endpoint, { headers: { Authorization: "Bearer " + token }, params });
  return res.data;
}

async function guestyPost(endpoint, body = {}) {
  const token = await getGuestyToken();
  const res = await axios.post("https://open-api.guesty.com/v1/" + endpoint, body, { headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } });
  return res.data;
}

function createMcpServer() {
  const server = new Server({ name: "guesty-mcp", version: "2.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "get_reservations", description: "Lista de reservas con filtros opcionales", inputSchema: { type: "object", properties: { limit: { type: "number" }, status: { type: "string" }, from: { type: "string" }, to: { type: "string" } } } },
      { name: "get_reservation_by_id", description: "Detalles completos de una reserva", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
      { name: "get_listings", description: "Lista de propiedades", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_listing_by_id", description: "Detalles de una propiedad", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
      { name: "get_listing_calendar", description: "Calendario de disponibilidad", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, from: { type: "string" }, to: { type: "string" } } } },
      { name: "get_guests", description: "Lista de huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_guest_by_id", description: "Perfil de un huésped", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
      { name: "get_conversations", description: "Conversaciones con huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_reviews", description: "Reseñas de huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" }, listingId: { type: "string" } } } },
      { name: "get_tasks", description: "Tareas de limpieza y mantenimiento", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_tasks_by_listing", description: "Tareas de una propiedad", inputSchema: { type: "object", required: ["listingId"], properties: { listingId: { type: "string" }, limit: { type: "number" } } } },
      { name: "create_task", description: "Crear tarea de limpieza", inputSchema: { type: "object", required: ["title", "listingId"], properties: { title: { type: "string" }, listingId: { type: "string" }, description: { type: "string" }, dueDate: { type: "string" } } } },
      { name: "get_payments", description: "Pagos recibidos y pendientes", inputSchema: { type: "object", properties: { limit: { type: "number" }, status: { type: "string" } } } },
      { name: "get_owner_statements", description: "Estados de cuenta de propietarios", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_occupancy_report", description: "Reporte de ocupación", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
      { name: "get_revenue_report", description: "Reporte de ingresos", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const limit = args?.limit || 25;
    try {
      let data;
      if (name === "get_reservations") data = await guestyGet("reservations", { limit, ...(args?.status && { status: args.status }), ...(args?.from && { checkIn: args.from }), ...(args?.to && { checkOut: args.to }) });
      else if (name === "get_reservation_by_id") data = await guestyGet("reservations/" + args.id);
      else if (name === "get_listings") data = await guestyGet("listings", { limit });
      else if (name === "get_listing_by_id") data = await guestyGet("listings/" + args.id);
      else if (name === "get_listing_calendar") data = await guestyGet("listings/" + args.id + "/calendar", { from: args?.from, to: args?.to });
      else if (name === "get_guests") data = await guestyGet("guests", { limit });
      else if (name === "get_guest_by_id") data = await guestyGet("guests/" + args.id);
      else if (name === "get_conversations") data = await guestyGet("conversations", { limit });
      else if (name === "get_reviews") data = await guestyGet("reviews", { limit, ...(args?.listingId && { listingId: args.listingId }) });
      else if (name === "get_tasks") data = await guestyGet("tasks", { limit });
      else if (name === "get_tasks_by_listing") data = await guestyGet("tasks", { limit, listingId: args.listingId });
      else if (name === "create_task") data = await guestyPost("tasks", { title: args.title, listingId: args.listingId, description: args?.description, dueDate: args?.dueDate });
      else if (name === "get_payments") data = await guestyGet("payments", { limit, ...(args?.status && { status: args.status }) });
      else if (name === "get_owner_statements") data = await guestyGet("owner-statements", { limit });
      else if (name === "get_occupancy_report") data = await guestyGet("reports/occupancy", { from: args?.from, to: args?.to });
      else if (name === "get_revenue_report") data = await guestyGet("reports/revenue", { from: args?.from, to: args?.to });
      else throw new Error("Herramienta no encontrada: " + name);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: "Error: " + error.message }], isError: true };
    }
  });
  return server;
}

async function handleMcp(req, res) {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

app.post("/sse", handleMcp);
app.get("/sse", handleMcp);
app.delete("/sse", (req, res) => res.sendStatus(200));
app.get("/", (req, res) => res.json({ status: "Guesty MCP Server v2.0", tools: 16 }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("MCP Server v2.0 corriendo en puerto " + PORT));
