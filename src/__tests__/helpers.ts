import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Document, OpenLint, type Ruleset } from '@openlint/openlint-core';
import { Yaml } from '@openlint/openlint-parsers';

import type { RulesetResult } from '../rulesets/service.js';
import { RulesetService } from '../rulesets/service.js';
import { createServer } from '../server.js';

/** OpenAPI 3.0 document without `info.title`. */
export const OAS_WITHOUT_TITLE = 'openapi: 3.0.3\ninfo:\n  version: "1.0"\npaths: {}\n';

export async function lintCodes(ruleset: Ruleset, content = OAS_WITHOUT_TITLE): Promise<string[]> {
  const openlint = new OpenLint();
  openlint.setRuleset(ruleset);
  const results = await openlint.run(new Document(content, Yaml, '/document.yaml'));
  return [...new Set(results.map(result => String(result.code)))];
}

export function rulesetOf(result: RulesetResult): Ruleset {
  if (!result.ok) throw new Error(`Expected a ruleset, got issues: ${JSON.stringify(result.issues)}`);
  return result.ruleset;
}

export function issuesOf(result: RulesetResult) {
  if (result.ok) throw new Error('Expected issues, got a ruleset');
  return result.issues;
}

/** Connects a real MCP client to a server over the in-memory transport. */
export async function connect(rulesets: RulesetService = RulesetService.fallback()) {
  const server = createServer({ rulesets });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
