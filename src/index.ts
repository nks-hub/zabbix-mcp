#!/usr/bin/env node
/**
 * Zabbix MCP — CLI entrypoint.
 *
 * Transports:
 *   stdio (default) — for local Claude Desktop / Claude Code use
 *   http            — Streamable HTTP for remote hosting (gateway / ChatGPT)
 *
 * Environment:
 *   ZABBIX_URL         required, e.g. https://zabbix.example.com
 *   ZABBIX_API_TOKEN   required (or ZABBIX_USERNAME + ZABBIX_PASSWORD)
 *   ZABBIX_USERNAME    alternative auth
 *   ZABBIX_PASSWORD    alternative auth
 *   MCP_TRANSPORT      stdio | http   (default: stdio)
 *   MCP_HTTP_PORT      default: 3000  (only when MCP_TRANSPORT=http)
 *   MCP_HTTP_HOST      default: 0.0.0.0
 *   MCP_HTTP_PATH      default: /mcp
 *   MCP_STATELESS      1 to disable session IDs (default: stateful)
 */

import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZabbixServer, ZABBIX_SERVER_NAME, normalizeZabbixUrl } from "./server.js";
import { ZabbixConfig } from "./client.js";

function getConfig(): ZabbixConfig {
  const rawUrl = process.env.ZABBIX_URL;
  const apiToken = process.env.ZABBIX_API_TOKEN;
  const username = process.env.ZABBIX_USERNAME;
  const password = process.env.ZABBIX_PASSWORD;

  if (!rawUrl) {
    console.error("Missing ZABBIX_URL environment variable");
    process.exit(1);
  }

  if (!apiToken && !(username && password)) {
    console.error("Set either ZABBIX_API_TOKEN or ZABBIX_USERNAME + ZABBIX_PASSWORD");
    process.exit(1);
  }

  return {
    url: normalizeZabbixUrl(rawUrl),
    apiToken,
    username,
    password,
  };
}

async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${ZABBIX_SERVER_NAME} running on stdio`);
}

async function runHttp(server: McpServer): Promise<void> {
  const port = Number(process.env.MCP_HTTP_PORT ?? 3000);
  const host = process.env.MCP_HTTP_HOST ?? "0.0.0.0";
  const path = process.env.MCP_HTTP_PATH ?? "/mcp";
  const stateless = process.env.MCP_STATELESS === "1";

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: stateless ? undefined : () => randomUUID(),
  });
  await server.connect(transport);

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz" || req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, server: ZABBIX_SERVER_NAME, path }));
      return;
    }
    if (!req.url || !req.url.startsWith(path)) {
      res.writeHead(404).end();
      return;
    }
    transport.handleRequest(req, res).catch((err) => {
      console.error("HTTP transport error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  httpServer.listen(port, host, () => {
    console.error(`${ZABBIX_SERVER_NAME} running on http://${host}:${port}${path}`);
  });
}

async function main(): Promise<void> {
  const config = getConfig();
  const server = createZabbixServer(config);

  const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  switch (transport) {
    case "stdio":
      await runStdio(server);
      break;
    case "http":
      await runHttp(server);
      break;
    default:
      console.error(`Unknown MCP_TRANSPORT='${transport}', expected stdio|http`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
