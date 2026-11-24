// Regression for CodeQL js/polynomial-redos in normalizeZabbixUrl: a long run of slashes must stay linear.
// Runs against the compiled build, so `npm run build` first.
import assert from 'node:assert/strict';
import { normalizeZabbixUrl } from './build/client.js';

assert.equal(normalizeZabbixUrl(' https://zabbix.example.com/ '), 'https://zabbix.example.com/api_jsonrpc.php');
assert.equal(normalizeZabbixUrl('https://zabbix.example.com/zabbix///'), 'https://zabbix.example.com/zabbix/api_jsonrpc.php');
assert.equal(normalizeZabbixUrl('https://zabbix.example.com/api_jsonrpc.php/'), 'https://zabbix.example.com/api_jsonrpc.php');

const adversarial = ['https://zabbix.example.com' + '/'.repeat(200_000) + 'x', 'https://zabbix.example.com' + '/'.repeat(200_000)];
for (const input of adversarial) {
  const start = performance.now();
  normalizeZabbixUrl(input);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `normalizeZabbixUrl took ${ms.toFixed(0)} ms on ${input.length} chars`);
}

console.log('PASS normalizeZabbixUrl');
