#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ConfigError, USAGE, parseConfig } from './config.js';
import { RulesetLoadError, RulesetService } from './rulesets/service.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2), process.env, process.cwd());
  // Not serving MCP, so stdout is free.
  if (config.show === 'version') return void process.stdout.write(`${VERSION}\n`);
  if (config.show === 'help') return void process.stdout.write(USAGE);
  const rulesets = await RulesetService.fromConfig(config.rulesets);
  await createServer({ rulesets, allowExternalRefs: config.allowExternalRefs }).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  // stdout carries the MCP protocol, so errors go to stderr.
  const known = error instanceof ConfigError || error instanceof RulesetLoadError;
  console.error(known ? `openlint-mcp: ${error.message}` : error);
  process.exit(1);
});
