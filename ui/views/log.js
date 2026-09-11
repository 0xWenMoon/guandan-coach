// Append-only table log.
import { el, clear } from '../dom.js';
import { describeCombo } from '../../src/combos.js';
import { RANK_LABEL, SUIT_SYMBOL, isJoker } from '../../src/cards.js';

const cardText = (c) => (isJoker(c) ? (c.rank === 16 ? '大王' : '小王') : SUIT_SYMBOL[c.suit] + RANK_LABEL[c.rank]);

export function createLogView(root, { names, human }) {
  let index = 0;

  function line(e, level) {
    const n = (seat) => el('b', {}, names[seat]);
    switch (e.kind) {
      case 'deal': return [`— Deal ${e.deal}, playing at ${RANK_LABEL[e.level]} —`];
      case 'play': return [n(e.seat), ` plays ${describeCombo(e.combo, level)} (${e.remaining} left)`];
      case 'pass': return [n(e.seat), ' passes'];
      case 'out': return [n(e.seat), ` is out — place ${e.place}`];
      case 'jiefeng': return [n(e.seat), ' takes the lead (接风, partner went out)'];
      case 'tribute': return [n(e.from), ` pays tribute ${cardText(e.card)} to `, n(e.to)];
      case 'return': return [n(e.from), ` returns ${cardText(e.card)} to `, n(e.to)];
      case 'resist': return ['Tribute refused (抗贡) — both big jokers held'];
      case 'dealOver': return [`— Deal over: ${names[e.order[0]]} first, +${e.gain} level${e.gain > 1 ? 's' : ''} —`];
      default: return null;
    }
  }

  return {
    render(game) {
      for (; index < game.log.length; index++) {
        const e = game.log[index];
        const parts = line(e, game.level);
        if (!parts) continue;
        const mine = e.seat === human || e.from === human || e.to === human;
        root.append(el('li', { class: mine ? 'you' : null }, ...parts));
      }
      root.scrollTop = root.scrollHeight;
    },
    reset() { index = 0; clear(root); },
  };
}
