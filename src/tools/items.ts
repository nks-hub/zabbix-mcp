import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { ZabbixClient } from "../client.js";
import { pickDefined, safeError, toUnix, truncateResponse, resolvePagination, paginatedResponse } from "../utils.js";

const historyTypeSchema = z.enum(["float", "string", "log", "uint", "text", "binary"]);
const historyTypeToInt: Record<z.infer<typeof historyTypeSchema>, number> = {
  float: 0,
  string: 1,
  log: 2,
  uint: 3,
  text: 4,
  binary: 5,
};

export function registerItemTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_items",
    {
      title: "List Items",
      description: "List Zabbix items by host/group/search. Supports pagination. Useful for metrics discovery before reading history.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against item name"),
        keySearch: z.string().optional().describe("Substring search against item key_"),
        monitoredOnly: z.boolean().optional().describe("Only return monitored items"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z.number().min(1).max(MAX_PAGE_SIZE).optional().describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const search = args.search || args.keySearch ? pickDefined({ name: args.search, key_: args.keySearch }) : undefined;
        const data = await client.call<unknown[]>("item.get", pickDefined({
          output: ["itemid", "hostid", "name", "key_", "value_type", "status", "state", "units", "lastvalue", "lastclock", "error"],
          selectHosts: ["hostid", "host", "name"],
          hostids: args.hostIds,
          groupids: args.groupIds,
          search,
          monitored: args.monitoredOnly,
          sortfield: ["name"],
          sortorder: "ASC",
          limit: pg.limit,
        }));
        return { content: [{ type: "text" as const, text: paginatedResponse(data, pg) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_get_item_history",
    {
      title: "Get Item History",
      description: "Read raw history for a Zabbix item over a time range. Supports pagination. You must provide the correct history type matching the item value_type.",
      inputSchema: {
        itemId: z.string().describe("Item ID"),
        historyType: historyTypeSchema.describe("History storage type matching item value_type"),
        since: z.string().optional().describe("Start time (ISO date/time or unix timestamp)"),
        till: z.string().optional().describe("End time (ISO date/time or unix timestamp)"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z.number().min(1).max(MAX_PAGE_SIZE).optional().describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const data = await client.call<unknown[]>("history.get", pickDefined({
          output: "extend",
          history: historyTypeToInt[args.historyType],
          itemids: [args.itemId],
          time_from: toUnix(args.since),
          time_till: toUnix(args.till),
          sortfield: "clock",
          sortorder: "DESC",
          limit: pg.limit,
        }));
        return { content: [{ type: "text" as const, text: paginatedResponse(data, pg) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );
}
