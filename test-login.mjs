import { ZabbixClient, normalizeZabbixUrl } from './build/client.js';

const url = process.env.ZABBIX_URL;
const username = process.env.ZABBIX_USERNAME;
const password = process.env.ZABBIX_PASSWORD;

if (!url || !username || !password) {
  console.error('Missing ZABBIX_URL or login credentials');
  process.exit(1);
}

const client = new ZabbixClient({ url: normalizeZabbixUrl(url), username, password });
const hosts = await client.call('host.get', { output: ['hostid', 'host', 'name'], limit: 2 });
console.log('OK login host.get:', hosts.length);
