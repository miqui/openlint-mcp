import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { rulesetForDocument } from '../lint.js';
import { explainRule, listRules, type RuleSummary } from '../rules.js';
import { RulesetService } from '../rulesets/service.js';
import { rulesetOf } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const configured = (file: string) =>
  RulesetService.fromConfig([{ name: 'default', path: path.join(FIXTURES, file), isDefault: true }]);

const fallback = RulesetService.fallback();
const defaultRuleset = rulesetOf(fallback.resolve());

function namesFor(format?: string, enabledOnly?: boolean): string[] {
  const listed = listRules(defaultRuleset, { format, enabledOnly });
  if (!listed.ok) throw new Error(listed.message);
  return listed.rules.map(rule => rule.name);
}

describe('listRules', () => {
  it('lists the enabled rules, sorted by name', () => {
    const listed = listRules(defaultRuleset);
    if (!listed.ok) throw new Error(listed.message);
    expect(listed.rules).toHaveLength(46 + 47 + 22);
    expect(listed.rules.every(rule => rule.enabled)).toBe(true);
    const names = listed.rules.map(rule => rule.name);
    expect(names).toEqual([...names].sort());
    expect(listed.rules.find(rule => rule.name === 'operation-tags')).toEqual<RuleSummary>({
      name: 'operation-tags',
      severity: 'warn',
      enabled: true,
      recommended: true,
      formats: ['OpenAPI 2.0 (Swagger)', 'OpenAPI 3.x', 'OpenAPI 3.0.x', 'OpenAPI 3.1.x', 'OpenAPI 3.2.x'],
      description: 'Operation must have non-empty "tags" array.',
    });
  });

  it('includes disabled rules with enabledOnly false', () => {
    const all = namesFor(undefined, false);
    expect(all).toHaveLength(57 + 55 + 22);
    const listed = listRules(defaultRuleset, { enabledOnly: false });
    if (!listed.ok) throw new Error(listed.message);
    expect(listed.rules.some(rule => !rule.enabled)).toBe(true);
  });

  it('keeps the rules for a format and its family', () => {
    const oas31 = namesFor('oas3.1');
    expect(oas31).toContain('oas3-schema');
    expect(oas31).toContain('operation-tags');
    expect(oas31).not.toContain('oas2-api-host');
    expect(oas31.some(name => name.startsWith('asyncapi'))).toBe(false);
    expect(namesFor('OpenAPI 3.1')).toEqual(oas31);
    expect(namesFor('openapi3.1')).toEqual(oas31);

    const swagger = namesFor('swagger');
    expect(swagger).toContain('oas2-api-host');
    expect(swagger).not.toContain('oas3-api-servers');
    expect(namesFor('oas2')).toEqual(swagger);

    // Broader formats include rules for narrower ones: oas3 covers rules declared for oas3.1 only.
    expect(new Set(namesFor('oas3'))).toEqual(new Set([...namesFor('oas3'), ...oas31]));

    expect(namesFor('asyncapi3').every(name => name.startsWith('asyncapi'))).toBe(true);
    expect(namesFor('arazzo1.0').every(name => name.startsWith('arazzo'))).toBe(true);
  });

  it('reports unknown formats', () => {
    expect(listRules(defaultRuleset, { format: 'bogus' })).toEqual({
      ok: false,
      message: expect.stringMatching(/^Unknown format "bogus"/),
    });
  });
});

describe('explainRule', () => {
  it('explains a rule', () => {
    expect(explainRule(defaultRuleset, 'operation-tags')).toEqual({
      ok: true,
      rule: {
        name: 'operation-tags',
        severity: 'warn',
        enabled: true,
        recommended: true,
        formats: expect.arrayContaining(['OpenAPI 3.x']),
        description: 'Operation must have non-empty "tags" array.',
        message: null,
        given: ['#OperationObject'],
        then: [
          {
            function: 'schema',
            field: 'tags',
            functionOptions: { dialect: 'draft7', schema: { type: 'array', minItems: 1 } },
          },
        ],
        documentationUrl: 'https://docs.openlint.org/reference/openapi-rules#operation-tags',
        extensions: null,
      },
    });
  });

  it('leaves out large function options', () => {
    const explained = explainRule(defaultRuleset, 'oas3-schema');
    if (!explained.ok) throw new Error(explained.message);
    expect(explained.rule.then.every(then => !('functionOptions' in then))).toBe(true);
  });

  it('returns extensions as the ruleset wrote them', () => {
    const inline = rulesetOf(
      fallback.resolve(
        'rules:\n  need-title:\n    given: $.info\n    then: { field: title, function: truthy }\n    extensions:\n      prompt: Add a short title to info.\n      owner: { team: api }\n',
      ),
    );
    const explained = explainRule(inline, 'need-title');
    expect(explained).toMatchObject({
      ok: true,
      rule: { extensions: { prompt: 'Add a short title to info.', owner: { team: 'api' } } },
    });
  });

  it('reports turned-off rules as off', () => {
    const inline = rulesetOf(fallback.resolve('extends: [oas]\nrules:\n  info-contact: off\n'));
    expect(explainRule(inline, 'info-contact')).toMatchObject({ ok: true, rule: { severity: 'off', enabled: false } });
  });

  it('suggests similar names for unknown rules', () => {
    const explained = explainRule(defaultRuleset, 'operation-tag');
    expect(explained).toEqual({ ok: false, message: expect.stringContaining('"operation-tags"') });
    expect(explainRule(defaultRuleset, 'constructor')).toMatchObject({ ok: false });
  });
});

describe('rules for a document name', () => {
  it("includes the rules the ruleset's overrides apply to that name", async () => {
    const service = await configured('org-overrides/.openlint.yaml');
    const names = (filename?: string) => {
      const listed = listRules(rulesetForDocument(rulesetOf(service.resolve()), filename));
      if (!listed.ok) throw new Error(listed.message);
      return listed.rules.map(rule => rule.name);
    };
    expect(names()).toEqual(['info-description-required']);
    expect(names('openapi.json')).toEqual(['info-description-required', 'json-only-title']);
    expect(names('legacy.yaml')).toEqual([]);
    const legacy = explainRule(
      rulesetForDocument(rulesetOf(service.resolve()), 'legacy.yaml'),
      'info-description-required',
    );
    expect(legacy).toMatchObject({ ok: true, rule: { severity: 'off', enabled: false } });
  });
});

describe('custom functions', () => {
  it('are named as the ruleset registered them', async () => {
    const service = await configured('org-named/.openlint.yaml');
    const ruleset = rulesetOf(service.resolve());
    expect(explainRule(ruleset, 'org-title', service.functionName)).toMatchObject({
      ok: true,
      rule: { then: [{ function: 'requireTitle' }] },
    });
    // Without the registered names, the implementation's own name is all there is.
    expect(explainRule(ruleset, 'org-title')).toMatchObject({ ok: true, rule: { then: [{ function: 'checkTitle' }] } });
  });

  it("leave out options that can't be serialized", async () => {
    const service = await configured('org/options.mjs');
    const ruleset = rulesetOf(service.resolve());
    for (const name of ['bigint-options', 'circular-options']) {
      expect(explainRule(ruleset, name, service.functionName)).toMatchObject({
        ok: true,
        rule: { then: [{ function: 'hasTitle' }] },
      });
      const explained = explainRule(ruleset, name);
      if (!explained.ok) throw new Error(explained.message);
      expect('functionOptions' in explained.rule.then[0]!).toBe(false);
    }
  });
});
