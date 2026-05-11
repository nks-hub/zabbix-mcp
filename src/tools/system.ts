import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ZabbixClient } from "../client.js";
import { safeError, truncateResponse } from "../utils.js";

const healthOutput = {
  status: z.string().describe("Health status, 'ok' on success"),
  version: z.string().describe("Zabbix API version"),
  latestEvent: z.unknown().nullable().describe("Most recent event object or null"),
};

export function registerSystemTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_health",
    {
      title: "Zabbix Health",
      description:
        "Connectivity check for Zabbix API. Returns API version and current server time.",
      inputSchema: {},
      outputSchema: healthOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Checking Zabbix",
        "openai/toolInvocation/invoked": "Checked Zabbix",
      },
    },
    async () => {
      try {
        const [version, now] = await Promise.all([
          client.call<string>("apiinfo.version", {}),
          client.call<unknown[]>("event.get", {
            output: ["eventid", "clock"],
            sortfield: "eventid",
            sortorder: "DESC",
            limit: 1,
          }),
        ]);

        const result = {
          status: "ok",
          version,
          latestEvent: now?.[0] ?? null,
        };

        return {
          structuredContent: result as unknown as Record<string, unknown>,
          content: [
            {
              type: "text" as const,
              text: truncateResponse(result),
            },
          ],
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
