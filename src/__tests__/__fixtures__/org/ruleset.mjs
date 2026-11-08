// A JS ruleset that imports a package ruleset and a local custom function.
import { oas } from '@openlint/openlint-rulesets';

import hasTitle from './functions/hasTitle.js';

export default {
  extends: [oas],
  rules: {
    'org-title': { given: '$.info', severity: 'error', then: { function: hasTitle } },
  },
};
