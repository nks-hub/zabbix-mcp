import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { ZabbixClient } from "../client.js";
import { pickDefined, safeError, truncateResponse } from "../utils.js";

export function registerHostTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_host_groups",
    {
      title: "List Host Groups",
      description: "List Zabbix host groups with optional name search. Useful for discovering monitored infrastructure domains.",
      inputSchema: {
        search: z.string().optional().describe("Substring search against host group name"),
        limit: z.number().min(1).max(MAX_LIMIT).optional().describe(`Maximum groups to return (default: ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await client.call<unknown[]>("hostgroup.get", pickDefined({
          output: ["groupid", "name", "flags", "internal"],
          search: args.search ? { name: args.search } : undefined,
          sortfield: "name",
          sortorder: "ASC",
          limit: args.limit ?? DEFAULT_LIMIT,
        }));
        return { content: [{ type: "text" as const, text: truncateResponse(data) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_list_hosts",
    {
      title: "List Hosts",
      description: "List monitored Zabbix hosts with optional filtering by group, name, enabled/disabled status, and technical host value.",
      inputSchema: {
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against visible host name"),
        technicalName: z.string().optional().describe("Substring search against technical host field"),
        status: z.enum(["enabled", "disabled"]).optional().describe("Filter by host status"),
        monitoredOnly: z.boolean().optional().describe("When true, return only monitored/active hosts"),
        limit: z.number().min(1).max(MAX_LIMIT).optional().describe(`Maximum hosts to return (default: ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const search = args.search || args.technicalName
          ? pickDefined({ name: args.search, host: args.technicalName })
          : undefined;

        const params = pickDefined({
          output: ["hostid", "host", "name", "status", "maintenance_status", "description", "proxyid"],
          selectInterfaces: ["interfaceid", "ip", "dns", "port", "useip", "main", "type", "available"],
          selectGroups: ["groupid", "name"],
          groupids: args.groupIds,
          search,
          filter: args.status ? { status: args.status === "enabled" ? 0 : 1 } : undefined,
          monitored_hosts: args.monitoredOnly ? true : undefined,
          sortfield: ["name"],
          sortorder: "ASC",
          limit: args.limit ?? DEFAULT_LIMIT,
        });

        const data = await client.call<unknown[]>("host.get", params);
        return { content: [{ type: "text" as const, text: truncateResponse(data) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_get_host",
    {
      title: "Get Host Detail",
      description: "Get full host detail by host ID, including groups, interfaces, tags, inventory, and linked items/triggers counts when available.",
      inputSchema: {
        hostId: z.string().describe("Zabbix host ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ hostId }) => {
      try {
        const data = await client.call<unknown[]>("host.get", {
          output: "extend",
          hostids: [hostId],
          selectGroups: "extend",
          selectInterfaces: "extend",
          selectTags: "extend",
          selectMacros: "extend",
          selectInventory: "extend",
        });
        return { content: [{ type: "text" as const, text: truncateResponse(data[0] ?? null) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );
}
