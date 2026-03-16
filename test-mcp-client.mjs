import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = {
  ...process.env,
  ZABBIX_URL: process.env.ZABBIX_URL,
  ZABBIX_API_TOKEN: process.env.ZABBIX_API_TOKEN,
};

if (!env.ZABBIX_URL || !env.ZABBIX_API_TOKEN) {
  console.error('Missing ZABBIX_URL or ZABBIX_API_TOKEN');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['build/index.js'],
  env,
});

const client = new Client({ name: 'zabbix-mcp-e2e', version: '0.1.0' }, { capabilities: {} });

await client.connect(transport);
const tools = await client.listTools();
console.log('OK listTools:', tools.tools.length);
if (!tools.tools.some((t) => t.name === 'zabbix_list_problems')) {
  throw new Error('Missing expected tool zabbix_list_problems');
}
await client.close();
