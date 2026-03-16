# @nks-hub/zabbix-mcp

[![Build Status](https://github.com/nks-hub/zabbix-mcp/actions/workflows/build.yml/badge.svg)](https://github.com/nks-hub/zabbix-mcp/actions)
[![npm version](https://img.shields.io/npm/v/@nks-hub/zabbix-mcp.svg)](https://www.npmjs.com/package/@nks-hub/zabbix-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27+-8b5cf6.svg)](https://modelcontextprotocol.io/)

> MCP server for Zabbix monitoring — query hosts, problems, triggers, events, items, and history directly from Claude Code, OpenClaw, or any MCP-compatible client.

---

## Why?

Instead of manually clicking through the Zabbix UI, let your AI assistant inspect monitoring state directly:

- "What broke today on our servers?"
- "Show me active high-severity problems in the last 24 hours"
- "Which host has this trigger and what metric caused it?"
- "List all PVE-related alerts and acknowledge the maintenance window"
- "Give me item history for this metric before and after the incident"

---

## Quick Start

### Installation

```bash
npm install -g @nks-hub/zabbix-mcp
```

Or clone and build:

```bash
git clone https://github.com/nks-hub/zabbix-mcp.git
cd zabbix-mcp
npm install && npm run build
```

### Configuration

Add to your `~/.claude/settings.json` or project `.claude/settings.json`:

#### API token auth (recommended)

```json
{
  "mcpServers": {
    "zabbix": {
      "command": "npx",
      "args": ["-y", "@nks-hub/zabbix-mcp"],
      "env": {
        "ZABBIX_URL": "https://monitor.example.com/api_jsonrpc.php",
        "ZABBIX_API_TOKEN": "your-zabbix-api-token"
      }
    }
  }
}
```

#### Username + password auth

```json
{
  "mcpServers": {
    "zabbix": {
      "command": "npx",
      "args": ["-y", "@nks-hub/zabbix-mcp"],
      "env": {
        "ZABBIX_URL": "https://monitor.example.com/api_jsonrpc.php",
        "ZABBIX_USERNAME": "Admin",
        "ZABBIX_PASSWORD": "your-password"
      }
    }
  }
}
```

### Usage

Ask your MCP client anything about Zabbix state. The tools become available automatically.

---

## Features

| Feature | Description |
|---------|-------------|
| **11 Monitoring Tools** | Coverage for host groups, hosts, problems, events, triggers, items, metric history, and acknowledgements |
| **Flexible Auth** | API token (recommended) or username/password login |
| **Incident-Focused** | Optimized for "what broke today?" workflows and infra triage |
| **History Access** | Query raw item history for root-cause analysis |
| **Operational Actions** | Acknowledge events, add messages, suppress, close, or change severity |
| **Response Truncation** | Auto-truncation at 25k chars to avoid context bloat |
| **Actionable Errors** | Clear error messages that help the LLM recover quickly |

---

## Authentication

Supports two authentication methods:

| Method | Environment Variables | Use Case |
|--------|----------------------|----------|
| **API Token** | `ZABBIX_API_TOKEN` | Recommended for production |
| **Username/Password** | `ZABBIX_USERNAME`, `ZABBIX_PASSWORD` | Legacy setups or quick testing |

Both require `ZABBIX_URL` pointing at your Zabbix instance.

`ZABBIX_URL` may be provided as any of these forms:

- `https://monitor.example.com/api_jsonrpc.php`
- `https://monitor.example.com/zabbix`
- `https://monitor.example.com`

The server normalizes it to the API endpoint automatically.

---

## Tools (11)

### System
| Tool | Description |
|------|-------------|
| `zabbix_health` | Connectivity smoke test for the configured Zabbix API |

### Hosts
| Tool | Description |
|------|-------------|
| `zabbix_list_host_groups` | Discover host groups |
| `zabbix_list_hosts` | List monitored hosts with filtering |
| `zabbix_get_host` | Full host detail including interfaces, groups, macros, and inventory |

### Problems & Events
| Tool | Description |
|------|-------------|
| `zabbix_list_problems` | Current/recent problem events with time, severity, and ack filters |
| `zabbix_list_events` | Trigger event timeline/history |
| `zabbix_acknowledge_event` | Acknowledge, annotate, close, suppress, or change event severity |

### Triggers
| Tool | Description |
|------|-------------|
| `zabbix_list_triggers` | List triggers by host/group/problem state |
| `zabbix_get_trigger` | Full trigger detail with hosts, items, tags, and dependencies |

### Items & Metrics
| Tool | Description |
|------|-------------|
| `zabbix_list_items` | Discover item IDs, keys, state, and last value |
| `zabbix_get_item_history` | Fetch raw metric history for a specific item |

---

## Common Workflows

### 1. Daily incident analysis
1. `zabbix_list_host_groups`
2. `zabbix_list_hosts`
3. `zabbix_list_problems` with `since`
4. `zabbix_get_trigger` or `zabbix_get_host`
5. `zabbix_list_items` + `zabbix_get_item_history`

### 2. Acknowledge a maintenance-related alert
1. `zabbix_list_problems`
2. `zabbix_acknowledge_event` with `acknowledge=true` and `message`

### 3. Validate a suspicious metric spike
1. `zabbix_list_items`
2. inspect `value_type`
3. `zabbix_get_item_history`

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Type check / build check
npm run check

# Package preview
npm pack
```

### Live smoke tests

Token-based:

```bash
ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php" \
ZABBIX_API_TOKEN="your-token" \
node test-live.mjs
```

Login-based:

```bash
ZABBIX_URL="https://monitor.example.com/api_jsonrpc.php" \
ZABBIX_USERNAME="Admin" \
ZABBIX_PASSWORD="your-password" \
node test-login.mjs
```

---

## Requirements

- **Node.js**: 18+
- **Zabbix**: API-enabled instance (token or user auth)

---

## Contributing

Contributions are welcome! For larger changes, open an issue first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: description'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- 📧 **Email:** dev@nks-hub.cz
- 🐛 **Bug reports:** [GitHub Issues](https://github.com/nks-hub/zabbix-mcp/issues)
- 📖 **MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io/)

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Links

- [Zabbix](https://www.zabbix.com/)
- [npm Package](https://www.npmjs.com/package/@nks-hub/zabbix-mcp)
- [@nks-hub/rybbit-mcp](https://github.com/nks-hub/rybbit-mcp) — analytics MCP server

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/nks-hub">NKS Hub</a>
</p>
