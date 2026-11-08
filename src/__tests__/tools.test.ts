import fs from 'node:fs';
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

describe('lint_document', () => {
  const oas30 = fs.readFileSync(new URL('./__fixtures__/documents/oas3.0.yaml', import.meta.url), 'utf8');

  it('returns grouped diagnostics that match the output schema', async () => {
    client = await connect();
    const { structuredContent, isError } = await call('lint_document', { content: oas30 });
    expect(isError).toBeFalsy();
    expect(structuredContent).toMatchObject({
      formats: ['OpenAPI 3.x', 'OpenAPI 3.0.x'],
      counts: { error: 0, warn: 11, info: 0, hint: 0 },
      truncated: false,
      notes: [],
    });
    expect((structuredContent as { diagnostics: { code: string; count: number }[] }).diagnostics[2]).toMatchObject({
      code: 'operation-description',
      count: 3,
    });
  });

  it('returns flat diagnostics with groupBy "none"', async () => {
    client = await connect();
    const { structuredContent } = await call('lint_document', { content: oas30, groupBy: 'none', limit: 3 });
    expect(structuredContent).toMatchObject({
      truncated: true,
      diagnostics: [{ code: 'info-contact', path: ['info'] }, {}, {}],
    });
  });

  it('lints with a named or inline ruleset', async () => {
    client = await connect();
    const named = await call('lint_document', { content: oas30, ruleset: 'asyncapi' });
    expect(named.structuredContent).toMatchObject({ formats: [], diagnostics: [{ code: 'unrecognized-format' }] });
    const inline = await call('lint_document', {
      content: oas30,
      ruleset:
        'formats: [oas3.0]\nrules:\n  need-contact:\n    given: $.info\n    severity: error\n    then: { field: contact, function: truthy }\n',
    });
    expect(inline.structuredContent).toMatchObject({
      counts: { error: 1 },
      diagnostics: [{ code: 'need-contact', severity: 'error' }],
    });
  });

  it("returns an error for rulesets it can't use", async () => {
    client = await connect();
    for (const [ruleset, message] of [
      ['nope', /Unknown ruleset "nope"/],
      ['overrides:\n  - files: ["**"]\n    rules: {}\n', /can't use overrides/],
      ['extends: [./local.yaml]\n', /can't extend/],
    ] as const) {
      const result = await client.callTool({ name: 'lint_document', arguments: { content: oas30, ruleset } });
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0]?.text).toMatch(message);
    }
  });

  it('rejects file names with directories', async () => {
    client = await connect();
    for (const filename of ['../openapi.yaml', 'specs/openapi.yaml', '..', 'C:\\openapi.yaml']) {
      const result = await client.callTool({ name: 'lint_document', arguments: { content: oas30, filename } });
      expect(result.isError).toBe(true);
    }
  });
});
