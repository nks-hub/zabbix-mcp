import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZabbixClient } from "../client.js";
import { safeError, truncateResponse } from "../utils.js";

export function registerSystemTools(server: McpServer, client: ZabbixClient): void {
  server.registerTool(
    "zabbix_health",
    {
      title: "Zabbix Health",
      description:
        "Connectivity check for Zabbix API. Returns API version and current server time.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
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

        return {
          content: [
            {
              type: "text" as const,
              text: truncateResponse({
                status: "ok",
                version,
                latestEvent: now?.[0] ?? null,
              }),
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
