import type { Rule, Ruleset } from '@openlint/openlint-core';

import { SEVERITY_NAMES, type SeverityName } from './lint.js';
import { formatFamily, resolveFormatQuery } from './rulesets/formats.js';

export type RuleSeverity = SeverityName | 'off';

export interface RuleSummary {
  [key: string]: unknown;
  readonly name: string;
  readonly severity: RuleSeverity;
  readonly enabled: boolean;
  readonly recommended: boolean;
  /** Display names of the formats the rule declares; empty when it applies to all of the ruleset's. */
  readonly formats: string[];
  readonly description: string | null;
}

export interface RuleThen {
  readonly function: string;
  readonly field?: string;
  /** Left out when large, such as a whole JSON Schema. */
  readonly functionOptions?: unknown;
}

export interface RuleDetails extends RuleSummary {
  readonly message: string | null;
  /** JSONPath expressions, which may name the ruleset's aliases (`#Alias`). */
  readonly given: string[];
  readonly then: RuleThen[];
  readonly documentationUrl: string | null;
  /** Free-form data the ruleset attached to the rule, such as agent guidance (`extensions.prompt`). */
  readonly extensions: Record<string, unknown> | null;
}

/** Function options larger than this, as JSON, are left out of `explain_rule`. */
const MAX_FUNCTION_OPTIONS_LENGTH = 2000;

export type RulesResult =
  { readonly ok: true; readonly rules: RuleSummary[] } | { readonly ok: false; readonly message: string };

/**
 * The rules of a ruleset, sorted by name. `format` keeps the rules that apply to documents of that
 * format (see `formatFamily`); rules that declare no formats always apply.
 */
export function listRules(ruleset: Ruleset, options: { format?: string; enabledOnly?: boolean } = {}): RulesResult {
  const { format, enabledOnly = true } = options;
  let rules = Object.values(ruleset.rules);
  if (enabledOnly) rules = rules.filter(rule => rule.enabled);
  if (format !== undefined) {
    const name = resolveFormatQuery(format);
    if (name === undefined) {
      return {
        ok: false,
        message: `Unknown format "${format}". Use a format such as oas2 (or swagger), oas3, oas3.1, asyncapi2, asyncapi3 or arazzo1.0.`,
      };
    }
    const family = formatFamily(name);
    rules = rules.filter(rule => rule.matchesFormat(family));
  }
  return { ok: true, rules: rules.map(summarize).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
}

export type RuleResult =
  { readonly ok: true; readonly rule: RuleDetails } | { readonly ok: false; readonly message: string };

/** Gives the name a ruleset registered a custom function under, when it differs from the function's own. */
export type FunctionNamer = (fn: unknown) => string | undefined;

export function explainRule(ruleset: Ruleset, name: string, functionName?: FunctionNamer): RuleResult {
  const rule = Object.hasOwn(ruleset.rules, name) ? ruleset.rules[name] : undefined;
  if (rule === undefined) {
    const query = name.toLowerCase();
    const similar = Object.keys(ruleset.rules)
      .filter(candidate => candidate.toLowerCase().includes(query) || query.includes(candidate.toLowerCase()))
      // Closest first: names that start with the query, then shorter names.
      .sort(
        (a, b) =>
          Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)) ||
          a.length - b.length,
      )
      .slice(0, 5);
    const hint = similar.length > 0 ? ` Did you mean ${similar.map(candidate => `"${candidate}"`).join(', ')}?` : '';
    return { ok: false, message: `Unknown rule "${name}" in this ruleset.${hint} Use list_rules to see its rules.` };
  }
  return {
    ok: true,
    rule: {
      ...summarize(rule),
      message: rule.message,
      given: [...rule.given],
      then: rule.then.map(then => describeThen(then, functionName)),
      documentationUrl: rule.documentationUrl,
      extensions: rule.extensions,
    },
  };
}

function summarize(rule: Rule): RuleSummary {
  const severity = rule.severity;
  return {
    name: rule.name,
    severity: severity === -1 ? 'off' : (SEVERITY_NAMES[Number(severity)] ?? 'hint'),
    enabled: rule.enabled,
    recommended: rule.recommended,
    formats: [...(rule.formats ?? [])].map(format => format.displayName ?? format.name),
    description: rule.description,
  };
}

function describeThen(then: Rule['then'][number], functionName?: FunctionNamer): RuleThen {
  return {
    function: functionName?.(then.function) ?? (then.function.name || 'anonymous'),
    ...(then.field === undefined ? {} : { field: then.field }),
    ...(smallJson(then.functionOptions) ? { functionOptions: then.functionOptions } : {}),
  };
}

/** Whether `value` is set, serializes as JSON (no BigInt or cycles), and is small enough to return. */
function smallJson(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    const json = JSON.stringify(value);
    return json !== undefined && json.length <= MAX_FUNCTION_OPTIONS_LENGTH;
  } catch {
    return false;
  }
}
