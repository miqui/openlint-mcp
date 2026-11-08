import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ruleset, assertValidRuleset, getDiagnosticSeverity } from '@openlint/openlint-core';
import { parseYaml } from '@openlint/openlint-parsers';
import { bundleAndLoadRuleset } from '@openlint/openlint-ruleset-bundler/with-loader';
import { arazzo, asyncapi, oas } from '@openlint/openlint-rulesets';
import runtime from '@openlint/openlint-runtime';

import { PACKAGE_RULESET_NAMES, type PackageRulesetName, type RulesetSpec } from '../config.js';
import { formatIssue, toIssues, type Issue } from './issues.js';
import {
  PACKAGE_ALIASES,
  RULESET_ALIASES,
  customFunctionIssues,
  extendsIssues,
  isObject,
  isPackageRulesetName,
  prepareForBundling,
  unknownFormatIssues,
  unknownFunctionIssues,
  type Json,
} from './policy.js';

// A default import: Node 22 can't detect `fetch` as a named export of this CommonJS package (its
// export getter wraps a call), so `import { fetch }` fails there at startup.
const { fetch } = runtime;

const PACKAGE_RULESETS: Readonly<Record<PackageRulesetName, unknown>> = { oas, asyncapi, arazzo };
const PACKAGE_SOURCE = '@openlint/openlint-rulesets';
// A number: the parser and core each type severities with their own copy of the enum.
const ERROR: number = getDiagnosticSeverity('error');

/**
 * Inline rulesets are bundled from an in-memory entry file in this directory, which never exists on
 * disk. It sits inside the package so the bundler resolves `@openlint/*` from our dependencies.
 */
const INLINE_DIR = fileURLToPath(new URL('./__inline__/', import.meta.url));
let inlineCounter = 0;

export interface RulesetInfo {
  readonly name: string;
  /** File path for configured rulesets, package name for the fallback ones. */
  readonly source: string;
  readonly isDefault: boolean;
  /** Rules enabled at the recommended severity, which is what `lint_document` runs. */
  readonly ruleCount: number;
  /** Display names of the document formats the ruleset's rules apply to. */
  readonly formats: string[];
}

export type RulesetResult =
  { readonly ok: true; readonly ruleset: Ruleset } | { readonly ok: false; readonly issues: Issue[] };

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: Issue[];
  /** Reasons `lint_document` would refuse the ruleset inline, although it is valid. */
  readonly warnings: Issue[];
}

export class RulesetLoadError extends Error {
  override readonly name = 'RulesetLoadError';
}

interface Entry {
  readonly info: RulesetInfo;
  readonly ruleset: Ruleset;
  /** What an inline `extends` naming this ruleset is rewritten to: a trusted file path or an alias. */
  readonly extendsAs: string;
}

export class RulesetService {
  private readonly packageRulesets = new Map<PackageRulesetName, Ruleset>();

  private constructor(
    private readonly entries: readonly Entry[],
    private readonly defaultRuleset: Ruleset,
  ) {}

  /** Loads the configured rulesets, or the package rulesets when `specs` is empty. */
  static async fromConfig(specs: readonly RulesetSpec[]): Promise<RulesetService> {
    if (specs.length === 0) return RulesetService.fallback();

    const entries: Entry[] = [];
    for (const spec of specs) {
      let ruleset: Ruleset;
      try {
        ruleset = await bundleAndLoadRuleset(spec.path, { fs, fetch });
      } catch (error) {
        const details = toIssues(error).map(formatIssue).join('\n  ');
        throw new RulesetLoadError(`Failed to load ruleset "${spec.name}" from ${spec.path}:\n  ${details}`);
      }
      entries.push(createEntry(spec.name, spec.path, spec.isDefault, ruleset, spec.path));
    }
    const defaultEntry = entries.find(entry => entry.info.isDefault) ?? entries[0];
    if (defaultEntry === undefined) throw new RulesetLoadError('No ruleset is configured.');
    return new RulesetService(entries, defaultEntry.ruleset);
  }

  /**
   * The `oas`, `asyncapi` and `arazzo` rulesets with recommended rules. All three are defaults: the
   * default ruleset extends them all, and each rule only runs on documents of its own formats.
   */
  static fallback(): RulesetService {
    const entries = PACKAGE_RULESET_NAMES.map(name =>
      createEntry(name, `${PACKAGE_SOURCE} (${name})`, true, packageRuleset(name), PACKAGE_ALIASES[name]),
    );
    const combined = new Ruleset(
      { extends: PACKAGE_RULESET_NAMES.map(name => PACKAGE_RULESETS[name]) },
      { severity: 'recommended' },
    );
    return new RulesetService(entries, combined);
  }

  list(): RulesetInfo[] {
    return this.entries.map(entry => entry.info);
  }

  /**
   * The ruleset for a tool call's `ruleset` argument: the default when it's omitted, a configured or
   * package ruleset (or alias) by name, and otherwise inline YAML/JSON text.
   */
  async resolve(ruleset?: string): Promise<RulesetResult> {
    if (ruleset === undefined) return { ok: true, ruleset: this.defaultRuleset };

    const name = ruleset.trim();
    const entry = this.entries.find(candidate => candidate.info.name === name);
    if (entry !== undefined) return { ok: true, ruleset: entry.ruleset };
    const packageName = isPackageRulesetName(name) ? name : RULESET_ALIASES.get(name);
    if (packageName !== undefined) return { ok: true, ruleset: this.packageRuleset(packageName) };

    if (/^[\w.:@/-]+$/.test(name)) {
      return {
        ok: false,
        issues: [
          {
            message: `Unknown ruleset "${name}". Use one of ${this.allowedNames().join(', ')}, or pass a YAML/JSON ruleset.`,
            path: [],
          },
        ],
      };
    }
    return this.loadInline(ruleset);
  }

  /** Loads an untrusted inline ruleset after checking it against the inline policy. */
  async loadInline(content: string): Promise<RulesetResult> {
    const parsed = parseRuleset(content);
    if (!parsed.ok) return parsed;
    const definition = parsed.definition;

    const { unknownAliases, notAllowedInline } = extendsIssues(definition, this.resolveExtends, this.allowedNames());
    const issues = [
      ...customFunctionIssues(definition),
      ...unknownAliases,
      ...notAllowedInline,
      ...unknownFunctionIssues(definition),
      ...unknownFormatIssues(definition),
      ...staticIssues(definition),
    ];
    if (issues.length > 0) return { ok: false, issues };

    return bundleInline(prepareForBundling(definition, this.resolveExtends));
  }

  /**
   * Validates a YAML/JSON ruleset without running any code. When the ruleset is also usable inline,
   * it is loaded the same way `lint_document` would load it, so `valid` covers `extends` too.
   */
  async validate(content: string): Promise<ValidationResult> {
    const parsed = parseRuleset(content);
    if (!parsed.ok) return { valid: false, errors: parsed.issues, warnings: [] };
    const definition = parsed.definition;

    const { unknownAliases, notAllowedInline } = extendsIssues(definition, this.resolveExtends, this.allowedNames());
    const errors = [
      ...staticIssues(definition),
      ...unknownAliases,
      ...unknownFunctionIssues(definition),
      ...unknownFormatIssues(definition),
    ];
    const warnings = [...customFunctionIssues(definition), ...notAllowedInline];
    if (errors.length > 0) return { valid: false, errors, warnings };
    // Loading would mean running custom functions or reading files, URLs or packages.
    if (warnings.length > 0) return { valid: true, errors, warnings };

    const loaded = await bundleInline(prepareForBundling(definition, this.resolveExtends));
    return loaded.ok
      ? { valid: true, errors: [], warnings: [] }
      : { valid: false, errors: loaded.issues, warnings: [] };
  }

  private readonly resolveExtends = (name: string): string | undefined => {
    const entry = this.entries.find(candidate => candidate.info.name === name);
    if (entry !== undefined) return entry.extendsAs;
    if (isPackageRulesetName(name)) return PACKAGE_ALIASES[name];
    return RULESET_ALIASES.has(name) ? name : undefined;
  };

  private allowedNames(): string[] {
    return [...new Set([...this.entries.map(entry => entry.info.name), ...PACKAGE_RULESET_NAMES])];
  }

  private packageRuleset(name: PackageRulesetName): Ruleset {
    let ruleset = this.packageRulesets.get(name);
    if (ruleset === undefined) {
      ruleset = packageRuleset(name);
      this.packageRulesets.set(name, ruleset);
    }
    return ruleset;
  }
}

function packageRuleset(name: PackageRulesetName): Ruleset {
  return new Ruleset(PACKAGE_RULESETS[name], { severity: 'recommended' });
}

function createEntry(name: string, source: string, isDefault: boolean, ruleset: Ruleset, extendsAs: string): Entry {
  const enabled = Object.values(ruleset.rules).filter(rule => rule.enabled);
  const formats = new Set<string>();
  for (const format of ruleset.formats) formats.add(format.displayName ?? format.name);
  for (const rule of enabled) {
    for (const format of rule.formats ?? []) formats.add(format.displayName ?? format.name);
  }
  return { info: { name, source, isDefault, ruleCount: enabled.length, formats: [...formats] }, ruleset, extendsAs };
}

type ParseResult = { readonly ok: true; readonly definition: Json } | { readonly ok: false; readonly issues: Issue[] };

/** Parses YAML (and so JSON) text into a ruleset object. */
function parseRuleset(content: string): ParseResult {
  const { data, diagnostics } = parseYaml(content);
  // The parser reports syntax errors and duplicate keys as errors.
  const errors = diagnostics.filter(diagnostic => Number(diagnostic.severity) === ERROR);
  if (errors.length > 0) {
    return {
      ok: false,
      issues: errors.map(diagnostic => ({
        message: `Invalid YAML/JSON at line ${diagnostic.range.start.line + 1}: ${diagnostic.message}`,
        path: [...(diagnostic.path ?? [])],
      })),
    };
  }
  if (!isObject(data)) {
    return { ok: false, issues: [{ message: 'A ruleset must be a YAML or JSON object.', path: [] }] };
  }
  return { ok: true, definition: data };
}

/** Schema validation of the YAML/JSON form. It doesn't load functions or `extends`. */
function staticIssues(definition: Json): Issue[] {
  try {
    assertValidRuleset(definition, 'json');
    return [];
  } catch (error) {
    return toIssues(error);
  }
}

/**
 * Bundles a ruleset definition that passed the inline policy, from an in-memory entry file. By now
 * every `extends` entry is an alias or the path of a server-configured ruleset, every function and
 * format name is a package export, and there are no custom functions. So the bundler only reads
 * trusted files and resolves known names.
 */
async function bundleInline(definition: Json): Promise<RulesetResult> {
  const entry = path.join(INLINE_DIR, `ruleset-${++inlineCounter}.json`);
  const content = JSON.stringify(definition);
  const readFile = ((file: fs.PathLike, options?: unknown) =>
    path.resolve(String(file)) === entry
      ? Promise.resolve(content)
      : fs.promises.readFile(file, options as BufferEncoding)) as typeof fs.promises.readFile;
  const redact = (message: string): string => message.split(entry).join('<inline ruleset>').split(INLINE_DIR).join('');

  try {
    const ruleset = await bundleAndLoadRuleset(entry, { fetch, fs: { ...fs, promises: { ...fs.promises, readFile } } });
    return { ok: true, ruleset };
  } catch (error) {
    return { ok: false, issues: toIssues(error, redact) };
  }
}
