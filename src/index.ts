#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZabbixClient, normalizeZabbixUrl } from "./client.js";
import { registerSystemTools } from "./tools/system.js";
import { registerHostTools } from "./tools/hosts.js";
import { registerProblemTools } from "./tools/problems.js";
import { registerTriggerTools } from "./tools/triggers.js";
import { registerItemTools } from "./tools/items.js";

function getConfig() {
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

async function main() {
  const client = new ZabbixClient(getConfig());

  const server = new McpServer(
    {
      name: "zabbix-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Zabbix MCP server for infrastructure monitoring, incidents, host inventory, trigger analysis, and metric history. " +
        "Start with zabbix_health, then discover host groups/hosts, then inspect problems/triggers/items. " +
        "Use zabbix_acknowledge_event for operational updates only when you explicitly intend to change production monitoring state.",
    }
  );

  registerSystemTools(server, client);
  registerHostTools(server, client);
  registerProblemTools(server, client);
  registerTriggerTools(server, client);
  registerItemTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("zabbix-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
