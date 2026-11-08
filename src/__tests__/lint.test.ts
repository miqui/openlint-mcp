import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { lintDocument, relativeTo, type FlatDiagnostic, type GroupedDiagnostic } from '../lint.js';
import { RulesetService } from '../rulesets/service.js';
import { rulesetOf } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, 'documents', name), 'utf8');

const fallback = RulesetService.fallback();
const defaultRuleset = rulesetOf(fallback.resolve());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formats', () => {
  it.each([
    ['oas2.yaml', 'OpenAPI 2.0 (Swagger)'],
    ['oas3.0.yaml', 'OpenAPI 3.0.x'],
    ['oas3.1.json', 'OpenAPI 3.1.x'],
    ['asyncapi.yaml', 'AsyncAPI 3.0.x'],
    ['arazzo.yaml', 'Arazzo 1.0.x'],
  ])('reports the formats of %s', async (filename, format) => {
    const result = await lintDocument({ content: read(filename), ruleset: defaultRuleset, filename });
    expect(result.formats).toContain(format);
    expect(result.counts.warn).toBeGreaterThan(0);
  });

  it('returns no formats, and an unrecognized-format diagnostic, for other documents', async () => {
    const result = await lintDocument({ content: read('not-an-api.yaml'), ruleset: defaultRuleset });
    expect(result.formats).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unrecognized-format']);
  });

  it('reports invalid YAML as diagnostics', async () => {
    const result = await lintDocument({ content: 'openapi: 3.0.3\ninfo: [1\n', ruleset: defaultRuleset });
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('parser');
    expect(result.counts.error).toBeGreaterThan(0);
  });

  it('parses .json file names as JSON and anything else as YAML', async () => {
    // YAML that isn't JSON: only the JSON parser rejects it.
    const yaml = 'openapi: 3.1.0\ninfo:\n  title: t\n  version: "1"\npaths: {}\n';
    const asYaml = await lintDocument({ content: yaml, ruleset: defaultRuleset, filename: 'openapi.yaml' });
    const asJson = await lintDocument({ content: yaml, ruleset: defaultRuleset, filename: 'openapi.JSON' });
    expect(asYaml.formats).toContain('OpenAPI 3.1.x');
    expect(asYaml.diagnostics.map(d => d.code)).not.toContain('parser');
    expect(asJson.formats).toEqual([]);
    expect(asJson.diagnostics.map(d => d.code)).toContain('parser');
  });
});

describe('output shaping', () => {
  const content = read('oas3.0.yaml');

  it('groups by code by default, most severe first, then by code', async () => {
    const result = await lintDocument({ content, ruleset: defaultRuleset });
    const groups = result.diagnostics as GroupedDiagnostic[];
    expect(groups.map(({ code, count }) => [code, count])).toEqual([
      ['info-contact', 1],
      ['info-description', 1],
      ['operation-description', 3],
      ['operation-operationId', 3],
      ['operation-tags', 3],
    ]);
    expect(groups[2]).toMatchObject({ severity: 'warn', first: { path: ['paths', '/owners', 'get'] } });
    expect(result).toMatchObject({ counts: { error: 0, warn: 11, info: 0, hint: 0 }, truncated: false, notes: [] });
  });

  it('lists every diagnostic with groupBy "none", in a stable order', async () => {
    const result = await lintDocument({ content, ruleset: defaultRuleset, groupBy: 'none' });
    const flat = result.diagnostics as FlatDiagnostic[];
    expect(flat).toHaveLength(11);
    expect(flat.filter(d => d.code === 'operation-tags').map(d => d.path.join('/'))).toEqual([
      'paths//owners/get',
      'paths//pets/get',
      'paths//pets/post',
    ]);
    expect(flat[0]).toEqual({
      code: 'info-contact',
      severity: 'warn',
      message: expect.any(String),
      path: ['info'],
      range: { start: { line: expect.any(Number), character: expect.any(Number) }, end: expect.any(Object) },
    });
  });

  it('truncates to limit, but counts everything', async () => {
    const grouped = await lintDocument({ content, ruleset: defaultRuleset, limit: 2 });
    expect(grouped.diagnostics.map(d => d.code)).toEqual(['info-contact', 'info-description']);
    expect(grouped).toMatchObject({ truncated: true, counts: { warn: 11 } });
    const flat = await lintDocument({ content, ruleset: defaultRuleset, limit: 11, groupBy: 'none' });
    expect(flat.truncated).toBe(false);
  });

  it('leaves out diagnostics below the severity threshold, but counts them', async () => {
    const result = await lintDocument({ content: read('arazzo.yaml'), ruleset: defaultRuleset, severity: 'warn' });
    expect(result.counts).toMatchObject({ warn: 3, hint: 3 });
    expect(result.diagnostics.every(d => d.severity === 'warn')).toBe(true);
    expect(result.diagnostics).toHaveLength(3);
  });
});

describe('relativeTo', () => {
  it('rewrites paths under the directory, but not URLs or other paths', () => {
    const relative = relativeTo(path.join(path.sep, 'srv', 'api'));
    const file = path.join(path.sep, 'srv', 'api', 'pets.yaml');
    expect(relative(`in ref ${file}`)).toBe('in ref pets.yaml');
    expect(relative(`'${file}'`)).toBe("'pets.yaml'");
    expect(relative(file)).toBe('pets.yaml');
    expect(relative('http://host/srv/api/pets.yaml')).toBe('http://host/srv/api/pets.yaml');
    expect(relative(path.join(path.sep, 'srv', 'apis', 'x.yaml'))).toBe(path.join(path.sep, 'srv', 'apis', 'x.yaml'));
  });

  it('leaves everything alone at a filesystem root', () => {
    const relative = relativeTo(path.parse(process.cwd()).root);
    expect(relative('http://host//x.yaml and /etc/x.yaml')).toBe('http://host//x.yaml and /etc/x.yaml');
  });
});

describe('document name', () => {
  const content = 'openapi: 3.0.3\ninfo:\n  title: t\n  version: "1"\npaths: {}\n';
  let service: RulesetService;

  beforeAll(async () => {
    const file = path.join(FIXTURES, 'org-overrides', '.openlint.yaml');
    service = await RulesetService.fromConfig([{ name: 'default', path: file, isDefault: true }]);
  });

  it("matches the ruleset's overrides against filename, as if the document sat next to the ruleset", async () => {
    const ruleset = rulesetOf(service.resolve());
    const codes = async (filename?: string) =>
      (await lintDocument({ content, ruleset, filename })).diagnostics.map(d => d.code);
    expect(await codes()).toEqual(['info-description-required']);
    expect(await codes('openapi.yaml')).toEqual(['info-description-required']);
    expect(await codes('legacy.yaml')).toEqual([]);
  });
});

describe('external $refs', () => {
  let server: http.Server;
  let base: string;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      hits++;
      response.setHeader('content-type', 'application/yaml');
      response.end('type: object\nproperties:\n  name: { type: string }\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  const documentWithRefs = (url: string) =>
    [
      'openapi: 3.0.3',
      'info: { title: t, version: "1", description: d, contact: { name: n } }',
      'servers: [{ url: "https://example.com" }]',
      'paths:',
      '  /pets:',
      '    get:',
      '      operationId: listPets',
      '      description: d',
      '      tags: [pets]',
      '      responses:',
      '        "200":',
      '          description: OK',
      '          content:',
      '            application/json:',
      `              schema: { $ref: "${url}" }`,
      'components:',
      '  schemas:',
      '    Local: { $ref: "./local.yaml" }',
    ].join('\n');

  it("aren't followed by default: no request, no file read, and a note", async () => {
    hits = 0;
    // The ref resolver reads files with the callback fs.readFile; the next test is the positive control.
    const readFile = vi.spyOn(fs, 'readFile');
    const readFilePromise = vi.spyOn(fs.promises, 'readFile');
    const result = await lintDocument({
      content: documentWithRefs(`${base}/pet.yaml`),
      ruleset: defaultRuleset,
      groupBy: 'none',
    });
    expect(hits).toBe(0);
    expect(readFile).not.toHaveBeenCalled();
    expect(readFilePromise).not.toHaveBeenCalled();
    const invalidRefs = (result.diagnostics as FlatDiagnostic[]).filter(d => d.code === 'invalid-ref');
    expect(invalidRefs.map(d => d.path.at(-2))).toEqual(['Local', 'schema']);
    expect(invalidRefs.every(d => !d.message.includes(process.cwd()))).toBe(true);
    expect(result.notes).toEqual([expect.stringContaining('--allow-external-refs')]);
  });

  it('are followed with allowExternalRefs', async () => {
    hits = 0;
    const readFile = vi.spyOn(fs, 'readFile');
    const result = await lintDocument({
      content: documentWithRefs(`${base}/pet.yaml`),
      ruleset: defaultRuleset,
      groupBy: 'none',
      allowExternalRefs: true,
    });
    expect(hits).toBe(1);
    // Relative refs resolve against the document's directory (here the working directory).
    expect(readFile.mock.calls.map(([file]) => String(file))).toContain(path.join(process.cwd(), 'local.yaml'));
    const invalidRefs = (result.diagnostics as FlatDiagnostic[]).filter(d => d.code === 'invalid-ref');
    expect(invalidRefs.map(d => d.path.at(-2))).toEqual(['Local']);
    expect(result.notes).toEqual([]);
  });

  it.each(['/', '/api'])('keep URLs intact in messages when the working directory is %s', async cwd => {
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    const url = `${base}/api/pet.yaml`;
    const result = await lintDocument({ content: documentWithRefs(url), ruleset: defaultRuleset, groupBy: 'none' });
    const messages = (result.diagnostics as FlatDiagnostic[]).filter(d => d.code === 'invalid-ref').map(d => d.message);
    expect(messages.some(message => message.includes(url))).toBe(true);
  });

  it.each([false, true])("aren't fetched from rule options (allowExternalRefs: %s)", async allowExternalRefs => {
    hits = 0;
    const inline = rulesetOf(
      fallback.loadInline(
        `rules:\n  info-schema:\n    given: $.info\n    then:\n      function: schema\n      functionOptions:\n        schema: { $ref: "${base}/schema.yaml" }\n`,
      ),
    );
    await lintDocument({ content: read('oas3.1.json'), ruleset: inline, filename: 'oas3.1.json', allowExternalRefs });
    expect(hits).toBe(0);
  });
});
