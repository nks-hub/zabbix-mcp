import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { ZabbixClient } from "../client.js";
import {
  pickDefined,
  safeError,
  truncateResponse,
  resolvePagination,
  buildPaginatedEnvelope,
  lastSeenFrom,
  rpcPaginationParams,
} from "../utils.js";

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

const listTriggersOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of trigger objects with hosts and dependencies"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

const triggerDetailOutput = {
  triggerid: z.string().optional(),
};

export function registerTriggerTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_triggers",
    {
      title: "List Triggers",
      description: "List Zabbix triggers with filters for host, group, state, severity. Supports pagination.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        search: z.string().optional().describe("Substring search against trigger description"),
        monitoredOnly: z.boolean().optional().describe("Return only monitored triggers"),
        problemOnly: z.boolean().optional().describe("Return only triggers currently in problem state"),
        severityMin: z.number().min(0).max(5).optional().describe("Minimum priority/severity 0-5"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      outputSchema: listTriggersOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing triggers",
        "openai/toolInvocation/invoked": "Listed triggers",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: true });
        const data = await client.call<unknown[]>(
          "trigger.get",
          pickDefined({
            output: "extend",
            selectHosts: ["hostid", "host", "name", "status"],
            selectDependencies: "extend",
            hostids: args.hostIds,
            groupids: args.groupIds,
            search: args.search ? { description: args.search } : undefined,
            monitored: args.monitoredOnly,
            only_true: args.problemOnly,
            min_severity: args.severityMin,
            sortfield: ["priority", "description"],
            sortorder: "DESC",
            ...rpcPg,
          })
        );
        const queryEcho = pickDefined({
          hostIds: args.hostIds,
          groupIds: args.groupIds,
          search: args.search,
          monitoredOnly: args.monitoredOnly,
          problemOnly: args.problemOnly,
          severityMin: args.severityMin,
        });
        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["triggerid", "description", "priority"]),
          query: Object.keys(queryEcho).length ? queryEcho : undefined,
        });
        return {
          structuredContent: env.structured as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: env.text }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "zabbix_get_trigger",
    {
      title: "Get Trigger Detail",
      description: "Get full detail for a single Zabbix trigger including hosts, items, tags, dependencies, and discovery data.",
      inputSchema: {
        triggerId: z.string().describe("Trigger ID"),
      },
      outputSchema: triggerDetailOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Loading trigger",
        "openai/toolInvocation/invoked": "Loaded trigger",
      },
    },
    async ({ triggerId }) => {
      try {
        const data = await client.call<unknown[]>("trigger.get", {
          output: "extend",
          triggerids: [triggerId],
          selectHosts: "extend",
          selectItems: "extend",
          selectTags: "extend",
          selectDependencies: "extend",
          selectDiscoveryRule: "extend",
        });
        const item = data[0] ?? null;
        return {
          structuredContent: (item ?? {}) as Record<string, unknown>,
          content: [{ type: "text" as const, text: truncateResponse(item) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );
}
