import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigError, parseConfig } from '../config.js';

const cwd = '/work';

describe('parseConfig', () => {
  it('returns no rulesets when nothing is configured', () => {
    expect(parseConfig([], {}, cwd)).toEqual({ rulesets: [] });
  });

  it('reads an unnamed --ruleset as the default and resolves it against cwd', () => {
    expect(parseConfig(['--ruleset', './.openlint.yaml'], {}, cwd).rulesets).toEqual([
      { name: 'default', path: path.resolve(cwd, '.openlint.yaml'), isDefault: true },
    ]);
  });

  it('accepts -r and --ruleset=<value>', () => {
    expect(parseConfig(['-r', 'a.yaml'], {}, cwd).rulesets[0]?.path).toBe(path.resolve(cwd, 'a.yaml'));
    expect(parseConfig(['--ruleset=a.yaml'], {}, cwd).rulesets[0]?.path).toBe(path.resolve(cwd, 'a.yaml'));
  });

  it('uses OPENLINT_RULESET when there is no unnamed --ruleset', () => {
    expect(parseConfig([], { OPENLINT_RULESET: '/rules/env.yaml' }, cwd).rulesets).toEqual([
      { name: 'default', path: '/rules/env.yaml', isDefault: true },
    ]);
    expect(parseConfig([], { OPENLINT_RULESET: '  ' }, cwd).rulesets).toEqual([]);
  });

  it('prefers the --ruleset flag over OPENLINT_RULESET', () => {
    const { rulesets } = parseConfig(['--ruleset', '/rules/flag.yaml'], { OPENLINT_RULESET: '/rules/env.yaml' }, cwd);
    expect(rulesets.map(spec => spec.path)).toEqual(['/rules/flag.yaml']);
  });

  it('adds named rulesets next to the default', () => {
    const { rulesets } = parseConfig(['--ruleset', 'org=./org.yaml', '--ruleset', 'base.yaml'], {}, cwd);
    expect(rulesets).toEqual([
      { name: 'default', path: path.resolve(cwd, 'base.yaml'), isDefault: true },
      { name: 'org', path: path.resolve(cwd, 'org.yaml'), isDefault: false },
    ]);
  });

  it('makes the first named ruleset the default when there is no unnamed one', () => {
    const { rulesets } = parseConfig(['-r', 'org=/org.yaml', '-r', 'team=/team.yaml'], {}, cwd);
    expect(rulesets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
      { name: 'org', isDefault: true },
      { name: 'team', isDefault: false },
    ]);
  });

  it('reads values that are not name=path as paths', () => {
    for (const value of ['./a=b.yaml', 'C:\\rules=x.yaml', '=x.yaml', 'org=']) {
      expect(parseConfig(['--ruleset', value], {}, cwd).rulesets[0]?.name).toBe('default');
    }
  });

  it('rejects two unnamed rulesets', () => {
    expect(() => parseConfig(['-r', 'a.yaml', '-r', 'b.yaml'], {}, cwd)).toThrow(ConfigError);
  });

  it('rejects reserved and duplicate names', () => {
    expect(() => parseConfig(['-r', 'oas=x.yaml'], {}, cwd)).toThrow(/reserved/);
    expect(() => parseConfig(['-r', 'org=a.yaml', '-r', 'org=b.yaml'], {}, cwd)).toThrow(/more than once/);
    expect(() => parseConfig(['-r', 'a.yaml', '-r', 'default=b.yaml'], {}, cwd)).toThrow(/more than once/);
  });

  it('rejects unknown options', () => {
    expect(() => parseConfig(['--rulset', 'a.yaml'], {}, cwd)).toThrow(ConfigError);
    expect(() => parseConfig(['a.yaml'], {}, cwd)).toThrow(ConfigError);
  });
});
