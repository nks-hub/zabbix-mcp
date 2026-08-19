// Cross-version compatibility sweep: every tool, against whatever Zabbix ZABBIX_URL points at.
// Set PROBE_ACK=1 to also exercise zabbix_acknowledge_event - it writes a comment onto a real
// event, so leave it unset against anything you care about.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const t = new StdioClientTransport({ command: 'node', args: ['build/index.js'], env: process.env });
const c = new Client({ name: 'zabbix-mcp-compat', version: '1.0.0' }, { capabilities: {} });
await c.connect(t);

let failed = 0;
const call = async (n, a = {}) => {
  try {
    const r = await c.callTool({ name: n, arguments: a });
    return { err: !!r.isError, text: (r.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 120), s: r.structuredContent };
  } catch (e) { return { err: true, text: String(e).replace(/\s+/g, ' ').slice(0, 160) }; }
};
const check = (label, okCond, detail) => {
  if (okCond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else { failed++; console.log(`  FAIL  ${label} - ${detail}`); }
};
const probe = async (label, name, args) => { const r = await call(name, args); check(label, !r.err, r.text); return r; };

const tools = (await c.listTools()).tools;
check('listTools', tools.length === 11, `${tools.length} tools`);

const health = await probe('zabbix_health', 'zabbix_health');
const version = health.s?.version ?? '?';
console.log(`        server reports Zabbix ${version}`);

await probe('zabbix_list_host_groups', 'zabbix_list_host_groups', { pageSize: 2 });
const hosts = await probe('zabbix_list_hosts', 'zabbix_list_hosts', { pageSize: 1 });
const host = hosts.s?.data?.[0] ?? {};
check('host.get returns group data', !!(host.groups || host.hostgroups),
  `keys: ${Object.keys(host).join(',')}`);
check('host.get returns interfaces', !!host.interfaces, `keys: ${Object.keys(host).join(',')}`);

const hostId = host.hostid;
if (hostId) {
  const gh = await probe('zabbix_get_host', 'zabbix_get_host', { hostId });
  check('zabbix_get_host structured has data', !!gh.s?.data?.hostid, JSON.stringify(Object.keys(gh.s ?? {})));
}
const trg = await probe('zabbix_list_triggers', 'zabbix_list_triggers', { pageSize: 1 });
const triggerId = trg.s?.data?.[0]?.triggerid;
if (triggerId) {
  const gt = await probe('zabbix_get_trigger', 'zabbix_get_trigger', { triggerId });
  check('zabbix_get_trigger structured has data', !!gt.s?.data?.triggerid, JSON.stringify(Object.keys(gt.s ?? {})));
}
await probe('zabbix_list_problems', 'zabbix_list_problems', { pageSize: 1 });
const events = await probe('zabbix_list_events', 'zabbix_list_events', { pageSize: 1 });
const items = hostId ? await probe('zabbix_list_items', 'zabbix_list_items', { hostIds: [hostId], pageSize: 1 }) : null;
const itemId = items?.s?.data?.[0]?.itemid;
if (itemId) await probe('zabbix_get_item_history', 'zabbix_get_item_history', { itemId, limit: 2 });

const evId = events.s?.data?.[0]?.eventid;
if (!evId) console.log('  SKIP  zabbix_acknowledge_event - no event to write to');
else if (!process.env.PROBE_ACK) console.log('  SKIP  zabbix_acknowledge_event - PROBE_ACK unset (it comments on a real event)');
else await probe('zabbix_acknowledge_event', 'zabbix_acknowledge_event', { eventIds: [evId], message: 'zabbix-mcp compat probe' });

await c.close();
console.log(failed ? `\n${failed} check(s) FAILED on Zabbix ${version}` : `\nall checks passed on Zabbix ${version}`);
process.exit(failed ? 1 : 0);
