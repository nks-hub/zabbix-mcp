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

const client = new Client({ name: 'zabbix-mcp-v040', version: '0.4.0' }, { capabilities: {} });
await client.connect(transport);

function parseEnvelope(result) {
  const text = result.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let failed = 0;
function assert(cond, label, ctx) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    if (ctx) console.error('        ctx:', JSON.stringify(ctx).slice(0, 200));
    failed++;
  }
}

// ----- Fix #3: lastSeen + query echo on list_problems -----
console.log('\n[fix #3] zabbix_list_problems → lastSeen + query echo');
{
  const r = await client.callTool({
    name: 'zabbix_list_problems',
    arguments: { pageSize: 3 },
  });
  const env = parseEnvelope(r);
  assert(env != null, 'envelope parsed as JSON');
  assert(Array.isArray(env?.data), 'envelope.data is array');
  assert(typeof env?.pagination === 'object', 'envelope.pagination exists');
  assert(env?.pagination?.pageSize === 3, 'pagination.pageSize echoed');
  if (env?.data?.length > 0) {
    assert(env.lastSeen && typeof env.lastSeen === 'object', 'lastSeen present when data non-empty');
    assert('eventid' in (env.lastSeen ?? {}), 'lastSeen.eventid present', env.lastSeen);
  } else {
    console.log('  SKIP  lastSeen check (no problems in instance)');
  }
}

// ----- Fix #3: lastSeen on list_hosts -----
console.log('\n[fix #3] zabbix_list_hosts → lastSeen has hostid');
{
  const r = await client.callTool({
    name: 'zabbix_list_hosts',
    arguments: { pageSize: 3 },
  });
  const env = parseEnvelope(r);
  assert(Array.isArray(env?.data), 'envelope.data is array');
  if (env?.data?.length > 0) {
    assert('hostid' in (env.lastSeen ?? {}), 'lastSeen.hostid present', env.lastSeen);
  }
}

// ----- Fix #2: truncation envelope on large page -----
console.log('\n[fix #2] zabbix_list_hosts → truncation envelope shape');
{
  const r = await client.callTool({
    name: 'zabbix_list_hosts',
    arguments: { pageSize: 500 },
  });
  const env = parseEnvelope(r);
  assert(env != null, 'large response still parses as JSON envelope (not raw slice)');
  assert(Array.isArray(env?.data), 'envelope.data is array even when truncated');
  assert(typeof env?.pagination === 'object', 'pagination present even when truncated');
  if (env?.pagination?.truncated) {
    console.log(`        truncated=true, kept ${env.pagination.returned}, dropped ${env.pagination.droppedCount}`);
    assert(typeof env.pagination.hint === 'string', 'pagination.hint provided when truncated');
    assert(typeof env.pagination.droppedCount === 'number', 'pagination.droppedCount is number');
  } else {
    console.log('        not truncated (response under 25K)');
  }
}

// ----- Fix #1: zabbix_get_item_history auto-resolves historyType -----
console.log('\n[fix #1] zabbix_get_item_history without historyType → auto-resolve');
{
  // Find any item first
  const listResp = await client.callTool({
    name: 'zabbix_list_items',
    arguments: { pageSize: 5, keySearch: 'system.cpu' },
  });
  const listEnv = parseEnvelope(listResp);
  const item = listEnv?.data?.[0];
  assert(item != null, 'found at least one item for history test');
  if (item) {
    const itemId = item.itemid;
    const expectedHt = ['float', 'string', 'log', 'uint', 'text', 'binary'][Number(item.value_type)];
    console.log(`        using itemId=${itemId} (value_type=${item.value_type} → expected ${expectedHt})`);

    // Call without historyType
    const histResp = await client.callTool({
      name: 'zabbix_get_item_history',
      arguments: { itemId, pageSize: 3 },
    });
    const histEnv = parseEnvelope(histResp);
    assert(histEnv != null, 'auto-resolved history call returned envelope');
    assert(!histResp.isError, 'auto-resolved call did not error', histResp);
    assert(histEnv?.query?.historyType === expectedHt, `query.historyType echoes ${expectedHt}`, histEnv?.query);
    assert(histEnv?.query?.autoResolvedHistoryType === true, 'query.autoResolvedHistoryType=true');
  }
}

// ----- Fix #1: zabbix_get_item_history with invalid itemId returns actionable error -----
console.log('\n[fix #1] zabbix_get_item_history with bogus itemId → actionable error');
{
  const r = await client.callTool({
    name: 'zabbix_get_item_history',
    arguments: { itemId: '999999999999' },
  });
  assert(r.isError === true, 'bogus itemId returns isError=true');
  const txt = r.content?.[0]?.text ?? '';
  assert(/Item .* not found/.test(txt) || /historyType/.test(txt), 'error mentions item or historyType', txt);
}

await client.close();

console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
