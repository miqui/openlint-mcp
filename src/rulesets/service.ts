import fs from 'node:fs';

import { Ruleset, assertValidRuleset, getDiagnosticSeverity } from '@openlint/openlint-core';
import { parseYaml } from '@openlint/openlint-parsers';
import { bundleAndLoadRuleset } from '@openlint/openlint-ruleset-bundler/with-loader';
import { arazzo, asyncapi, oas } from '@openlint/openlint-rulesets';
import runtime from '@openlint/openlint-runtime';

import { PACKAGE_RULESET_NAMES, type PackageRulesetName, type RulesetSpec } from '../config.js';
import { formatIssue, toIssues, type Issue } from './issues.js';
import {
  RULESET_ALIASES,
  customFunctionIssues,
  extendsIssues,
  isObject,
  isPackageRulesetName,
  jsonPathExpressionIssues,
  overridesIssues,
  toRulesetDefinition,
  unknownFormatIssues,
  unknownFunctionIssues,
  type Json,
} from './policy.js';

// A default import: Node 22 can't detect `fetch` as a named export of this CommonJS package (its
// export getter wraps a call), so `import { fetch }` fails there at startup.
const { fetch } = runtime;

const PACKAGE_RULESETS: Readonly<Record<PackageRulesetName, object>> = { oas, asyncapi, arazzo };
const PACKAGE_SOURCE = '@openlint/openlint-rulesets';
// A number: the parser and core each type severities with their own copy of the enum.
const ERROR: number = getDiagnosticSeverity('error');

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
      entries.push(createEntry(spec.name, spec.path, spec.isDefault, ruleset));
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
      createEntry(name, `${PACKAGE_SOURCE} (${name})`, true, packageRuleset(name)),
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
  resolve(ruleset?: string): RulesetResult {
    if (ruleset === undefined) return { ok: true, ruleset: this.defaultRuleset };

    const name = ruleset.trim();
    const named = this.rulesetByName(name);
    if (named !== undefined) return { ok: true, ruleset: named };

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

  /**
   * Loads an untrusted inline ruleset: checks it against the inline policy, then builds it with core
   * from objects the server already holds. Nothing is bundled, read from disk or fetched, and
   * configured rulesets it extends are reused as loaded at startup, never run again.
   */
  loadInline(content: string): RulesetResult {
    const parsed = parseRuleset(content);
    if (!parsed.ok) return parsed;
    const definition = parsed.definition;

    const { unknownAliases, notAllowedInline } = extendsIssues(definition, this.resolveExtends, this.allowedNames());
    const issues = [
      ...customFunctionIssues(definition),
      ...overridesIssues(definition),
      ...jsonPathExpressionIssues(definition),
      ...unknownAliases,
      ...notAllowedInline,
      ...unknownFunctionIssues(definition),
      ...unknownFormatIssues(definition),
      ...staticIssues(definition),
    ];
    if (issues.length > 0) return { ok: false, issues };

    return this.build(definition);
  }

  /**
   * Validates a YAML/JSON ruleset without running any code. When the ruleset is also usable inline,
   * it is built the same way `lint_document` would build it, so `valid` covers `extends` too.
   */
  validate(content: string): ValidationResult {
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
    const warnings = [
      ...customFunctionIssues(definition),
      ...overridesIssues(definition),
      ...jsonPathExpressionIssues(definition),
      ...notAllowedInline,
    ];
    if (errors.length > 0) return { valid: false, errors, warnings };
    // Building it would mean running custom functions or reading files, URLs or packages.
    if (warnings.length > 0) return { valid: true, errors, warnings };

    const loaded = this.build(definition);
    return loaded.ok
      ? { valid: true, errors: [], warnings: [] }
      : { valid: false, errors: loaded.issues, warnings: [] };
  }

  /** Builds a ruleset that passed the inline policy. Core validates the JS form and the rule overrides. */
  private build(definition: Json): RulesetResult {
    try {
      return {
        ok: true,
        ruleset: new Ruleset(toRulesetDefinition(definition, this.resolveExtends), { severity: 'recommended' }),
      };
    } catch (error) {
      return { ok: false, issues: toIssues(error) };
    }
  }

  /** The definition an inline `extends` name refers to: a loaded configured ruleset, or a package ruleset. */
  private readonly resolveExtends = (name: string): object | undefined => {
    const entry = this.entries.find(candidate => candidate.info.name === name);
    if (entry !== undefined) return entry.ruleset.definition;
    const packageName = isPackageRulesetName(name) ? name : RULESET_ALIASES.get(name);
    return packageName === undefined ? undefined : PACKAGE_RULESETS[packageName];
  };

  /** A configured or package ruleset (or alias) by name, as already loaded. */
  private rulesetByName(name: string): Ruleset | undefined {
    const entry = this.entries.find(candidate => candidate.info.name === name);
    if (entry !== undefined) return entry.ruleset;
    const packageName = isPackageRulesetName(name) ? name : RULESET_ALIASES.get(name);
    return packageName === undefined ? undefined : this.packageRuleset(packageName);
  }

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

function createEntry(name: string, source: string, isDefault: boolean, ruleset: Ruleset): Entry {
  const enabled = Object.values(ruleset.rules).filter(rule => rule.enabled);
  const formats = new Set<string>();
  for (const format of ruleset.formats) formats.add(format.displayName ?? format.name);
  for (const rule of enabled) {
    for (const format of rule.formats ?? []) formats.add(format.displayName ?? format.name);
  }
  return { info: { name, source, isDefault, ruleCount: enabled.length, formats: [...formats] }, ruleset };
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
