import { z } from 'zod';

import { SEVERITY_NAMES } from '../lint.js';

export const ruleSummary = z.object({
  name: z.string(),
  severity: z.enum([...SEVERITY_NAMES, 'off']),
  enabled: z.boolean().describe('Whether lint_document runs it'),
  recommended: z.boolean(),
  formats: z.array(z.string()).describe("Formats the rule declares; empty means all of the ruleset's"),
  description: z.string().nullable(),
});

export const ruleDetails = ruleSummary.extend({
  message: z.string().nullable().describe('Message template; {{error}} and similar are filled in per diagnostic'),
  given: z.array(z.string()).describe('JSONPath expressions; #Name refers to an alias of the ruleset'),
  then: z.array(
    z.object({
      function: z.string(),
      field: z.string().optional(),
      functionOptions: z.unknown().optional().describe('Left out when large, such as a whole JSON Schema'),
    }),
  ),
  documentationUrl: z.string().nullable(),
  extensions: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe('Free-form data the ruleset attached, such as extensions.prompt'),
});
