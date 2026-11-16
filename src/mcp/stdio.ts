// `npm run mcp`: repronote as an MCP server over stdio, for AI assistants that
// launch a command (Claude Desktop, Claude Code...). It talks to the running
// repronote server or desktop app (REPRONOTE_URL, default http://127.0.0.1:4173).
// Clients that support HTTP can use http://127.0.0.1:4173/mcp directly instead.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools.ts";

const server = createMcpServer(process.env.REPRONOTE_URL ?? "http://127.0.0.1:4173");
await server.connect(new StdioServerTransport());
