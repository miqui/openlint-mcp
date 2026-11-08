import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { RulesetService } from './rulesets/service.js';
import { registerExplainRule } from './tools/explain-rule.js';
import { registerLintDocument } from './tools/lint-document.js';
import { registerListRules } from './tools/list-rules.js';
import { registerListRulesets } from './tools/list-rulesets.js';
import { registerValidateRuleset } from './tools/validate-ruleset.js';
import { NAME, VERSION } from './version.js';

export interface ServerDependencies {
  readonly rulesets: RulesetService;
  /** Let `lint_document` follow `$ref`s to files and URLs (`--allow-external-refs`). */
  readonly allowExternalRefs?: boolean;
}

/** Creates the OpenLint MCP server with its tools registered. It is not connected to a transport. */
export function createServer({ rulesets, allowExternalRefs = false }: ServerDependencies): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerLintDocument(server, rulesets, allowExternalRefs);
  registerListRulesets(server, rulesets);
  registerListRules(server, rulesets);
  registerExplainRule(server, rulesets);
  registerValidateRuleset(server, rulesets);
  return server;
}
