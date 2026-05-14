import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { ZabbixClient } from "../client.js";
import {
  pickDefined,
  safeError,
  toUnix,
  resolvePagination,
  buildPaginatedEnvelope,
  lastSeenFrom,
  rpcPaginationParams,
} from "../utils.js";

const historyTypeSchema = z.enum(["float", "string", "log", "uint", "text", "binary"]);
type HistoryType = z.infer<typeof historyTypeSchema>;

const historyTypeToInt: Record<HistoryType, number> = {
  float: 0,
  string: 1,
  log: 2,
  uint: 3,
  text: 4,
  binary: 5,
};

const intToHistoryType: Record<number, HistoryType> = {
  0: "float",
  1: "string",
  2: "log",
  3: "uint",
  4: "text",
  5: "binary",
};

const paginationOutput = {
  page: z.number(),
  pageSize: z.number(),
  returned: z.number(),
  hasMore: z.boolean(),
  nextPage: z.number().optional(),
  truncated: z.boolean().optional(),
  droppedCount: z.number().optional(),
  hint: z.string().optional(),
};

const listItemsOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of Zabbix item objects"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

const itemHistoryOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of history rows (clock, value, ...)"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
  resolvedHistoryType: z
    .string()
    .optional()
    .describe("History type used for the query (echoed when auto-resolved from item value_type)"),
};

async function resolveHistoryTypeFromItem(client: ZabbixClient, itemId: string): Promise<HistoryType> {
  const data = await client.call<Array<{ value_type?: string | number }>>("item.get", {
    output: ["itemid", "value_type"],
    itemids: [itemId],
  });
  if (!data.length) {
    throw new Error(
      `Item ${itemId} not found. Cannot auto-resolve historyType. Verify the itemId or pass historyType explicitly (float/uint/string/text/log/binary).`
    );
  }
  const vt = Number(data[0].value_type);
  const mapped = intToHistoryType[vt];
  if (!mapped) {
    throw new Error(
      `Item ${itemId} has unsupported value_type=${vt}. Pass historyType explicitly if you need to override.`
    );
  }
  return mapped;
}

export function registerItemTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_items",
    {
      title: "List Items",
      description:
        "List Zabbix items by host/group/search. Supports pagination. Useful for metrics discovery before reading history. Returned items include `value_type` which feeds zabbix_get_item_history.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against item name"),
        keySearch: z.string().optional().describe("Substring search against item key_"),
        monitoredOnly: z.boolean().optional().describe("Only return monitored items"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      outputSchema: listItemsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing items",
        "openai/toolInvocation/invoked": "Listed items",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: true });
        const search =
          args.search || args.keySearch
            ? pickDefined({ name: args.search, key_: args.keySearch })
            : undefined;
        const data = await client.call<unknown[]>(
          "item.get",
          pickDefined({
            output: [
              "itemid",
              "hostid",
              "name",
              "key_",
              "value_type",
              "status",
              "state",
              "units",
              "lastvalue",
              "lastclock",
              "error",
            ],
            selectHosts: ["hostid", "host", "name"],
            hostids: args.hostIds,
            groupids: args.groupIds,
            search,
            monitored: args.monitoredOnly,
            sortfield: ["name"],
            sortorder: "ASC",
            ...rpcPg,
          })
        );
        const queryEcho = pickDefined({
          hostIds: args.hostIds,
          groupIds: args.groupIds,
          search: args.search,
          keySearch: args.keySearch,
          monitoredOnly: args.monitoredOnly,
        });
        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["itemid", "name"]),
          query: Object.keys(queryEcho).length ? queryEcho : undefined,
        });
        return {
          structuredContent: env.structured as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: env.text }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "zabbix_get_item_history",
    {
      title: "Get Item History",
      description:
        "Read raw history for a Zabbix item over a time range. Supports pagination. " +
        "`historyType` is OPTIONAL — when omitted the server auto-resolves it from the item's value_type via item.get. " +
        "Pass historyType explicitly only if you need to override (rare).",
      inputSchema: {
        itemId: z.string().describe("Item ID"),
        historyType: historyTypeSchema
          .optional()
          .describe(
            "History storage type. Optional: omit to auto-resolve from item value_type. Explicit values: float (0), string (1), log (2), uint (3), text (4), binary (5)."
          ),
        since: z.string().optional().describe("Start time (ISO date/time or unix timestamp)"),
        till: z.string().optional().describe("End time (ISO date/time or unix timestamp)"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      outputSchema: itemHistoryOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Reading history",
        "openai/toolInvocation/invoked": "Read history",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: false, methodLabel: "history.get" });
        let historyType: HistoryType;
        let autoResolved = false;
        if (args.historyType) {
          historyType = args.historyType;
        } else {
          historyType = await resolveHistoryTypeFromItem(client, args.itemId);
          autoResolved = true;
        }

        const data = await client.call<unknown[]>(
          "history.get",
          pickDefined({
            output: "extend",
            history: historyTypeToInt[historyType],
            itemids: [args.itemId],
            time_from: toUnix(args.since),
            time_till: toUnix(args.till),
            sortfield: "clock",
            sortorder: "DESC",
            ...rpcPg,
          })
        );

        const queryEcho = pickDefined({
          itemId: args.itemId,
          historyType,
          autoResolvedHistoryType: autoResolved || undefined,
          since: args.since,
          till: args.till,
        });
        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["clock", "ns"]),
          query: queryEcho,
        });
        const structured = {
          ...env.structured,
          resolvedHistoryType: historyType,
        };
        return {
          structuredContent: structured as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: env.text }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }],
          isError: true,
        };
      }
    }
  );
}
