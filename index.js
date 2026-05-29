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
    "<button class='btn' type='submit'>✅ Autorizar acceso</button></form></div></body></html>"].join("");
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
      // Reservas
      { name: "get_reservations", description: "Lista de reservas con filtros opcionales", inputSchema: { type: "object", properties: { limit: { type: "number", description: "Número de resultados (default 25)" }, status: { type: "string", description: "Estado: confirmed, canceled, inquiry, declined" }, from: { type: "string", description: "Fecha inicio YYYY-MM-DD" }, to: { type: "string", description: "Fecha fin YYYY-MM-DD" } } } },
      { name: "get_reservation_by_id", description: "Detalles completos de una reserva específica", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "ID de la reserva" } } } },
      // Propiedades
      { name: "get_listings", description: "Lista de propiedades", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_listing_by_id", description: "Detalles completos de una propiedad específica", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "ID de la propiedad" } } } },
      { name: "get_listing_calendar", description: "Calendario de disponibilidad de una propiedad", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "ID de la propiedad" }, from: { type: "string", description: "Fecha inicio YYYY-MM-DD" }, to: { type: "string", description: "Fecha fin YYYY-MM-DD" } } } },
      // Huéspedes
      { name: "get_guests", description: "Lista de huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_guest_by_id", description: "Perfil completo de un huésped específico", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "ID del huésped" } } } },
      // Conversaciones y reseñas
      { name: "get_conversations", description: "Conversaciones y mensajes con huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_reviews", description: "Reseñas de huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" }, listingId: { type: "string", description: "Filtrar por propiedad" } } } },
      // Tareas
      { name: "get_tasks", description: "Lista de tareas de limpieza y mantenimiento", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_tasks_by_listing", description: "Tareas de una propiedad específica", inputSchema: { type: "object", required: ["listingId"], properties: { listingId: { type: "string", description: "ID de la propiedad" }, limit: { type: "number" } } } },
      { name: "create_task", description: "Crear una nueva tarea de limpieza o mantenimiento", inputSchema: { type: "object", required: ["title", "listingId"], properties: { title: { type: "string", description: "Título de la tarea" }, listingId: { type: "string", description: "ID de la propiedad" }, description: { type: "string", description: "Descripción detallada" }, dueDate: { type: "string", description: "Fecha límite YYYY-MM-DD" } } } },
      // Finanzas
      { name: "get_payments", description: "Pagos recibidos y pendientes", inputSchema: { type: "object", properties: { limit: { type: "number" }, status: { type: "string", description: "Estado del pago" } } } },
      { name: "get_owner_statements", description: "Estados de cuenta de propietarios", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      // Reportes
      { name: "get_occupancy_report", description: "Reporte de ocupación por fechas", inputSchema: { type: "object", properties: { from: { type: "string", description: "Fecha inicio YYYY-MM-DD" }, to: { type: "string", description: "Fecha fin YYYY-MM-DD" } } } },
      { name: "get_revenue_report", description: "Reporte de ingresos por fechas", inputSchema: { type: "object", properties: { from: { type: "string", description: "Fecha inicio YYYY-MM-DD" }, to: { type: "string", description: "Fecha fin YYYY-MM-DD" } } } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const limit = args?.limit || 25;
    try {
      let data;
      switch (name) {
        // Reservas
        case "get_reservations":
          data = await guestyGet("reservations", { limit, ...(args?.status && { status: args.status }), ...(args?.from && { checkIn: args.from }), ...(args?.to && { checkOut: args.to }) });
          break;
        case "get_reservation_by_id":
          data = await guestyGet("reservations/" + args.id);
          break;
        // Propiedades
        case "get_listings":
          data = await guestyGet("listings", { limit });
          break;
        case "get_listing_by_id":
          data = await guestyGet("listings/" + args.id);
          break;
        case "get_listing_calendar":
          data = await guestyGet("listings/" + args.id + "/calendar", { from: args?.from, to: args?.to });
          break;
        // Huéspedes
        case "get_guests":
          data = await guestyGet("guests", { limit });
          break;
        case "get_guest_by_id":
          data = await guestyGet("guests/" + args.id);
          break;
        // Conversaciones y reseñas
        case "get_conversations":
          data = await guestyGet("conversations", { limit });
          break;
        case "get_reviews":
          data = await guestyGet("reviews", { limit, ...(args?.listingId && { listingId: args.listingId }) });
          break;
        // Tareas
        case "get_tasks":
          data = await guestyGet("tasks", { limit });
          break;
        case "get_tasks_by_listing":
          data = await guestyGet("tasks", { limit, listingId: args.listingId });
          break;
        case "create_task":
          data = await guestyPost("tasks", { title: args.title, listingId: args.listingId, description: args?.description, dueDate: args?.dueDate });
          break;
        // Finanzas
        case "get_payments":
          data = await guestyGet("payments", { limit, ...(args?.status && { status: args.status }) });
          break;
        case "get_owner_statements":
          data = await guestyGet("owner-statements", { limit });
          break;
        // Reportes
        case "get_occupancy_report":
          data = await guestyGet("reports/occupancy", { from: args?.from, to: args?.to });
          break;
        case "get_revenue_report":
          data = await guestyGet("reports/revenue", { from: args?.from, to: args?.to });
          break;
        default:
          throw new Error("Herramienta no encontrada: " + name);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: "Error: " + error.message }], isError: true };
    }
  });
  return server;
}

const sessions = new Map();
async function handleMcp(req, res) {
  const sessionId = req.headers["mcp-session-id"] || randomUUID();
  let transport = sessions.get(sessionId);
  if (!transport) {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    sessions.set(sessionId, transport);
    await createMcpServer().connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
}

app.post("/sse", handleMcp);
app.get("/sse", handleMcp);
app.delete("/sse", (req, res) => {
  const id = req.headers["mcp-session-id"];
  if (id) sessions.delete(id);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.json({ status: "Guesty MCP Server v2.0 funcionando", tools: 16 }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("MCP Server v2.0 corriendo en puerto " + PORT));
