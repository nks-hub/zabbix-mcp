import { ZabbixClient, normalizeZabbixUrl } from './build/client.js';

const url = process.env.ZABBIX_URL;
const apiToken = process.env.ZABBIX_API_TOKEN;

if (!url || !apiToken) {
  console.error('Missing ZABBIX_URL or ZABBIX_API_TOKEN');
  process.exit(1);
}

const client = new ZabbixClient({ url: normalizeZabbixUrl(url), apiToken });

const checks = [
  ['hostgroup.get', { output: ['groupid', 'name'], limit: 3 }],
  ['host.get', { output: ['hostid', 'host', 'name', 'status'], limit: 3 }],
  ['problem.get', { output: 'extend', limit: 3, sortfield: ['eventid'], sortorder: 'DESC' }],
  ['trigger.get', { output: 'extend', limit: 3, sortfield: ['priority'], sortorder: 'DESC' }],
  ['item.get', { output: ['itemid', 'name', 'key_', 'value_type'], limit: 3 }],
];

for (const [method, params] of checks) {
  const result = await client.call(method, params);
  console.log(`OK ${method}:`, Array.isArray(result) ? result.length : typeof result);
}
