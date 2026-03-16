import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  ZABBIX_URL: process.env.ZABBIX_URL,
  ZABBIX_API_TOKEN: process.env.ZABBIX_API_TOKEN,
};

if (!env.ZABBIX_URL || !env.ZABBIX_API_TOKEN) {
  console.error('Missing ZABBIX_URL or ZABBIX_API_TOKEN');
  process.exit(1);
}

const child = spawn('node', ['build/index.js'], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

const req = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'stdio-test', version: '0.1.0' }
  }
};

const message = JSON.stringify(req);
const frame = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
child.stdin.write(frame);

let stdout = Buffer.alloc(0);
child.stdout.on('data', (d) => {
  stdout = Buffer.concat([stdout, d]);
  const text = stdout.toString('utf8');
  if (text.includes('"result"') && text.includes('protocolVersion')) {
    console.log('OK initialize response received');
    child.kill('SIGTERM');
  }
});

setTimeout(() => {
  if (!stdout.length) {
    console.error('No stdout response from MCP server');
    console.error(stderr);
    child.kill('SIGKILL');
    process.exit(1);
  }
}, 5000);
