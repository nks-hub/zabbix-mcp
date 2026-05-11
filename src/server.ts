/**
 * Zabbix MCP server — library entry point.
 *
 * Exports `createZabbixServer(config)` so consumers (mcp-gateway, tests) can
 * construct a fully-wired McpServer instance and attach their own transport.
 *
 * Transport selection lives in `index.ts` (CLI).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZabbixClient, ZabbixConfig, normalizeZabbixUrl } from "./client.js";
import { registerSystemTools } from "./tools/system.js";
import { registerHostTools } from "./tools/hosts.js";
import { registerProblemTools } from "./tools/problems.js";
import { registerTriggerTools } from "./tools/triggers.js";
import { registerItemTools } from "./tools/items.js";

export const ZABBIX_SERVER_NAME = "zabbix-mcp";
export const ZABBIX_SERVER_VERSION = "0.3.2";

export const ZABBIX_INSTRUCTIONS =
  "Zabbix MCP server for infrastructure monitoring, incidents, host inventory, trigger analysis, and metric history. " +
  "Start with zabbix_health, then discover host groups/hosts, then inspect problems/triggers/items. " +
  "Use zabbix_acknowledge_event for operational updates only when you explicitly intend to change production monitoring state.";

export function createZabbixServer(config: ZabbixConfig): McpServer {
  const client = new ZabbixClient(config);

  const server = new McpServer(
    { name: ZABBIX_SERVER_NAME, version: ZABBIX_SERVER_VERSION },
    { instructions: ZABBIX_INSTRUCTIONS }
  );

  registerSystemTools(server, client);
  registerHostTools(server, client);
  registerProblemTools(server, client);
  registerTriggerTools(server, client);
  registerItemTools(server, client);

  return server;
}

export type { ZabbixConfig } from "./client.js";
export { ZabbixClient, normalizeZabbixUrl } from "./client.js";
