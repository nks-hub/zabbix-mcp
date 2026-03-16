# @nks-hub/zabbix-mcp

[![Build](https://github.com/nks-hub/zabbix-mcp/actions/workflows/build.yml/badge.svg)](https://github.com/nks-hub/zabbix-mcp/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/%40nks-hub%2Fzabbix-mcp.svg)](https://www.npmjs.com/package/@nks-hub/zabbix-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-22c55e)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-3b82f6)](https://modelcontextprotocol.io)

Model Context Protocol server for Zabbix monitoring — inspect hosts, problems, triggers, events, items, history, and acknowledge incidents from Claude Code, OpenClaw, or any MCP-compatible client.

## Why Zabbix MCP?

When infrastructure questions hit, you usually need the same answers fast:

- Which hosts are monitored right now?
- What problems are active today?
- Which triggers are flapping or noisy?
- What item/history backs the alert?
- Can I acknowledge or annotate the event without opening the UI?

`@nks-hub/zabbix-mcp` turns those workflows into MCP tools so an agent can reason directly over Zabbix data instead of scraping dashboards.

## Features

- ✅ Host group discovery
- ✅ Host inventory and interface detail
- ✅ Problem event listing with time/severity filters
- ✅ Event timeline queries
- ✅ Trigger inspection
- ✅ Item discovery
- ✅ Raw item history lookup
- ✅ Event acknowledge / message / severity / close / suppress actions
- ✅ Supports API token auth **or** username/password login
- ✅ Works over stdio with MCP clients

## Available tools

### System
- `zabbix_health` — API connectivity smoke test

### Hosts
- `zabbix_list_host_groups` — discover host groups
- `zabbix_list_hosts` — list monitored hosts with filters
- `zabbix_get_host` — full host detail

### Problems & events
- `zabbix_list_problems` — inspect current/recent problems
- `zabbix_list_events` — trigger event timeline/history
- `zabbix_acknowledge_event` — acknowledge/add message/change severity/close/suppress

### Triggers
- `zabbix_list_triggers` — list triggers by host/group/problem state
- `zabbix_get_trigger` — full trigger detail

### Items & metrics
- `zabbix_list_items` — discover item IDs, keys, and last values
- `zabbix_get_item_history` — fetch raw metric history

## Installation

```bash
npm install -g @nks-hub/zabbix-mcp
```

## Configuration

Set either:

### Option A — API token (recommended)

```bash
export ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php"
export ZABBIX_API_TOKEN="your-zabbix-api-token"
```

### Option B — username + password

```bash
export ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php"
export ZABBIX_USERNAME="Admin"
export ZABBIX_PASSWORD="your-password"
```

`ZABBIX_URL` may be provided as:
- `https://monitor.example.com/api_jsonrpc.php`
- `https://monitor.example.com/zabbix`
- `https://monitor.example.com`

The server normalizes it to the API endpoint automatically.

## Quick start

### Run directly

```bash
ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php" \
ZABBIX_API_TOKEN="your-token" \
zabbix-mcp
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "zabbix": {
      "command": "zabbix-mcp",
      "env": {
        "ZABBIX_URL": "https://monitor.example.com/api_jsonrpc.php",
        "ZABBIX_API_TOKEN": "your-token"
      }
    }
  }
}
```

### OpenClaw / mcporter-style stdio config

```json
{
  "command": "node",
  "args": ["/full/path/to/zabbix-mcp/build/index.js"],
  "env": {
    "ZABBIX_URL": "https://monitor.example.com/api_jsonrpc.php",
    "ZABBIX_API_TOKEN": "your-token"
  }
}
```

## Development

```bash
git clone git@github.com:nks-hub/zabbix-mcp.git
cd zabbix-mcp
npm install
npm run build
```

### Local live smoke tests

```bash
ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php" \
ZABBIX_API_TOKEN="your-token" \
node test-live.mjs
```

Login-based test:

```bash
ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php" \
ZABBIX_USERNAME="Admin" \
ZABBIX_PASSWORD="your-password" \
node test-login.mjs
```

## Project structure

```text
zabbix-mcp/
├── .github/workflows/build.yml
├── src/
│   ├── client.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── utils.ts
│   └── tools/
│       ├── hosts.ts
│       ├── items.ts
│       ├── problems.ts
│       ├── system.ts
│       └── triggers.ts
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## Notes

- `zabbix_acknowledge_event` changes production monitoring state — use it intentionally.
- `zabbix_get_item_history` requires the correct history type (`float`, `uint`, `string`, etc.). If unsure, call `zabbix_list_items` first and inspect `value_type`.
- `zabbix_health` intentionally avoids `apiinfo.version` with auth header because Zabbix rejects that method when authenticated.

## Release flow

Typical release flow for `nks-hub` npm MCP repos:

```bash
npm version patch
git push origin master --tags
```

GitHub Actions can then build, attach a release, and publish to npm when `NPM_TOKEN` is configured in repository secrets.

## Support

- Issues: https://github.com/nks-hub/zabbix-mcp/issues
- npm: https://www.npmjs.com/package/@nks-hub/zabbix-mcp
- Contact: dev@nks-hub.cz

## License

MIT
