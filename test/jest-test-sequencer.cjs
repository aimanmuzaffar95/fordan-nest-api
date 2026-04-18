'use strict';

const DefaultSequencer = require('@jest/test-sequencer').default;

/**
 * Deterministic suite order: shallow / health first, domain services, then HTTP controllers.
 * (Jest’s default sequencer optimizes by cache timing and file size; this keeps a stable
 * “low → high” layering for this repo’s small spec set.)
 */
const SUITE_ORDER = [
  'app.controller.spec.ts',
  'auth.service.spec.ts',
  'customers.service.spec.ts',
  'alerts.service.spec.ts',
  'customers.controller.spec.ts',
  'alerts.controller.spec.ts',
];

function suiteRank(test) {
  const base = test.path.replace(/\\/g, '/').split('/').pop() ?? '';
  const idx = SUITE_ORDER.indexOf(base);
  return idx === -1 ? 1_000 : idx;
}

class LayeredTestSequencer extends DefaultSequencer {
  sort(tests) {
    return [...tests].sort((a, b) => {
      const ra = suiteRank(a);
      const rb = suiteRank(b);
      if (ra !== rb) return ra - rb;
      return a.path.localeCompare(b.path);
    });
  }
}

module.exports = LayeredTestSequencer;
