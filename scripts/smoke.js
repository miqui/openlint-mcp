// Smoke test for the built server: starts dist/index.js over stdio with a real MCP client, the way
// MCP clients launch it, and calls its tools. This exercises the built ESM imports of the CommonJS
// @openlint/* packages, which Vitest's transforms would hide.
//
// OPENLINT_MCP_SERVER=/path/to/openlint-mcp runs an installed command instead of dist/index.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const installed = process.env['OPENLINT_MCP_SERVER'];
const command = installed ?? process.execPath;
const baseArgs = installed === undefined ? [fileURLToPath(new URL('../dist/index.js', import.meta.url))] : [];
const document = readFileSync(new URL('../src/__tests__/__fixtures__/documents/oas3.0.yaml', import.meta.url), 'utf8');
const inlineRuleset =
  'formats: [oas3.0]\nrules:\n  need-contact:\n    given: $.info\n    severity: error\n    then: { field: contact, function: truthy }\n';

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok: ${message}`);
}

async function withServer(args, run) {
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command, args: [...baseArgs, ...args] }));
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

await withServer([], async client => {
  const info = client.getServerVersion();
  check(info?.name === 'openlint-mcp' && info.version === version, `serverInfo is openlint-mcp@${version}`);

  const { structuredContent: listed } = await client.callTool({ name: 'list_rulesets', arguments: {} });
  check(listed?.rulesets?.length === 3, 'list_rulesets returns the three fallback rulesets');

  const { structuredContent: validated } = await client.callTool({
    name: 'validate_ruleset',
    arguments: { content: 'extends: [oas]\nformats: [oas3.1]\nrules:\n  info-contact: off\n' },
  });
  check(validated?.valid === true, 'validate_ruleset builds an inline ruleset from dist');

  const { structuredContent: linted } = await client.callTool({
    name: 'lint_document',
    arguments: { content: document },
  });
  check(
    linted?.formats?.includes('OpenAPI 3.0.x') && linted.counts.warn > 0,
    'lint_document lints with the default rulesets',
  );

  const { structuredContent: inline } = await client.callTool({
    name: 'lint_document',
    arguments: { content: document, ruleset: inlineRuleset },
  });
  check(inline?.diagnostics?.[0]?.code === 'need-contact', 'lint_document lints with an inline ruleset');

  const { structuredContent: rules } = await client.callTool({ name: 'list_rules', arguments: { format: 'swagger' } });
  check(
    rules?.rules?.some(rule => rule.name === 'oas2-api-host'),
    'list_rules filters by format',
  );

  const { structuredContent: rule } = await client.callTool({
    name: 'explain_rule',
    arguments: { rule: 'operation-tags' },
  });
  check(rule?.given?.[0] === '#OperationObject', 'explain_rule explains a rule');
});

await withServer(['--allow-external-refs'], async client => {
  const { structuredContent: linted } = await client.callTool({
    name: 'lint_document',
    arguments: { content: document },
  });
  check(linted?.counts?.warn > 0 && linted.notes.length === 0, 'lint_document runs with --allow-external-refs');
});
