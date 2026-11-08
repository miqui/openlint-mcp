// A JS ruleset whose function options can't be serialized as JSON.
import hasTitle from './functions/hasTitle.js';

const circular = { name: 'loop' };
circular.self = circular;

export default {
  rules: {
    'bigint-options': { given: '$.info', then: { function: hasTitle, functionOptions: { limit: 10n } } },
    'circular-options': { given: '$.info', then: { function: hasTitle, functionOptions: circular } },
  },
};
