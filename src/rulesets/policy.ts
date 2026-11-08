/**
 * Checks on ruleset definitions in their YAML/JSON form (function names, format names and `extends`
 * entries are strings). Inline rulesets come from tool callers, so they are untrusted: they may not
 * run custom code or make the bundler read files, fetch URLs or resolve packages.
 *
 * Every such name in an inline ruleset must come from a fixed set: built-in functions, format
 * exports, ruleset aliases and configured rulesets. Anything else is rejected before bundling.
 */
import * as builtinFunctions from '@openlint/openlint-functions';
import * as formatExports from '@openlint/openlint-formats';

import { PACKAGE_RULESET_NAMES, type PackageRulesetName } from '../config.js';
import type { Issue, IssuePath } from './issues.js';

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Function names exported by `@openlint/openlint-functions`. */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set(
  Object.entries(builtinFunctions)
    .filter(([name, value]) => name !== 'default' && typeof value === 'function')
    .map(([name]) => name),
);

/**
 * Format functions exported by `@openlint/openlint-formats`, by export name. Formats have a
 * `displayName`; the package's helpers (such as `detectDialect`) don't.
 */
const FORMATS: ReadonlyMap<string, unknown> = new Map(
  Object.entries(formatExports).filter(
    ([name, value]) =>
      name !== 'default' &&
      typeof value === 'function' &&
      typeof (value as { displayName?: unknown }).displayName === 'string',
  ),
);

const formatKey = (name: string): string => name.toLowerCase().replace(/[._-]/g, '');

const FORMATS_BY_KEY = new Map<string, string[]>();
for (const name of FORMATS.keys()) {
  FORMATS_BY_KEY.set(formatKey(name), [...(FORMATS_BY_KEY.get(formatKey(name)) ?? []), name]);
}

/** Format export names, for messages. */
export const FORMAT_NAMES: readonly string[] = [...FORMATS.keys()];

/**
 * Maps a format name to an export of `@openlint/openlint-formats`, or `undefined` when there is none.
 * Case, `.`, `_` and `-` are ignored, so `oas3.1`, `oas3_1` and `OAS3.1` all name `oas3_1`, and
 * `json-schema-draft7` names `jsonSchemaDraft7`. Names that match different formats are refused.
 */
export function resolveFormat(name: string): string | undefined {
  if (FORMATS.has(name)) return name;
  const candidates = FORMATS_BY_KEY.get(formatKey(name)) ?? [];
  const formats = new Set(candidates.map(candidate => FORMATS.get(candidate)));
  return formats.size === 1 ? candidates[0] : undefined;
}

/**
 * The `extends` aliases the ruleset migrator maps to `@openlint/openlint-rulesets`. This must match
 * its table exactly: the migrator resolves any other name, including an unknown `spectral:` one, as
 * a file path.
 */
export const RULESET_ALIASES: ReadonlyMap<string, PackageRulesetName> = new Map([
  ['spectral:oas', 'oas'],
  ['spectral:asyncapi', 'asyncapi'],
  ['spectral:arazzo', 'arazzo'],
  ['openlint:openapi', 'oas'],
  ['openlint:asyncapi', 'asyncapi'],
  ['openlint:arazzo', 'arazzo'],
]);

/** The alias an inline `extends: [oas]` (and friends) is rewritten to before bundling. */
export const PACKAGE_ALIASES: Readonly<Record<PackageRulesetName, string>> = {
  oas: 'openlint:openapi',
  asyncapi: 'openlint:asyncapi',
  arazzo: 'openlint:arazzo',
};

export function isPackageRulesetName(name: string): name is PackageRulesetName {
  return (PACKAGE_RULESET_NAMES as readonly string[]).includes(name);
}

/** Maps an `extends` name to what the bundler should see, or `undefined` when it isn't allowed. */
export type ExtendsResolver = (name: string) => string | undefined;

interface Scope {
  readonly definition: Json;
  readonly path: IssuePath;
}

/** The ruleset itself and each entry of its `overrides`. */
function scopes(definition: Json): Scope[] {
  const result: Scope[] = [{ definition, path: [] }];
  const { overrides } = definition;
  if (Array.isArray(overrides)) {
    overrides.forEach((override: unknown, index) => {
      if (isObject(override)) result.push({ definition: override, path: ['overrides', index] });
    });
  }
  return result;
}

interface Ref {
  readonly name: unknown;
  readonly path: IssuePath;
}

/** Every `extends` entry. `extends` is a name, or a list of names and `[name, severity]` pairs. */
export function extendsRefs(definition: Json): Ref[] {
  const refs: Ref[] = [];
  for (const scope of scopes(definition)) {
    const value = scope.definition['extends'];
    const base = [...scope.path, 'extends'];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      refs.push({ name: value, path: base });
      continue;
    }
    value.forEach((entry: unknown, index) => {
      if (Array.isArray(entry)) refs.push({ name: entry[0], path: [...base, index, 0] });
      else refs.push({ name: entry, path: [...base, index] });
    });
  }
  return refs;
}

/** Every `then.function` in `rules`, including rules inside `overrides`. */
export function functionRefs(definition: Json): Ref[] {
  const refs: Ref[] = [];
  for (const scope of scopes(definition)) {
    const { rules } = scope.definition;
    if (!isObject(rules)) continue;
    for (const [ruleName, rule] of Object.entries(rules)) {
      if (!isObject(rule)) continue;
      const base = [...scope.path, 'rules', ruleName, 'then'];
      const { then } = rule;
      const thens: [unknown, IssuePath][] = Array.isArray(then)
        ? then.map((entry: unknown, index): [unknown, IssuePath] => [entry, [...base, index]])
        : [[then, base]];
      for (const [entry, path] of thens) {
        if (isObject(entry) && 'function' in entry) refs.push({ name: entry['function'], path: [...path, 'function'] });
      }
    }
  }
  return refs;
}

/**
 * Every `formats` entry: on the ruleset and its overrides, on their rules, and on alias targets
 * (including alias targets inside overrides).
 */
export function formatRefs(definition: Json): Ref[] {
  const refs: Ref[] = [];
  const add = (formats: unknown, path: IssuePath): void => {
    if (Array.isArray(formats)) formats.forEach((name: unknown, index) => refs.push({ name, path: [...path, index] }));
  };
  for (const scope of scopes(definition)) {
    add(scope.definition['formats'], [...scope.path, 'formats']);
    const { rules, aliases } = scope.definition;
    if (isObject(rules)) {
      for (const [ruleName, rule] of Object.entries(rules)) {
        if (isObject(rule)) add(rule['formats'], [...scope.path, 'rules', ruleName, 'formats']);
      }
    }
    if (isObject(aliases)) {
      for (const [aliasName, alias] of Object.entries(aliases)) {
        if (!isObject(alias) || !Array.isArray(alias['targets'])) continue;
        alias['targets'].forEach((target: unknown, index) => {
          if (isObject(target))
            add(target['formats'], [...scope.path, 'aliases', aliasName, 'targets', index, 'formats']);
        });
      }
    }
  }
  return refs;
}

/** Format names that aren't exported by `@openlint/openlint-formats`. */
export function unknownFormatIssues(definition: Json): Issue[] {
  return formatRefs(definition)
    .filter(ref => typeof ref.name !== 'string' || resolveFormat(ref.name) === undefined)
    .map(ref => ({
      message: `Unknown format ${JSON.stringify(ref.name)}. Use a format from @openlint/openlint-formats: ${FORMAT_NAMES.join(', ')} (case, ".", "_" and "-" don't matter, so "oas3.1" works).`,
      path: ref.path,
    }));
}

export function declaredFunctions(definition: Json): Set<string> {
  const { functions } = definition;
  return new Set(Array.isArray(functions) ? functions.filter((name): name is string => typeof name === 'string') : []);
}

/** `functions` and `functionsDir`, which load JavaScript, anywhere in the ruleset. */
export function customFunctionIssues(definition: Json): Issue[] {
  const issues: Issue[] = [];
  for (const scope of scopes(definition)) {
    for (const key of ['functions', 'functionsDir']) {
      if (key in scope.definition) {
        issues.push({
          message: `Inline rulesets can't declare custom functions ("${key}"). Rulesets with custom functions must be configured on the server with --ruleset.`,
          path: [...scope.path, key],
        });
      }
    }
  }
  return issues;
}

/** Function names that are neither built in nor declared in `functions`. */
export function unknownFunctionIssues(definition: Json): Issue[] {
  const declared = declaredFunctions(definition);
  return functionRefs(definition)
    .filter(ref => typeof ref.name === 'string' && !BUILTIN_FUNCTIONS.has(ref.name) && !declared.has(ref.name))
    .map(ref => ({
      message: `Unknown function "${String(ref.name)}". Use a built-in function (${[...BUILTIN_FUNCTIONS].join(', ')}) or declare it in "functions".`,
      path: ref.path,
    }));
}

export interface ExtendsIssues {
  /** `spectral:`/`openlint:` names the migrator doesn't know. Never valid anywhere. */
  readonly unknownAliases: Issue[];
  /** Files, URLs, packages and unknown names. Valid in a server-configured ruleset, not inline. */
  readonly notAllowedInline: Issue[];
}

export function extendsIssues(
  definition: Json,
  resolve: ExtendsResolver,
  allowedNames: readonly string[],
): ExtendsIssues {
  const unknownAliases: Issue[] = [];
  const notAllowedInline: Issue[] = [];
  const allowed = [...allowedNames, ...RULESET_ALIASES.keys()].join(', ');
  for (const ref of extendsRefs(definition)) {
    if (typeof ref.name !== 'string') {
      notAllowedInline.push({ message: 'An "extends" entry must be a ruleset name.', path: ref.path });
    } else if (resolve(ref.name) !== undefined) {
      continue;
    } else if (/^(spectral|openlint):/.test(ref.name)) {
      unknownAliases.push({
        message: `Unknown ruleset alias "${ref.name}". Known aliases: ${[...RULESET_ALIASES.keys()].join(', ')}.`,
        path: ref.path,
      });
    } else {
      notAllowedInline.push({
        message: `Inline rulesets can't extend "${ref.name}". Allowed: ${allowed}. Files, URLs and packages can only be extended from a ruleset configured on the server with --ruleset.`,
        path: ref.path,
      });
    }
  }
  return { unknownAliases, notAllowedInline };
}

/**
 * A copy of a definition that passed the inline policy, ready for the bundler: each `extends` name is
 * replaced by what `resolveExtends` returns, and each format name by its export name.
 */
export function prepareForBundling(definition: Json, resolveExtends: ExtendsResolver): Json {
  // A JSON round trip: the definition came from YAML/JSON, and `structuredClone` rejects the parser's objects.
  const copy = JSON.parse(JSON.stringify(definition)) as Json;
  for (const ref of extendsRefs(copy)) {
    const target = typeof ref.name === 'string' ? resolveExtends(ref.name) : undefined;
    if (target !== undefined) setAt(copy, ref.path, target);
  }
  for (const ref of formatRefs(copy)) {
    const target = typeof ref.name === 'string' ? resolveFormat(ref.name) : undefined;
    if (target !== undefined) setAt(copy, ref.path, target);
  }
  return copy;
}

function setAt(root: Json, path: IssuePath, value: unknown): void {
  let node: unknown = root;
  for (const key of path.slice(0, -1)) node = (node as Record<string | number, unknown>)[key];
  (node as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}
