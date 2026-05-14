import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ZABBIX_SEVERITY_MAP } from "../constants.js";
import { ZabbixClient } from "../client.js";
import {
  pickDefined,
  safeError,
  toUnix,
  truncateResponse,
  resolvePagination,
  buildPaginatedEnvelope,
  lastSeenFrom,
  rpcPaginationParams,
} from "../utils.js";

const severitySchema = z.enum(["not_classified", "information", "warning", "average", "high", "disaster"]);
const severityToInt: Record<z.infer<typeof severitySchema>, number> = {
  not_classified: 0,
  information: 1,
  warning: 2,
  average: 3,
  high: 4,
  disaster: 5,
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

const listProblemsOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of problem objects with severity_label added"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

const listEventsOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of event objects with acknowledges and hosts"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

const acknowledgeEventOutput = {
  eventids: z.array(z.string()).optional().describe("Affected event IDs returned by Zabbix"),
};

export function registerProblemTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_problems",
    {
      title: "List Problems",
      description:
        "List current or historical Zabbix problem events with filters for host, group, severity, acknowledgement, suppression, and time window. Supports pagination. Sorted DESC by eventid (newest first); use `lastSeen.eventid` from the response as a stable continuation reference.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        groupIds: z.array(z.string()).optional().describe("Host group IDs to filter by"),
        severity: z.array(severitySchema).optional().describe("Allowed severities"),
        search: z.string().optional().describe("Substring search against problem/event name"),
        acknowledged: z.boolean().optional().describe("Filter by acknowledged state"),
        suppressed: z.boolean().optional().describe("Filter by suppressed state"),
        recentOnly: z.boolean().optional().describe("When true, only unresolved/recent problems"),
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
      outputSchema: listProblemsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing problems",
        "openai/toolInvocation/invoked": "Listed problems",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: false, methodLabel: "problem.get" });
        const severities = args.severity?.map((s) => severityToInt[s]);
        const data = await client.call<unknown[]>(
          "problem.get",
          pickDefined({
            output: "extend",
            selectAcknowledges: "extend",
            selectTags: "extend",
            selectSuppressionData: "extend",
            hostids: args.hostIds,
            groupids: args.groupIds,
            search: args.search ? { name: args.search } : undefined,
            acknowledged: args.acknowledged,
            suppressed: args.suppressed,
            recent: args.recentOnly,
            severities,
            time_from: toUnix(args.since),
            time_till: toUnix(args.till),
            sortfield: ["eventid"],
            sortorder: "DESC",
            ...rpcPg,
          })
        );

        const normalized = data.map((item: any) => ({
          ...item,
          severity_label: ZABBIX_SEVERITY_MAP[Number(item.severity)] ?? item.severity,
        }));

        const queryEcho = pickDefined({
          hostIds: args.hostIds,
          groupIds: args.groupIds,
          severity: args.severity,
          search: args.search,
          acknowledged: args.acknowledged,
          suppressed: args.suppressed,
          recentOnly: args.recentOnly,
          since: args.since,
          till: args.till,
        });

        const env = buildPaginatedEnvelope(normalized, pg, {
          lastSeen: lastSeenFrom(normalized, ["eventid", "clock"]),
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
    "zabbix_list_events",
    {
      title: "List Events",
      description:
        "List trigger events from Zabbix. Supports pagination. Use for timeline/history work when problem.get is too narrow. Sorted DESC by eventid; use `lastSeen.eventid` as a continuation reference.",
      inputSchema: {
        hostIds: z.array(z.string()).optional().describe("Host IDs to filter by"),
        objectIds: z.array(z.string()).optional().describe("Trigger IDs to filter by"),
        search: z.string().optional().describe("Substring search against event name"),
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
      outputSchema: listEventsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing events",
        "openai/toolInvocation/invoked": "Listed events",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: false, methodLabel: "event.get" });
        const data = await client.call<unknown[]>(
          "event.get",
          pickDefined({
            output: "extend",
            selectAcknowledges: "extend",
            selectHosts: ["hostid", "host", "name", "status"],
            source: 0,
            object: 0,
            hostids: args.hostIds,
            objectids: args.objectIds,
            search: args.search ? { name: args.search } : undefined,
            time_from: toUnix(args.since),
            time_till: toUnix(args.till),
            sortfield: ["eventid"],
            sortorder: "DESC",
            ...rpcPg,
          })
        );

        const queryEcho = pickDefined({
          hostIds: args.hostIds,
          objectIds: args.objectIds,
          search: args.search,
          since: args.since,
          till: args.till,
        });

        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["eventid", "clock"]),
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
    "zabbix_acknowledge_event",
    {
      title: "Acknowledge / Update Event",
      description:
        "Acknowledge a problem event, optionally add a message, change severity, close it manually, suppress it, or unacknowledge it.",
      inputSchema: {
        eventIds: z.array(z.string()).min(1).describe("Problem event IDs to update"),
        acknowledge: z.boolean().optional().describe("Set acknowledged state"),
        unacknowledge: z.boolean().optional().describe("Clear acknowledged state"),
        message: z.string().optional().describe("Optional event message"),
        severity: severitySchema.optional().describe("Optional new severity"),
        close: z.boolean().optional().describe("Attempt manual close on the problem"),
        suppressUntil: z
          .string()
          .optional()
          .describe("Suppress until time (ISO date/time or unix timestamp). Use 0 for indefinite suppression."),
        unsuppress: z.boolean().optional().describe("Remove existing suppression"),
      },
      outputSchema: acknowledgeEventOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Updating event",
        "openai/toolInvocation/invoked": "Updated event",
      },
    },
    async (args) => {
      try {
        let action = 0;
        if (args.close) action += 1;
        if (args.acknowledge) action += 2;
        if (args.message) action += 4;
        if (args.severity) action += 8;
        if (args.unacknowledge) action += 16;
        if (args.suppressUntil !== undefined) action += 32;
        if (args.unsuppress) action += 64;

        if (!action) {
          throw new Error("No action selected. Choose acknowledge/message/severity/close/suppress/unsuppress.");
        }

        const data = await client.call<unknown>(
          "event.acknowledge",
          pickDefined({
            eventids: args.eventIds,
            action,
            message: args.message,
            severity: args.severity ? severityToInt[args.severity] : undefined,
            suppress_until: args.suppressUntil === "0" ? 0 : toUnix(args.suppressUntil),
          })
        );
        const structured = (data && typeof data === "object" ? data : { result: data }) as Record<string, unknown>;
        return {
          structuredContent: structured,
          content: [{ type: "text" as const, text: truncateResponse(data) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${safeError(err)}` }], isError: true };
      }
    }
  );
}
