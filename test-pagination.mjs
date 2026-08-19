// Regression harness for issue #1: the Zabbix API has no `offset` parameter.
// Verifies every paginated tool works and that page 2 is not a repeat of page 1.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = { ...process.env };
if (!env.ZABBIX_URL || !env.ZABBIX_API_TOKEN) {
  console.error('Missing ZABBIX_URL or ZABBIX_API_TOKEN');
  process.exit(1);
}

const transport = new StdioClientTransport({ command: 'node', args: ['build/index.js'], env });
const client = new Client({ name: 'zabbix-mcp-pagination', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

let failed = 0;
const ok = (label, extra = '') => console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`);
const bad = (label, why) => { failed++; console.log(`  FAIL  ${label} — ${why}`); };

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.map((c) => c.text).join('\n') ?? '';
  return { isError: !!r.isError, text, structured: r.structuredContent };
}

function idsOf(res, key) {
  const rows = res.structured?.data ?? [];
  return rows.map((row) => String(row?.[key] ?? JSON.stringify(row)));
}

// 1. every paginated tool must return page 1 without an API error
const page1 = [
  ['zabbix_list_host_groups', {}, 'groupid'],
  ['zabbix_list_hosts', {}, 'hostid'],
  ['zabbix_list_triggers', {}, 'triggerid'],
  ['zabbix_list_problems', {}, 'eventid'],
  ['zabbix_list_events', {}, 'eventid'],
];
for (const [name, args, key] of page1) {
  const res = await call(name, { ...args, pageSize: 3 });
  if (res.isError) bad(`${name} page 1`, res.text.slice(0, 160));
  else ok(`${name} page 1`, `${idsOf(res, key).length} rows`);
  if (/unexpected parameter "offset"/.test(res.text)) bad(`${name} page 1`, 'offset still sent');
}

// 2. items needs a host; take the first one we can find
const hostsRes = await call('zabbix_list_hosts', { pageSize: 1 });
const hostId = hostsRes.structured?.data?.[0]?.hostid;
if (!hostId) bad('zabbix_list_items page 1', 'no host available to query items for');
else {
  const res = await call('zabbix_list_items', { hostIds: [hostId], pageSize: 3 });
  if (res.isError) bad('zabbix_list_items page 1', res.text.slice(0, 160));
  else ok('zabbix_list_items page 1', `${idsOf(res, 'itemid').length} rows`);
}

// 3. page 2 must not repeat page 1 (the silent-ignore bug)
const paged = [
  ['zabbix_list_host_groups', {}, 'groupid'],
  ['zabbix_list_hosts', {}, 'hostid'],
  ['zabbix_list_triggers', {}, 'triggerid'],
];
for (const [name, args, key] of paged) {
  const p1 = await call(name, { ...args, pageSize: 2, page: 1 });
  const p2 = await call(name, { ...args, pageSize: 2, page: 2 });
  if (p1.isError || p2.isError) { bad(`${name} page 2`, (p1.text || p2.text).slice(0, 160)); continue; }
  const a = idsOf(p1, key), b = idsOf(p2, key);
  if (!a.length) { console.log(`  SKIP  ${name} page 2 — no data`); continue; }
  if (!b.length) { console.log(`  SKIP  ${name} page 2 — only one page of data`); continue; }
  if (a.join(',') === b.join(',')) bad(`${name} page 2`, `identical to page 1 (${a.join(',')})`);
  else ok(`${name} page 2`, `[${a.join(',')}] then [${b.join(',')}]`);
}
if (hostId) {
  const p1 = await call('zabbix_list_items', { hostIds: [hostId], pageSize: 2, page: 1 });
  const p2 = await call('zabbix_list_items', { hostIds: [hostId], pageSize: 2, page: 2 });
  const a = idsOf(p1, 'itemid'), b = idsOf(p2, 'itemid');
  if (p1.isError || p2.isError) bad('zabbix_list_items page 2', (p1.text || p2.text).slice(0, 160));
  else if (!b.length) console.log('  SKIP  zabbix_list_items page 2 — only one page of data');
  else if (a.join(',') === b.join(',')) bad('zabbix_list_items page 2', 'identical to page 1');
  else ok('zabbix_list_items page 2', `[${a.join(',')}] then [${b.join(',')}]`);
}

// 4. unbounded methods still refuse page 2 with the cursor hint instead of a raw API error
for (const name of ['zabbix_list_problems', 'zabbix_list_events']) {
  const res = await call(name, { pageSize: 2, page: 2 });
  if (res.isError && /cursor-style continuation/.test(res.text)) ok(`${name} page 2`, 'cursor hint');
  else bad(`${name} page 2`, `expected cursor hint, got: ${res.text.slice(0, 160)}`);
}

await client.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
