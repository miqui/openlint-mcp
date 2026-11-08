import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { rulesetForDocument } from '../lint.js';
import { listRules } from '../rules.js';
import { formatIssue } from '../rulesets/issues.js';
import type { RulesetService } from '../rulesets/service.js';
import { ruleSummary } from './rule-schemas.js';
import { lookupFilename, result, rulesetArgument } from './schemas.js';

export function registerListRules(server: McpServer, rulesets: RulesetService): void {
  server.registerTool(
    'list_rules',
    {
      title: 'List rules',
      description:
        "Lists a ruleset's rules, sorted by name. `format` keeps the rules that apply to documents of that format: " +
        'oas3.1 includes rules for OpenAPI 3.1 and 3.x; oas3 includes rules for every OpenAPI 3 version. ' +
        'Rules that overrides in the ruleset add or turn off for a document are included when `filename` matches them. ' +
        'Use explain_rule for one rule in detail.',
      inputSchema: {
        ruleset: rulesetArgument,
        filename: lookupFilename,
        format: z
          .string()
          .optional()
          .describe('A format such as oas2 (or swagger), oas3, oas3.1, asyncapi2, asyncapi3 or arazzo1.0'),
        enabledOnly: z.boolean().default(true).describe('Only rules that lint_document runs'),
      },
      outputSchema: { rules: z.array(ruleSummary) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ruleset, filename, format, enabledOnly }) => {
      const resolved = rulesets.resolve(ruleset);
      if (!resolved.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `The ruleset can't be used:\n${resolved.issues.map(formatIssue).join('\n')}` },
          ],
        };
      }
      const listed = listRules(rulesetForDocument(resolved.ruleset, filename), { format, enabledOnly });
      return listed.ok
        ? result({ rules: listed.rules })
        : { isError: true, content: [{ type: 'text', text: listed.message }] };
    },
  );
}
