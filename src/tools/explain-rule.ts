import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { explainRule } from '../rules.js';
import { formatIssue } from '../rulesets/issues.js';
import type { RulesetService } from '../rulesets/service.js';
import { ruleDetails } from './rule-schemas.js';
import { result } from './schemas.js';

export function registerExplainRule(server: McpServer, rulesets: RulesetService): void {
  server.registerTool(
    'explain_rule',
    {
      title: 'Explain rule',
      description:
        'Explains one rule: what it checks (description, message, given, then), its severity and formats, a ' +
        'documentation link, and `extensions`, free-form data the ruleset attached to the rule, such as ' +
        'guidance for fixing it (`extensions.prompt`).',
      inputSchema: {
        rule: z.string().describe('The rule name, as in a diagnostic code or list_rules'),
        ruleset: z
          .string()
          .optional()
          .describe(
            'A ruleset name from list_rulesets (or oas, asyncapi, arazzo), or an inline YAML/JSON ruleset. Default: the default ruleset.',
          ),
      },
      outputSchema: ruleDetails.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ rule, ruleset }) => {
      const resolved = rulesets.resolve(ruleset);
      if (!resolved.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `The ruleset can't be used:\n${resolved.issues.map(formatIssue).join('\n')}` },
          ],
        };
      }
      const explained = explainRule(resolved.ruleset, rule);
      return explained.ok
        ? result(explained.rule)
        : { isError: true, content: [{ type: 'text', text: explained.message }] };
    },
  );
}
