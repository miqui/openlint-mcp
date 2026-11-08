import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DEFAULT_FILENAME, SEVERITY_NAMES, lintDocument } from '../lint.js';
import { formatIssue } from '../rulesets/issues.js';
import type { RulesetService } from '../rulesets/service.js';
import { result } from './schemas.js';

const position = z.object({ line: z.number().int(), character: z.number().int() });
const range = z.object({ start: position, end: position }).describe('0-based lines and characters');
const location = {
  path: z.array(z.union([z.string(), z.number()])).describe('JSON path of the problem in the document'),
  range,
  source: z.string().optional().describe('Set only for problems in another document, reached through a $ref'),
};
const severity = z.enum(SEVERITY_NAMES);
const flatDiagnostic = z.object({ code: z.string(), severity, message: z.string(), ...location });
const groupedDiagnostic = z.object({
  code: z.string(),
  severity: severity.describe('The most severe in the group'),
  message: z.string().describe("The group's first message"),
  count: z.number().int(),
  first: z.object(location),
});

export function registerLintDocument(server: McpServer, rulesets: RulesetService, allowExternalRefs: boolean): void {
  server.registerTool(
    'lint_document',
    {
      title: 'Lint document',
      description:
        'Lints an OpenAPI (2.0/Swagger, 3.x), AsyncAPI or Arazzo document with an OpenLint ruleset. Pass the ' +
        'document text as `content`. `counts` cover every result, whatever `severity` and `limit` are; ' +
        '`diagnostics` are sorted most severe first, then by code, and grouped by code unless `groupBy` is "none". ' +
        '`formats` lists the formats the ruleset recognized; empty means none. ' +
        (allowExternalRefs
          ? 'External $refs to files and URLs are followed.'
          : 'External $refs to files and URLs are not followed; they are reported as invalid-ref.'),
      inputSchema: {
        content: z.string().describe('The document, as YAML or JSON text'),
        filename: z
          .string()
          .regex(/^[^/\\#?%]+$/, 'A file name, without directories or the characters # ? %')
          .refine(name => name !== '.' && name !== '..', 'A file name, without directories')
          .optional()
          .describe(
            `A name for the document, such as "openapi.json". It is never read from disk. A .json name selects ` +
              `the JSON parser (otherwise YAML), and the ruleset's overrides match against it. Default: ${DEFAULT_FILENAME}.`,
          ),
        ruleset: z
          .string()
          .optional()
          .describe(
            'A ruleset name from list_rulesets (or oas, asyncapi, arazzo), or an inline YAML/JSON ruleset. Default: the default ruleset.',
          ),
        severity: severity
          .default('hint')
          .describe('Leave out diagnostics less severe than this. Counts still include them.'),
        limit: z.number().int().min(1).max(1000).default(50).describe('Most diagnostics (or groups) to return'),
        groupBy: z.enum(['none', 'code']).default('code').describe('"code" returns one entry per rule, with a count'),
      },
      outputSchema: {
        formats: z.array(z.string()),
        counts: z.object({
          error: z.number().int(),
          warn: z.number().int(),
          info: z.number().int(),
          hint: z.number().int(),
        }),
        diagnostics: z.array(z.union([groupedDiagnostic, flatDiagnostic])),
        truncated: z.boolean().describe('Whether `limit` cut the list'),
        notes: z.array(z.string()).describe('Hints about the result, such as unfollowed external $refs'),
      },
      annotations: { readOnlyHint: true, openWorldHint: allowExternalRefs },
    },
    async ({ content, filename, ruleset, severity: threshold, limit, groupBy }, { signal }) => {
      const resolved = rulesets.resolve(ruleset);
      if (!resolved.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `The ruleset can't be used:\n${resolved.issues.map(formatIssue).join('\n')}` },
          ],
        };
      }
      try {
        return result(
          await lintDocument({
            content,
            ruleset: resolved.ruleset,
            filename,
            severity: threshold,
            limit,
            groupBy,
            allowExternalRefs,
            signal,
          }),
        );
      } catch (error) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `Linting failed: ${error instanceof Error ? error.message : String(error)}` },
          ],
        };
      }
    },
  );
}
