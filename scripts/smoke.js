// Smoke test for the built server: starts dist/index.js over stdio with a real MCP client, the way
// MCP clients launch it, and checks the handshake and a tool call that bundles an inline ruleset.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok: ${message}`);
}

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  }),
);

try {
  const info = client.getServerVersion();
  check(info?.name === 'openlint-mcp' && info.version === version, `serverInfo is openlint-mcp@${version}`);

  const { structuredContent: listed } = await client.callTool({ name: 'list_rulesets', arguments: {} });
  check(listed?.rulesets?.length === 3, 'list_rulesets returns the three fallback rulesets');

  const { structuredContent: validated } = await client.callTool({
    name: 'validate_ruleset',
    arguments: { content: 'extends: [oas]\nformats: [oas3.1]\nrules:\n  info-contact: off\n' },
  });
  check(validated?.valid === true, 'validate_ruleset builds an inline ruleset from dist');
} finally {
  await client.close();
}
