import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../constants.js";
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

const listHostGroupsOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of host group objects"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

const listHostsOutput = {
  data: z.array(z.object({}).passthrough()).describe("Array of host objects with interfaces and groups"),
  pagination: z.object(paginationOutput),
  lastSeen: z.object({}).passthrough().optional(),
  query: z.object({}).passthrough().optional(),
};

// Host detail returns a Zabbix host object with many fields (extend output).
const hostDetailOutput = {
  hostid: z.string().optional(),
};

export function registerHostTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_list_host_groups",
    {
      title: "List Host Groups",
      description: "List Zabbix host groups with optional name search. Supports pagination.",
      inputSchema: {
        search: z.string().optional().describe("Substring search against host group name"),
        page: z.number().min(1).optional().describe("Page number (default: 1)"),
        pageSize: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      outputSchema: listHostGroupsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing host groups",
        "openai/toolInvocation/invoked": "Listed host groups",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: false, methodLabel: "hostgroup.get" });
        const data = await client.call<unknown[]>(
          "hostgroup.get",
          pickDefined({
            output: ["groupid", "name", "flags", "internal"],
            search: args.search ? { name: args.search } : undefined,
            sortfield: "name",
            sortorder: "ASC",
            ...rpcPg,
          })
        );
        const queryEcho = pickDefined({ search: args.search });
        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["groupid", "name"]),
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
        pageSize: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
      },
      outputSchema: listHostsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Listing hosts",
        "openai/toolInvocation/invoked": "Listed hosts",
      },
    },
    async (args) => {
      try {
        const pg = resolvePagination(args);
        const rpcPg = rpcPaginationParams(pg, { offsetSupported: true });
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
          ...rpcPg,
        });

        const data = await client.call<unknown[]>("host.get", params);
        const queryEcho = pickDefined({
          groupIds: args.groupIds,
          search: args.search,
          technicalName: args.technicalName,
          status: args.status,
          monitoredOnly: args.monitoredOnly,
        });
        const env = buildPaginatedEnvelope(data, pg, {
          lastSeen: lastSeenFrom(data, ["hostid", "name"]),
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
    "zabbix_get_host",
    {
      title: "Get Host Detail",
      description: "Get full host detail by host ID, including groups, interfaces, tags, inventory, and linked items/triggers counts.",
      inputSchema: {
        hostId: z.string().describe("Zabbix host ID"),
      },
      outputSchema: hostDetailOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        "openai/toolInvocation/invoking": "Loading host",
        "openai/toolInvocation/invoked": "Loaded host",
      },
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
