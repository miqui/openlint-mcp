import { RulesetValidationError } from '@openlint/openlint-core';

export type IssuePath = (string | number)[];

/** A problem with a ruleset, as reported to tool callers. */
export interface Issue {
  readonly message: string;
  /** JSON path inside the ruleset; empty for problems with the ruleset as a whole. */
  readonly path: IssuePath;
}

/**
 * Turns an error thrown while validating or loading a ruleset into issues.
 * Core throws either one `RulesetValidationError` or an `AggregateError` of them.
 */
export function toIssues(error: unknown, redact: (message: string) => string = message => message): Issue[] {
  if (error instanceof AggregateError) {
    const nested = (error.errors as unknown[]).flatMap(inner => toIssues(inner, redact));
    return nested.length > 0 ? nested : [{ message: redact(error.message), path: [] }];
  }
  if (error instanceof RulesetValidationError) {
    return [{ message: redact(error.message), path: [...error.path] }];
  }
  const message = error instanceof Error ? error.message : String(error);
  return [{ message: redact(message), path: [] }];
}

export function formatIssue({ message, path }: Issue): string {
  return path.length > 0 ? `${path.join('.')}: ${message}` : message;
}
