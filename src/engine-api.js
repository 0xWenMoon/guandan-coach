// The engine's request handler. The web worker and the headless UI test both
// go through this, so there is exactly one code path to get wrong.
import { restore } from './serialize.js';
import { analyze } from './bot.js';
import { review } from './coach.js';

export function handle({ cmd, snap, seat, move, opts }) {
  const game = restore(snap);
  switch (cmd) {
    case 'bot': {
      const a = analyze(game, seat, opts);
      return { move: a.best?.move ?? null, samples: a.samples, elapsedMs: a.elapsedMs };
    }
    case 'review':
      return review(game, seat, move, opts);
    case 'hint': {
      const a = analyze(game, seat, opts);
      return { move: a.best?.move ?? null, ranked: a.ranked.slice(0, 5), samples: a.samples };
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}
