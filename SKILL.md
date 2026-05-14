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

All tools use JSON-RPC against the Zabbix API. Paginated tools return a self-describing envelope:

```json
{
  "data": [...],
  "pagination": {
    "page": 1, "pageSize": 50, "returned": 50, "hasMore": true, "nextPage": 2,
    "truncated": false
  },
  "lastSeen": { "eventid": "12345", "clock": "1715600000" },
  "query": { "hostIds": ["10084"], "severity": ["high", "disaster"] }
}
```

Key envelope fields (designed to survive Claude Code `/compact` and similar context-loss events):

- **`pagination.truncated`** + **`droppedCount`** + **`hint`** — set when the response was binary-search-trimmed to fit the 25,000 char limit. You see *exactly* how many items were dropped and a remediation hint. No silent JSON slicing.
- **`lastSeen`** — stable continuation reference extracted from the last item (e.g., `eventid` + `clock` for problems/events, `hostid` + `name` for hosts). Use this when paginating across sessions, or as a `since`/`till` anchor when the underlying Zabbix method does not support offset-based pagination.
- **`query`** — echo of the resolved filter parameters that produced this page. After context loss, you can read the filter context off the response itself instead of trying to recall the original tool arguments.

### Pagination caveat (per-method offset support)

Zabbix RPC does **not** support `offset` uniformly. zabbix-mcp encodes this:

| Method | Supports `offset`? | Pagination beyond page 1 |
|--------|--------------------|--------------------------|
| `host.get`, `item.get`, `trigger.get` | Yes | Standard `page`/`pageSize` |
| `hostgroup.get`, `problem.get`, `event.get`, `history.get` | No | Page 1 only via `page`/`pageSize`; for deeper pages, narrow with filters (`since`, `till`, `hostIds`, `severity`) or use `lastSeen.eventid`/`lastSeen.clock` as a cursor anchor |

Calling `page > 1` on a non-offset method returns an actionable error explaining the cursor-style alternative.

### Constants

- Default page size: **50**
- Maximum page size: **500**
- Response character limit: **25,000** (binary-search-trim on data array; metadata always preserved)
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

Fetch raw metric history for a specific item over a time range. Sorted DESC by `clock` (newest first).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `itemId` | `string` | **Yes** | Item ID |
| `historyType` | `string` | **Optional** | History storage type: `"float"`, `"string"`, `"log"`, `"uint"`, `"text"`, `"binary"`. **Omit to auto-resolve** from the item's `value_type` (one extra `item.get` lookup). Pass explicitly only to override. |
| `since` | `string` | No | Start time (ISO date/time or unix timestamp) |
| `till` | `string` | No | End time (ISO date/time or unix timestamp) |
| `page` | `number` | No | Page number (default: 1). `history.get` does not support offset on the Zabbix side; use `till` set to the previous page's `lastSeen.clock` as a cursor for older history. |
| `pageSize` | `number` | No | Items per page (default: 50, max: 500) |

**Returns**: Envelope with `data` (history records `{ itemid, clock, value, ns }`), `pagination`, `lastSeen: { clock, ns }`, `query` (including `historyType` and `autoResolvedHistoryType` flag), and `resolvedHistoryType` (echoed at the top level for convenience).

**Tip**: When `historyType` is omitted, the resolved value appears in both `query.historyType` and `resolvedHistoryType` so you can confirm the mapping without re-deriving it from `value_type`.

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
    "nextPage": 2,
    "truncated": false
  },
  "lastSeen": { "eventid": "12345", "clock": "1715600000" },
  "query": { "hostIds": ["10084"], "severity": ["high"] }
}
```

When `hasMore` is true, request the next page to continue. When `returned < pageSize`, there are no more results.

**When `pagination.truncated` is true**, the JSON exceeded the 25,000 char limit and was binary-search-trimmed. `droppedCount` and `hint` describe what was lost and how to narrow the next call.

**`lastSeen`** is a stable continuation reference (e.g., `eventid` + `clock` on problems/events, `clock` + `ns` on history). Use it as a cursor anchor on Zabbix methods that do not support offset-based pagination (`problem.get`, `event.get`, `hostgroup.get`, `history.get`).

**`query`** echoes the resolved filter parameters. After context loss (`/compact`, summarization), you can reconstruct the filter intent directly from the response without recalling the original arguments.

## 8. Tips & Gotchas

- **Auth token is cached indefinitely** in the process. If the token expires or is revoked, restart the MCP server.
- **API token auth is preferred** over login auth because it avoids session management and the `user.login` call.
- **URL normalization**: You can pass the base URL (`https://host`), the Zabbix path (`https://host/zabbix`), or the full API endpoint (`https://host/api_jsonrpc.php`). All are normalized automatically.
- **History type auto-resolved**: `zabbix_get_item_history` now resolves `historyType` from the item's `value_type` automatically. You no longer need to call `zabbix_list_items` first just to look it up. Pass `historyType` explicitly only if you need to force a different storage type (rare).
- **Response truncation is observable, not silent**: When a response exceeds 25,000 chars, the data array is binary-search-trimmed and `pagination.truncated=true`, `pagination.droppedCount=N`, and `pagination.hint` describe the trim. The JSON envelope always remains valid.
- **`lastSeen` is your compaction-safe cursor**: After context loss, you do not need to recall prior IDs. Read `lastSeen` off the previous envelope (e.g., `lastSeen.eventid` for problems, `lastSeen.clock` for history) and use it as the cursor anchor for the next call.
- **`query` echo is your filter-context recovery**: The response carries back the resolved filters. After `/compact`, you can rebuild understanding of "what was being investigated" from the envelope alone.
- **acknowledge_event is the only write operation**: All other tools are read-only. The acknowledge tool can change production monitoring state (close problems, change severity, suppress alerts) -- use deliberately.
- **Event source filtering**: `zabbix_list_events` only returns trigger events (source=0, object=0). Internal events, discovery events, and autoregistration events are excluded.
- **30-second timeout**: All API requests time out after 30 seconds. Large queries on busy Zabbix instances may need narrower filters.
- **Sorting**: Problems and events are sorted newest-first (DESC by eventid/clock). Hosts, items, triggers, and host groups are sorted alphabetically by name.
- **Offset support varies by Zabbix method** — see the table in section 4. For methods without offset support, `page > 1` returns an actionable error; use `since`/`till` + `lastSeen` as the cursor instead.
