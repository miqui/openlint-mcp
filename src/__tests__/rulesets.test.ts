import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RulesetLoadError, RulesetService } from '../rulesets/service.js';
import { issuesOf, lintCodes, rulesetOf } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const ORG = path.join(FIXTURES, 'org', '.openlint.yaml');
const ASYNCAPI = 'asyncapi: 3.0.0\ninfo:\n  title: Events\n  version: "1.0"\n';

const fallback = RulesetService.fallback();
let configured: RulesetService;

beforeAll(async () => {
  configured = await RulesetService.fromConfig([{ name: 'default', path: ORG, isDefault: true }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fallback rulesets', () => {
  it('lists oas, asyncapi and arazzo from the rulesets package', () => {
    const list = fallback.list();
    expect(list.map(info => info.name)).toEqual(['oas', 'asyncapi', 'arazzo']);
    for (const info of list) {
      expect(info).toMatchObject({ source: `@openlint/openlint-rulesets (${info.name})`, isDefault: true });
      expect(info.ruleCount).toBeGreaterThan(0);
    }
    expect(list[0]?.formats).toContain('OpenAPI 3.x');
    expect(list[1]?.formats).toContain('AsyncAPI 3.x');
    expect(list[2]?.formats).toEqual(['Arazzo 1.0.x']);
  });

  it('lints OpenAPI and AsyncAPI documents with the default ruleset', async () => {
    const ruleset = rulesetOf(await fallback.resolve());
    expect(await lintCodes(ruleset)).toContain('oas3-schema');
    expect((await lintCodes(ruleset, ASYNCAPI)).some(code => code.startsWith('asyncapi'))).toBe(true);
  });
});

describe('configured rulesets', () => {
  it('loads a YAML ruleset with a custom function', async () => {
    expect(configured.list()).toEqual([
      { name: 'default', source: ORG, isDefault: true, ruleCount: 1, formats: ['OpenAPI 3.x'] },
    ]);
    expect(await lintCodes(rulesetOf(await configured.resolve()))).toEqual(['org-title']);
  });

  it('reports the ruleset name and path when loading fails', async () => {
    const invalid = path.join(FIXTURES, 'invalid.yaml');
    const missing = path.join(FIXTURES, 'missing.yaml');
    await expect(RulesetService.fromConfig([{ name: 'org', path: invalid, isDefault: true }])).rejects.toThrow(
      /Failed to load ruleset "org" from .*invalid\.yaml:[\s\S]*severity/,
    );
    await expect(RulesetService.fromConfig([{ name: 'org', path: missing, isDefault: true }])).rejects.toThrow(
      RulesetLoadError,
    );
  });

  describe('outside the package directory', () => {
    // npx runs the server from its own install, so configured rulesets usually live elsewhere.
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlint-mcp-'));
      fs.cpSync(path.join(FIXTURES, 'org'), dir, { recursive: true });
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('loads a YAML ruleset with a custom function', async () => {
      const service = await RulesetService.fromConfig([
        { name: 'default', path: path.join(dir, '.openlint.yaml'), isDefault: true },
      ]);
      expect(await lintCodes(rulesetOf(await service.resolve()))).toEqual(['org-title']);
    });

    it('loads a JS ruleset that imports a package ruleset and a custom function', async () => {
      const service = await RulesetService.fromConfig([
        { name: 'default', path: path.join(dir, 'ruleset.mjs'), isDefault: true },
      ]);
      const codes = await lintCodes(rulesetOf(await service.resolve()));
      expect(codes).toContain('org-title');
      expect(codes).toContain('oas3-schema');
    });
  });
});

describe('resolve', () => {
  it('finds configured rulesets, package rulesets and aliases by name', async () => {
    expect(rulesetOf(await configured.resolve('default'))).toBe(rulesetOf(await configured.resolve()));
    for (const name of ['oas', 'spectral:oas', 'openlint:openapi', ' oas ']) {
      expect(await lintCodes(rulesetOf(await configured.resolve(name)))).toContain('oas3-schema');
    }
  });

  it('reports unknown names instead of parsing them as YAML', async () => {
    expect(issuesOf(await configured.resolve('nope'))).toEqual([
      {
        message: expect.stringMatching(/^Unknown ruleset "nope"\. Use one of default, oas, asyncapi, arazzo/),
        path: [],
      },
    ]);
  });

  it('loads anything else as an inline ruleset', async () => {
    const ruleset = rulesetOf(await configured.resolve('extends: [default]\n'));
    expect(await lintCodes(ruleset)).toEqual(['org-title']);
  });
});

describe('inline rulesets', () => {
  const needDescription =
    'rules:\n  need-description:\n    given: $.info\n    then: { field: description, function: truthy }\n';

  it('loads rules that use built-in functions, from YAML or JSON', async () => {
    expect(await lintCodes(rulesetOf(await fallback.loadInline(needDescription)))).toEqual(['need-description']);
    const json = JSON.stringify({
      rules: { r: { given: '$.info', then: { field: 'description', function: 'truthy' } } },
    });
    expect(await lintCodes(rulesetOf(await fallback.loadInline(json)))).toEqual(['r']);
  });

  it.each(['spectral:oas', 'openlint:openapi', 'oas'])(
    'extends %s, even when other rulesets are configured',
    async name => {
      const ruleset = rulesetOf(await configured.loadInline(`extends: ["${name}"]\nrules:\n  oas3-schema: off\n`));
      const codes = await lintCodes(ruleset);
      expect(codes).toContain('info-description');
      expect(codes).not.toContain('oas3-schema');
    },
  );

  it('extends a configured ruleset, keeping its custom functions', async () => {
    // Also the positive control for the readFile spies below: loading the configured ruleset's file
    // through an inline extends is a read they must see.
    const readFile = vi.spyOn(fs.promises, 'readFile');
    for (const extendsValue of ['default', '[default]', '[[default, recommended]]']) {
      const ruleset = rulesetOf(await configured.loadInline(`extends: ${extendsValue}\n${needDescription}`));
      expect((await lintCodes(ruleset)).sort()).toEqual(['need-description', 'org-title']);
    }
    expect(readFile.mock.calls.map(([file]) => (typeof file === 'string' ? path.resolve(file) : file))).toContain(ORG);
  });

  it('extends a configured JS ruleset, keeping its imports and custom functions', async () => {
    const js = await RulesetService.fromConfig([
      { name: 'js', path: path.join(FIXTURES, 'org', 'ruleset.mjs'), isDefault: true },
    ]);
    const codes = await lintCodes(rulesetOf(await js.loadInline('extends: [js]\nrules:\n  info-contact: off\n')));
    expect(codes).toContain('org-title');
    expect(codes).toContain('oas3-schema');
    expect(codes).not.toContain('info-contact');
  });

  it.each([
    ['oas3', 'OpenAPI 3.x'],
    ['oas3.1', 'OpenAPI 3.1.x'],
    ['OAS3_1', 'OpenAPI 3.1.x'],
    ['oas3.2', 'OpenAPI 3.2.x'],
    ['asyncapi2', 'AsyncAPI 2.x'],
    ['aas3', 'AsyncAPI 3.x'],
    ['arazzo1.0', 'Arazzo 1.0.x'],
    ['json-schema-draft7', 'JSON Schema Draft 7'],
  ])('resolves format %s against @openlint/openlint-formats', async (name, displayName) => {
    const content = `formats: [${JSON.stringify(name)}]\n${needDescription}`;
    const ruleset = rulesetOf(await fallback.loadInline(content));
    expect([...ruleset.formats].map(format => format.displayName)).toEqual([displayName]);
  });

  it('can turn off a rule of the ruleset it extends', async () => {
    const ruleset = rulesetOf(await configured.loadInline('extends: [default]\nrules:\n  org-title: off\n'));
    expect(await lintCodes(ruleset)).toEqual([]);
  });

  it('rewrites extends inside overrides', async () => {
    // Without the rewrite, the bundler would look for a module named "default" and fail. (Core can't
    // extend a ruleset with aliases, such as oas, inside overrides, so this uses the configured one.)
    const content = 'overrides:\n  - files: ["**"]\n    extends: [default]\n';
    expect(rulesetOf(await configured.loadInline(content)).overrides).toHaveLength(1);
  });

  describe('rejected before anything is loaded', () => {
    const rejects = async (content: string, path: (string | number)[], message: RegExp) => {
      const readFile = vi.spyOn(fs.promises, 'readFile');
      const issues = issuesOf(await configured.loadInline(content));
      expect(issues).toContainEqual({ message: expect.stringMatching(message), path });
      expect(readFile).not.toHaveBeenCalled();
    };

    it('custom functions, at the top level and in overrides', async () => {
      const rule = 'rules:\n  r: { given: $, then: { function: myFn } }\n';
      await rejects(`functions: [myFn]\n${rule}`, ['functions'], /can't declare custom functions/);
      await rejects(`functionsDir: ./fns\n${rule}`, ['functionsDir'], /can't declare custom functions/);
      await rejects(
        'overrides:\n  - files: ["**"]\n    functions: [myFn]\n    rules: {}\n',
        ['overrides', 0, 'functions'],
        /can't declare custom functions/,
      );
    });

    const forbidden = [
      'https://example.com/ruleset.yaml',
      './ruleset.yaml',
      '../ruleset.yaml',
      '/etc/ruleset.yaml',
      'C:\\rules\\ruleset.yaml',
      '@acme/openlint-ruleset',
      'acme-ruleset',
      'constructor',
      'toString',
      '__proto__',
    ];

    it.each(forbidden)('extends %s, in every shape', async name => {
      const quoted = JSON.stringify(name);
      await rejects(`extends: ${quoted}\n`, ['extends'], /can't extend/);
      await rejects(`extends: [${quoted}]\n`, ['extends', 0], /can't extend/);
      await rejects(`extends: [[${quoted}, all]]\n`, ['extends', 0, 0], /can't extend/);
      await rejects(
        `overrides:\n  - files: ["**"]\n    extends: [${quoted}]\n`,
        ['overrides', 0, 'extends', 0],
        /can't extend/,
      );
    });

    // Only names exported by @openlint/openlint-formats pass.
    it.each(['bogus', 'asyncapi3', 'arazzo1', 'oas3.9', 'detectDialect', '../formats', 'oas3; void 0', ''])(
      'format %j, wherever formats appear',
      async name => {
        const quoted = JSON.stringify(name);
        const rule = 'r: { given: $, then: { function: truthy } }';
        await rejects(`formats: [${quoted}]\nrules:\n  ${rule}\n`, ['formats', 0], /Unknown format/);
        await rejects(
          `rules:\n  r: { given: $, formats: [oas3, ${quoted}], then: { function: truthy } }\n`,
          ['rules', 'r', 'formats', 1],
          /Unknown format/,
        );
        await rejects(
          `overrides:\n  - files: ["**"]\n    formats: [${quoted}]\n    rules:\n      ${rule}\n`,
          ['overrides', 0, 'formats', 0],
          /Unknown format/,
        );
        await rejects(
          `aliases:\n  A:\n    targets:\n      - formats: [${quoted}]\n        given: ["$.info"]\nrules:\n  ${rule}\n`,
          ['aliases', 'A', 'targets', 0, 'formats', 0],
          /Unknown format/,
        );
      },
    );

    it('non-string formats', async () => {
      await rejects(
        'formats: [42]\nrules:\n  r: { given: $, then: { function: truthy } }\n',
        ['formats', 0],
        /Unknown format 42/,
      );
    });

    it.each(['spectral:bogus', 'openlint:oas', 'spectral:'])('unknown alias %s', async name => {
      await rejects(`extends: [${JSON.stringify(name)}]\n`, ['extends', 0], /Unknown ruleset alias/);
    });

    it.each(['notAFunction', '../functions/x', './x.js', 'constructor'])('function %s', async name => {
      await rejects(
        `rules:\n  r: { given: $, then: [{ function: truthy }, { function: ${JSON.stringify(name)} }] }\n`,
        ['rules', 'r', 'then', 1, 'function'],
        /Unknown function/,
      );
    });

    it('invalid rulesets and YAML', async () => {
      await rejects(
        'rules:\n  r: { given: $, severity: loud, then: { function: truthy } }\n',
        ['rules', 'r', 'severity'],
        /has to be one of/,
      );
      await rejects('{}', [], /must have rules or extends or overrides/);
      await rejects('rules: [1\n', [], /Invalid YAML\/JSON at line/);
      await rejects('- a\n- b\n', [], /must be a YAML or JSON object/);
    });
  });
});

describe('validate', () => {
  it('accepts a valid ruleset', async () => {
    expect(await fallback.validate('extends: [spectral:oas]\nrules:\n  info-contact: off\n')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(await configured.validate('extends: [default]\n')).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('accepts custom functions and file extends, with warnings for inline use', async () => {
    const result = await fallback.validate(
      'extends: [./base.yaml]\nfunctions: [hasTitle]\nrules:\n  r: { given: $.info, then: { function: hasTitle } }\n',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map(warning => warning.path)).toEqual([['functions'], ['extends', 0]]);
  });

  it('reports formats that @openlint/openlint-formats does not export', async () => {
    const result = await fallback.validate(
      'formats: [oas3.1, asyncapi3]\nrules:\n  r: { given: $, then: { function: truthy } }\n',
    );
    expect(result).toMatchObject({ valid: false, errors: [{ path: ['formats', 1] }] });
  });

  it('reports functions that are neither built in nor declared', async () => {
    const result = await fallback.validate(
      'functions: [hasTitle]\nrules:\n  r: { given: $, then: { function: hasTittle } }\n',
    );
    expect(result).toMatchObject({ valid: false, errors: [{ path: ['rules', 'r', 'then', 'function'] }] });
  });

  it('reports schema errors, unknown aliases and parse errors', async () => {
    const severity = await fallback.validate('rules:\n  r: { given: $, severity: loud, then: { function: truthy } }\n');
    expect(severity).toMatchObject({ valid: false, errors: [{ path: ['rules', 'r', 'severity'] }] });
    expect(await fallback.validate('extends: [spectral:bogus]\n')).toMatchObject({
      valid: false,
      errors: [{ path: ['extends', 0] }],
    });
    expect(await fallback.validate('{}')).toMatchObject({ valid: false, errors: [{ path: [] }] });
    expect((await fallback.validate('rules: [1\n')).valid).toBe(false);
  });

  it('does not read files', async () => {
    const readFile = vi.spyOn(fs.promises, 'readFile');
    await fallback.validate('extends: [/etc/passwd]\nfunctionsDir: /tmp\nrules: {}\n');
    expect(readFile).not.toHaveBeenCalled();
  });
});
