import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { connect } from './helpers.js';

// Read package.json directly so the test doesn't trust the server's own VERSION.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

describe('createServer', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('completes the MCP handshake and reports its name and version', async () => {
    client = await connect();
    expect(client.getServerVersion()).toEqual({ name: 'openlint-mcp', version: pkg.version });
  });

  it('registers read-only tools', async () => {
    client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(['lint_document', 'list_rulesets', 'validate_ruleset']);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('marks lint_document as open-world when external refs are allowed', async () => {
    client = await connect(undefined, true);
    const { tools } = await client.listTools();
    const openWorld = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations?.openWorldHint]));
    expect(openWorld).toEqual({ lint_document: true, list_rulesets: false, validate_ruleset: false });
    expect(tools.find(tool => tool.name === 'lint_document')?.description).toMatch(/are followed/);
  });
});
