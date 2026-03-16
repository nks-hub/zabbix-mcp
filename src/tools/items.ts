import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { ZabbixClient } from "../client.js";
import { pickDefined, safeError, toUnix, truncateResponse } from "../utils.js";

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
      description: "List Zabbix items by host/group/search. Useful for metrics discovery before reading history.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against item name"),
        keySearch: z.string().optional().describe("Substring search against item key_"),
        monitoredOnly: z.boolean().optional().describe("Only return monitored items"),
        limit: z.number().min(1).max(MAX_LIMIT).optional().describe(`Maximum items to return (default: ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
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
          limit: args.limit ?? DEFAULT_LIMIT,
        }));
        return { content: [{ type: "text" as const, text: truncateResponse(data) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_get_item_history",
    {
      title: "Get Item History",
      description: "Read raw history for a Zabbix item over a time range. You must provide the correct history type matching the item value_type.",
      inputSchema: {
        itemId: z.string().describe("Item ID"),
        historyType: historyTypeSchema.describe("History storage type matching item value_type"),
        since: z.string().optional().describe("Start time (ISO date/time or unix timestamp)"),
        till: z.string().optional().describe("End time (ISO date/time or unix timestamp)"),
        limit: z.number().min(1).max(MAX_LIMIT).optional().describe(`Maximum history rows to return (default: ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ itemId, historyType, since, till, limit }) => {
      try {
        const data = await client.call<unknown[]>("history.get", pickDefined({
          output: "extend",
          history: historyTypeToInt[historyType],
          itemids: [itemId],
          time_from: toUnix(since),
          time_till: toUnix(till),
          sortfield: "clock",
          sortorder: "DESC",
          limit: limit ?? DEFAULT_LIMIT,
        }));
        return { content: [{ type: "text" as const, text: truncateResponse(data) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );
}
