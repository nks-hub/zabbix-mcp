---
name: zabbix-mcp
description: "MCP server for Zabbix infrastructure monitoring. Provides tools to query hosts, host groups, active problems, triggers, events, items (metrics), and historical metric values. Enables server health checks, incident triage, alert acknowledgement, capacity analysis, and root-cause investigation. Use whenever the user mentions monitoring, server issues, alerts, infrastructure health, Zabbix, system metrics, CPU, memory, disk, network, uptime, or wants to check if servers are running properly. Covers: problems, triggers, events, items, history, severity, acknowledgements, suppression, host inventory, interfaces, IPMI, SMART, RAID, HAProxy, Nginx, MySQL, PHP-FPM metrics."
---

# zabbix-mcp Skill Reference

## 1. Purpose & Context

**Zabbix** is an enterprise-class open-source monitoring solution for networks, servers, virtual machines, cloud services, and applications. It collects metrics (items), evaluates conditions (triggers), raises alerts (problems/events), and provides historical data for capacity planning and root-cause analysis.

**zabbix-mcp** is an MCP (Model Context Protocol) server that exposes 11 tools for querying and operating on a Zabbix instance. It enables an AI assistant to:

- Check connectivity and API health
- Discover host groups and hosts
- List active problems filtered by severity, host, group, time window
- Browse trigger definitions and their state
- Query event timelines for incident investigation
- Acknowledge, annotate, close, suppress, or re-severity events
- Discover items (metrics) on hosts
- Fetch raw historical metric values for any item

**Package**: `@nks-hub/zabbix-mcp` (npm)
**Repository**: https://github.com/nks-hub/zabbix-mcp
**Runtime**: Node.js 18+, TypeScript, MCP SDK 1.27+

## 2. Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZABBIX_URL` | Yes | Zabbix instance URL. Accepts any of: `https://host/api_jsonrpc.php`, `https://host/zabbix`, `https://host` (auto-normalized to API endpoint) |
| `ZABBIX_API_TOKEN` | One of token/login | API token (recommended). Sent as `Authorization: Bearer <token>` header |
| `ZABBIX_USERNAME` | One of token/login | Username for login-based auth |
| `ZABBIX_PASSWORD` | One of token/login | Password for login-based auth |

If `ZABBIX_API_TOKEN` is set, it takes priority. Otherwise `ZABBIX_USERNAME` + `ZABBIX_PASSWORD` are used and the server calls `user.login` to obtain a session token (cached for the lifetime of the process).

### Claude Code MCP Configuration

Add to `~/.claude/.mcp.json` or project `.claude/settings.json`:

```json
{
  "mcpServers": {
    "zabbix": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@nks-hub/zabbix-mcp"],
      "env": {
        "ZABBIX_URL": "https://monitor.example.com/api_jsonrpc.php",
        "ZABBIX_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## 3. Zabbix Concepts Primer

| Concept | Description |
|---------|-------------|
| **Host Group** | Logical grouping of hosts (e.g., "Linux servers", "Network devices"). Used for access control and filtering. |
| **Host** | A monitored entity — server, VM, router, appliance. Has interfaces (agent, SNMP, IPMI, JMX), macros, tags, inventory. |
| **Item** | A single metric collected from a host. Identified by `key_` (e.g., `system.cpu.util`, `vfs.fs.size[/,pfree]`). Has a `value_type` that determines the history storage format. |
| **Trigger** | A logical expression evaluated against item values. When the expression becomes TRUE, the trigger fires and creates a problem. Has a severity/priority (0-5). |
| **Problem** | An active issue created when a trigger fires. Remains open until the trigger recovers or the problem is manually closed. Can be acknowledged, suppressed, annotated. |
| **Event** | A state-change record. Every trigger state transition (OK->PROBLEM, PROBLEM->OK) creates an event. Events form the timeline for incident investigation. |
| **History** | Raw metric values stored over time for each item. Queried by item ID, history type, and time range. Essential for root-cause analysis and capacity planning. |
| **Severity** | Priority level assigned to triggers/problems. Determines alerting behavior and visual priority. |

### Severity Levels

| Numeric | Name | Typical Use |
|---------|------|-------------|
| 0 | `not_classified` | Default, unset severity |
| 1 | `information` | Informational notices (e.g., host rebooted, service restarted) |
| 2 | `warning` | Early warnings (e.g., disk usage > 80%, high CPU for 5 min) |
| 3 | `average` | Moderate issues requiring attention (e.g., service degraded, memory pressure) |
| 4 | `high` | Important problems requiring prompt action (e.g., RAID degraded, PSU failure) |
| 5 | `disaster` | Critical failures (e.g., host unreachable, disk failed, all PSUs down) |

## 4. Complete Tool Reference

All tools use JSON-RPC against the Zabbix API. Responses are auto-truncated at 25,000 characters. Paginated tools return `{ data, pagination: { page, pageSize, returned, hasMore, nextPage? } }`.

### Constants

- Default page size: **50**
- Maximum page size: **500**
- Response character limit: **25,000**
- Request timeout: **30 seconds**

---

### `zabbix_health`

Connectivity smoke test. Returns API version and the latest event as a heartbeat.

**Parameters**: None

**Returns**: `{ status: "ok", version: string, latestEvent: object | null }`

**Example use**: First call in any monitoring workflow to verify the Zabbix API is reachable.

---

### `zabbix_list_host_groups`

List Zabbix host groups with optional name search. Paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | `string` | No | Substring search against host group name |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of `{ groupid, name, flags, internal }` objects.

---

### `zabbix_list_hosts`

List monitored hosts with optional filtering by group, name, status. Paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `groupIds` | `string[]` | No | Host group IDs to filter by |
| `search` | `string` | No | Substring search against visible host name |
| `technicalName` | `string` | No | Substring search against technical host field |
| `status` | `"enabled" \| "disabled"` | No | Filter by host status |
| `monitoredOnly` | `boolean` | No | When true, return only monitored/active hosts |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of host objects with `{ hostid, host, name, status, maintenance_status, description, proxyid }` plus `interfaces` and `groups` sub-objects.

---

### `zabbix_get_host`

Get full host detail by host ID, including groups, interfaces, tags, macros, and inventory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostId` | `string` | **Yes** | Zabbix host ID |

**Returns**: Single host object with all extended properties, groups, interfaces, tags, macros, and inventory.

---

### `zabbix_list_problems`

List current or historical problem events with rich filtering. Paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostIds` | `string[]` | No | Host IDs to filter by |
| `groupIds` | `string[]` | No | Host group IDs to filter by |
| `severity` | `string[]` | No | Allowed severities: `"not_classified"`, `"information"`, `"warning"`, `"average"`, `"high"`, `"disaster"` |
| `search` | `string` | No | Substring search against problem/event name |
| `acknowledged` | `boolean` | No | Filter by acknowledged state |
| `suppressed` | `boolean` | No | Filter by suppressed state |
| `recentOnly` | `boolean` | No | When true, only unresolved/recent problems |
| `since` | `string` | No | Start time (ISO date/time or unix timestamp) |
| `till` | `string` | No | End time (ISO date/time or unix timestamp) |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of problem objects with extended properties, acknowledges, tags, suppression data, and an added `severity_label` field. Sorted by eventid DESC (newest first).

---

### `zabbix_list_events`

List trigger events for timeline/history analysis. Paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostIds` | `string[]` | No | Host IDs to filter by |
| `objectIds` | `string[]` | No | Trigger IDs to filter by |
| `search` | `string` | No | Substring search against event name |
| `since` | `string` | No | Start time (ISO date/time or unix timestamp) |
| `till` | `string` | No | End time (ISO date/time or unix timestamp) |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of event objects with extended properties, acknowledges, and host details. Only returns trigger-source events (`source: 0, object: 0`). Sorted by eventid DESC.

---

### `zabbix_acknowledge_event`

Acknowledge, annotate, close, suppress, or change severity of problem events. This is the only write operation -- use with care.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventIds` | `string[]` | **Yes** (min 1) | Problem event IDs to update |
| `acknowledge` | `boolean` | No | Set acknowledged state |
| `unacknowledge` | `boolean` | No | Clear acknowledged state |
| `message` | `string` | No | Event message / annotation |
| `severity` | `string` | No | New severity: `"not_classified"`, `"information"`, `"warning"`, `"average"`, `"high"`, `"disaster"` |
| `close` | `boolean` | No | Attempt manual close on the problem |
| `suppressUntil` | `string` | No | Suppress until time (ISO/unix). Use `"0"` for indefinite suppression |
| `unsuppress` | `boolean` | No | Remove existing suppression |

**Action bitmask** (computed automatically from provided parameters):
- `1` = close problem
- `2` = acknowledge
- `4` = add message
- `8` = change severity
- `16` = unacknowledge
- `32` = suppress
- `64` = unsuppress

At least one action must be selected or the call will error.

**Returns**: Zabbix API response confirming the operation.

---

### `zabbix_list_triggers`

List trigger definitions with filters for host, group, state, severity. Paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostIds` | `string[]` | No | Host IDs to filter by |
| `groupIds` | `string[]` | No | Host group IDs to filter by |
| `search` | `string` | No | Substring search against trigger description |
| `monitoredOnly` | `boolean` | No | Return only monitored triggers |
| `problemOnly` | `boolean` | No | Return only triggers currently in problem state |
| `severityMin` | `number` | No | Minimum priority/severity (0-5) |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of trigger objects with extended properties, host details, and dependency information. Sorted by priority DESC.

---

### `zabbix_get_trigger`

Get full detail for a single trigger including hosts, items, tags, dependencies, and discovery data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `triggerId` | `string` | **Yes** | Trigger ID |

**Returns**: Single trigger object with all extended properties, hosts, items, tags, dependencies, and discovery rule.

---

### `zabbix_list_items`

List Zabbix items (metrics) by host/group/search. Paginated. Use this to discover item IDs before reading history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostIds` | `string[]` | No | Host IDs to filter by |
| `groupIds` | `string[]` | No | Host group IDs to filter by |
| `search` | `string` | No | Substring search against item name |
| `keySearch` | `string` | No | Substring search against item `key_` |
| `monitoredOnly` | `boolean` | No | Only return monitored items |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of item objects with `{ itemid, hostid, name, key_, value_type, status, state, units, lastvalue, lastclock, error }` plus host details.

**Important**: The `value_type` field determines the history storage type needed for `zabbix_get_item_history`:
| value_type | History type | Meaning |
|------------|-------------|---------|
| 0 | `float` | Numeric (float) |
| 1 | `string` | Character |
| 2 | `log` | Log |
| 3 | `uint` | Numeric (unsigned) |
| 4 | `text` | Text |
| 5 | `binary` | Binary |

---

### `zabbix_get_item_history`

Fetch raw metric history for a specific item over a time range. Paginated. You must provide the correct `historyType` matching the item's `value_type`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `itemId` | `string` | **Yes** | Item ID |
| `historyType` | `string` | **Yes** | History storage type: `"float"`, `"string"`, `"log"`, `"uint"`, `"text"`, `"binary"` |
| `since` | `string` | No | Start time (ISO date/time or unix timestamp) |
| `till` | `string` | No | End time (ISO date/time or unix timestamp) |
| `page` | `number` | No | Page number (default: 1) |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Array of history records sorted by clock DESC (newest first). Each record contains `{ itemid, clock, value, ns }`.

## 5. Workflow Recipes

### Quick Health Check
1. `zabbix_health` -- verify API connectivity, get version
2. `zabbix_list_problems` with `severity: ["high", "disaster"]` -- see critical active problems
3. Summarize findings to user

### Server Investigation
1. `zabbix_list_hosts` with `search` or `groupIds` to find the host
2. `zabbix_list_items` with `hostIds: [hostId]` to discover available metrics
3. `zabbix_get_item_history` with `itemId`, correct `historyType`, and time range -- get raw values
4. Analyze trends (CPU spike? memory leak? disk filling up?)

### Problem Triage
1. `zabbix_list_problems` with time window (`since`) and severity filter
2. For each problem, note the `eventid` and associated trigger/host info
3. `zabbix_list_events` with `objectIds` (trigger IDs) for timeline context
4. `zabbix_acknowledge_event` with `eventIds`, `acknowledge: true`, and a `message` explaining resolution/status

### Capacity Planning
1. `zabbix_list_hosts` to identify target servers
2. `zabbix_list_items` with `hostIds` and `keySearch` for specific metrics (e.g., `system.cpu.util`, `vm.memory.utilization`, `vfs.fs.size`)
3. `zabbix_get_item_history` with a wide time range (days/weeks) to get trend data
4. Analyze growth rates and predict when thresholds will be hit

### Alert Review
1. `zabbix_list_triggers` with `problemOnly: true` to see all triggers currently in problem state
2. `zabbix_list_triggers` with `severityMin: 4` to focus on high/disaster triggers
3. `zabbix_get_trigger` for detailed expression and dependency analysis
4. Cross-reference with `zabbix_list_problems` for current problem state

### Maintenance Window
1. `zabbix_list_problems` to identify alerts that will fire during maintenance
2. `zabbix_acknowledge_event` with `suppress_until` set to maintenance end time
3. After maintenance: `zabbix_acknowledge_event` with `unsuppress: true` if needed

## 6. Time Parameters

All `since` and `till` parameters accept:
- **ISO 8601 date/time strings**: `"2026-03-23T00:00:00Z"`, `"2026-03-22"`, `"2026-03-23T12:30:00+01:00"`
- **Unix timestamps as strings**: `"1711152000"`

The server automatically converts ISO strings to unix timestamps via `Date.parse()`.

## 7. Pagination

All list tools support pagination:
- `page`: 1-based page number (default: 1)
- `pageSize`: items per page (default: 50, max: 500)

Response envelope:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "returned": 50,
    "hasMore": true,
    "nextPage": 2
  }
}
```

When `hasMore` is true, request the next page to continue. When `returned < pageSize`, there are no more results.

## 8. Tips & Gotchas

- **Auth token is cached indefinitely** in the process. If the token expires or is revoked, restart the MCP server.
- **API token auth is preferred** over login auth because it avoids session management and the `user.login` call.
- **URL normalization**: You can pass the base URL (`https://host`), the Zabbix path (`https://host/zabbix`), or the full API endpoint (`https://host/api_jsonrpc.php`). All are normalized automatically.
- **History type must match value_type**: When calling `zabbix_get_item_history`, check the item's `value_type` from `zabbix_list_items` first. Mismatched types return empty results, not errors.
- **Response truncation**: Results exceeding 25,000 characters are automatically truncated. For arrays, the server performs a binary search to fit the maximum number of items. Use filters and smaller page sizes to get complete data.
- **acknowledge_event is the only write operation**: All other tools are read-only. The acknowledge tool can change production monitoring state (close problems, change severity, suppress alerts) -- use deliberately.
- **Event source filtering**: `zabbix_list_events` only returns trigger events (source=0, object=0). Internal events, discovery events, and autoregistration events are excluded.
- **30-second timeout**: All API requests time out after 30 seconds. Large queries on busy Zabbix instances may need narrower filters.
- **Sorting**: Problems and events are sorted newest-first (DESC by eventid/clock). Hosts, items, triggers, and host groups are sorted alphabetically by name.
