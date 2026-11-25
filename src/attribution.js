// Attribution models: which visit(s) get credit for a sale?
//
//   last_touch  - "last non-direct click" (Google Analytics' classic default):
//                 the most recent marketing visit before the sale gets 100%.
//                 Direct visits only win if there was nothing else.
//   first_touch - the visit that first brought the customer gets 100%.
//                 Good for judging which channels *discover* new customers.
//   linear      - every visit in the lookback window shares the credit equally.
import { DIRECT } from './classify.js';

export const MODELS = ['last_touch', 'first_touch', 'linear'];

const isDirect = (t) => t.source === DIRECT.source;

/**
 * @param {Array<{source,medium,campaign,created_at}>} touches  One visitor's touches, oldest first.
 * @param {string} conversionTime ISO timestamp of the sale.
 * @param {string} model
 * @param {number} lookbackMs
 * @returns {Array<{touch: object, credit: number}>} credits summing to 1
 */
export function creditTouches(touches, conversionTime, model, lookbackMs) {
  const end = Date.parse(conversionTime);
  const start = end - lookbackMs;
  const eligible = touches.filter((t) => {
    const ts = Date.parse(t.created_at);
    return ts <= end && ts >= start;
  });

  if (eligible.length === 0) return [{ touch: DIRECT, credit: 1 }];

  switch (model) {
    case 'first_touch':
      return [{ touch: eligible[0], credit: 1 }];
    case 'linear':
      return eligible.map((touch) => ({ touch, credit: 1 / eligible.length }));
    case 'last_touch': {
      const marketing = eligible.filter((t) => !isDirect(t));
      return [{ touch: (marketing.length ? marketing : eligible).at(-1), credit: 1 }];
    }
    default:
      throw new Error(`Unknown attribution model: ${model}`);
  }
}
