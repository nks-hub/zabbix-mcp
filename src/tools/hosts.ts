import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../constants.js";
import { ZabbixClient } from "../client.js";
import { pickDefined, safeError, truncateResponse, resolvePagination, paginatedResponse } from "../utils.js";

export function registerHostTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_host_groups",
    {
      title: "List Host Groups",
      description: "List Zabbix host groups with optional name search. Supports pagination.",
      inputSchema: {
        search: z.string().optional().describe("Substring search against host group name"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z.number().min(1).max(MAX_PAGE_SIZE).optional().describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const data = await client.call<unknown[]>("hostgroup.get", pickDefined({
          output: ["groupid", "name", "flags", "internal"],
          search: args.search ? { name: args.search } : undefined,
          sortfield: "name",
          sortorder: "ASC",
          limit: pg.limit,
          ...(pg.offset > 0 ? { limitSelects: pg.limit } : {}),
        }));
        return { content: [{ type: "text" as const, text: paginatedResponse(data, pg) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_list_hosts",
    {
      title: "List Hosts",
      description: "List monitored Zabbix hosts with optional filtering by group, name, status. Supports pagination.",
      inputSchema: {
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against visible host name"),
        technicalName: z.string().optional().describe("Substring search against technical host field"),
        status: z.enum(["enabled", "disabled"]).optional().describe("Filter by host status"),
        monitoredOnly: z.boolean().optional().describe("When true, return only monitored/active hosts"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z.number().min(1).max(MAX_PAGE_SIZE).optional().describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
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
          limit: pg.limit,
        });

        const data = await client.call<unknown[]>("host.get", params);
        return { content: [{ type: "text" as const, text: paginatedResponse(data, pg) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_get_host",
    {
      title: "Get Host Detail",
      description: "Get full host detail by host ID, including groups, interfaces, tags, inventory, and linked items/triggers counts.",
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
