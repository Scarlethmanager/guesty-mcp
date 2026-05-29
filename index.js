import express from "express";
import axios from "axios";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
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
  });
});

app.post("/register", (req, res) => {
  res.json({
    client_id: "guesty-mcp-client",
    client_secret: "guesty-mcp-secret",
    redirect_uris: req.body.redirect_uris || [],
    token_endpoint_auth_method: "client_secret_post",
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  res.redirect(`${redirect_uri}?code=guesty-mcp-code&state=${state}`);
});

app.post("/oauth/token", (req, res) => {
  res.json({
    access_token: "guesty-mcp-token",
    token_type: "bearer",
    expires_in: 86400,
  });
});

async function getGuestyToken() {
  const res = await axios.post(
    "https://open-api.guesty.com/oauth2/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.GUESTY_CLIENT_ID,
      client_secret: process.env.GUESTY_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data.access_token;
}

async function getGuestyData(endpoint, params = {}) {
  const token = await getGuestyToken();
  const res = await axios.get(`https://open-api.guesty.com/v1/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}

function createServer() {
  const server = new Server(
    { name: "guesty-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "get_reservations", description: "Obtiene reservas de Guesty", inputSchema: { type: "object", properties: { limit: { type: "number" }, status: { type: "string" } } } },
      { name: "get_listings", description: "Obtiene propiedades de Guesty", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_guests", description: "Obtiene huéspedes de Guesty", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_conversations", description: "Obtiene conversaciones con huéspedes", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_tasks", description: "Obtiene tareas de limpieza y mantenimiento", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const limit = args?.limit || 25;
    try {
      let data;
      switch (name) {
        case "get_reservations": data = await getGuestyData("reservations", { limit, ...(args?.status && { status: args.status }) }); break;
        case "get_listings": data = await getGuestyData("listings", { limit }); break;
        case "get_guests": data = await getGuestyData("guests", { limit }); break;
        case "get_conversations": data = await getGuestyData("conversations", { limit }); break;
        case "get_tasks": data = await getGuestyData("tasks", { limit }); break;
        default: throw new Error(`Herramienta no encontrada: ${name}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });
  return server;
}

const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await createServer().connect(transport);
});

app.post("/messages", async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (transport) await transport.handlePostMessage(req, res);
  else res.status(400).json({ error: "Sesión no encontrada" });
});

app.get("/", (req, res) => res.json({ status: "✅ Guesty MCP Server funcionando" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ MCP Server corriendo en puerto ${PORT}`));
