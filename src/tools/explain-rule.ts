import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { rulesetForDocument } from '../lint.js';
import { explainRule } from '../rules.js';
import { formatIssue } from '../rulesets/issues.js';
import type { RulesetService } from '../rulesets/service.js';
import { ruleDetails } from './rule-schemas.js';
import { lookupFilename, result, rulesetArgument } from './schemas.js';

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
        ruleset: rulesetArgument,
        filename: lookupFilename,
      },
      outputSchema: ruleDetails.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ rule, ruleset, filename }) => {
      const resolved = rulesets.resolve(ruleset);
      if (!resolved.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `The ruleset can't be used:\n${resolved.issues.map(formatIssue).join('\n')}` },
          ],
        };
      }
      const explained = explainRule(rulesetForDocument(resolved.ruleset, filename), rule, rulesets.functionName);
      return explained.ok
        ? result(explained.rule)
        : { isError: true, content: [{ type: 'text', text: explained.message }] };
    },
  );
}
