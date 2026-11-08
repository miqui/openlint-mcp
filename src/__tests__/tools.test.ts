import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { RulesetService } from '../rulesets/service.js';
import { connect } from './helpers.js';

const ORG = fileURLToPath(new URL('./__fixtures__/org/.openlint.yaml', import.meta.url));

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
});

/** Calls a tool and checks that its text content matches its structured content. */
async function call(name: string, args?: Record<string, unknown>) {
  const result = await client!.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  expect(JSON.parse(first!.text)).toEqual(result.structuredContent);
  return result;
}

describe('list_rulesets', () => {
  it('lists the fallback rulesets', async () => {
    client = await connect();
    const { structuredContent } = await call('list_rulesets');
    expect((structuredContent as { rulesets: { name: string }[] }).rulesets.map(info => info.name)).toEqual([
      'oas',
      'asyncapi',
      'arazzo',
    ]);
  });

  it('lists configured rulesets', async () => {
    client = await connect(await RulesetService.fromConfig([{ name: 'org', path: ORG, isDefault: true }]));
    expect((await call('list_rulesets')).structuredContent).toEqual({
      rulesets: [{ name: 'org', source: path.resolve(ORG), isDefault: true, ruleCount: 1, formats: ['OpenAPI 3.x'] }],
    });
  });
});

describe('validate_ruleset', () => {
  it('reports a valid ruleset', async () => {
    client = await connect();
    const result = await call('validate_ruleset', { content: 'extends: [oas]\nrules:\n  info-contact: off\n' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('reports errors with their path', async () => {
    client = await connect();
    const result = await call('validate_ruleset', {
      content: 'rules:\n  r: { given: $, severity: loud, then: { function: truthy } }\n',
    });
    expect(result.structuredContent).toMatchObject({ valid: false, errors: [{ path: ['rules', 'r', 'severity'] }] });
  });

  it('rejects calls without content', async () => {
    client = await connect();
    const result = await client.callTool({ name: 'validate_ruleset', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
