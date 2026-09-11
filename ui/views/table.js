// Seats and the pile.
//
// Played cards land on the side of the table the player sits on, angled towards
// the middle, so you can see at a glance who put what down — the way you would
// at a real table. Opponents show a fan of backs that tightens as their hand
// grows, which makes card counts readable without reading a number.
import { el, text, toggle, clear, reconcile } from '../dom.js';
import { createCardCache } from './cards.js';
import { describeCombo } from '../../src/combos.js';
import { PHASE, partnerOf } from '../../src/game.js';

const PLACES = ['1st out 头游', '2nd out 二游', '3rd out 三游', '4th 末游'];
const ARROW = { 0: '▲', 1: '▶', 2: '▼', 3: '◀' };

// How much room each seat's fan of backs may occupy, and the widest gap
// between cards in it.
const FAN = {
  1: { axis: 'v', extent: 190, max: 18, size: 'small' },
  2: { axis: 'h', extent: 240, max: 20, size: 'small' },
  3: { axis: 'v', extent: 190, max: 18, size: 'small' },
};

function backNode(size) {
  return el('div', { class: `card back ${size}`, 'aria-hidden': 'true' });
}

/** Lay out `count` backs so the fan always fits, tightening as the hand grows. */
function renderFan(container, count, spec) {
  const nodes = [];
  const existing = [...container.children];
  for (let i = 0; i < count; i++) nodes.push(existing[i] ?? backNode(spec.size));
  reconcile(container, nodes);
  const gap = count > 1 ? Math.min(spec.max, spec.extent / (count - 1)) : spec.max;
  const prop = spec.axis === 'v' ? 'marginTop' : 'marginLeft';
  for (const [i, node] of nodes.entries()) {
    const value = i === 0 ? '0px' : `${(gap - (spec.axis === 'v' ? 48 : 34)).toFixed(1)}px`;
    if (node.style[prop] !== value) node.style[prop] = value;
  }
}

export function createTableView({ seatRoot, playRoot, labelNode, turnNode, names, human }) {
  const seats = new Map();
  const playCaches = new Map();
  const signatures = new Map();

  for (const seat of [0, 1, 2, 3]) {
    const who = el('div', { class: 'who' },
      el('span', { class: 'nm' }, names[seat]),
      seat === partnerOf(human) ? el('span', { class: 'tag' }, 'partner') : null);
    const count = el('div', { class: 'count' });
    const out = el('div', { class: 'out' });
    const plate = el('div', { class: 'plate' }, who, count, out);
    const backs = seat === human ? null : el('div', { class: `backs ${FAN[seat].axis}` });
    const root = seatRoot(seat);
    // Opponents' fans sit between their nameplate and the middle of the table.
    if (seat === 2) root.append(plate, backs);
    else if (backs) root.append(backs, plate);
    else root.append(plate);
    seats.set(seat, { plate, count, out, backs });
    playCaches.set(seat, createCardCache());
  }

  return function render({ game, thinkingSeat }) {
    const trick = game.trick;

    for (const seat of [0, 1, 2, 3]) {
      const { plate, count, out, backs } = seats.get(seat);
      const active = game.current === seat && game.phase === PHASE.PLAYING;
      toggle(plate, 'active', active);
      toggle(plate, 'partner', seat === partnerOf(human));
      toggle(plate, 'thinking', thinkingSeat === seat);

      const place = game.finished.indexOf(seat);
      const n = game.hands[seat].length;
      text(out, place >= 0 ? PLACES[place] : '');
      text(count, place >= 0 ? '' : thinkingSeat === seat ? `${n} cards · thinking…` : `${n} cards`);
      if (backs) renderFan(backs, place >= 0 ? 0 : Math.min(n, 27), FAN[seat]);

      renderPlay(seat, game, trick, active);
    }

    if (!trick || !trick.target) {
      text(labelNode, 'Free lead — nothing to beat');
    } else {
      text(labelNode, `${names[trick.winner]} holds the trick · beat ${describeCombo(trick.target, game.level)}`);
    }
    text(turnNode, game.phase !== PHASE.PLAYING ? ''
      : game.current === human ? 'Your turn' : `Waiting for ${names[game.current]}`);
  };

  function renderPlay(seat, game, trick, active) {
    const root = playRoot(seat);
    const action = lastAction(trick, seat);
    const signature = !action ? 'none'
      : action.combo ? `p:${action.combo.cards.map((c) => c.id).join(',')}` : 'pass';

    toggle(root, 'winning', !!trick && trick.winner === seat && !!trick.target);
    toggle(root, 'active', active);
    toggle(root, 'empty', !action);

    if (signatures.get(seat) === signature) return;
    signatures.set(seat, signature);
    clear(root);
    if (!action) return;

    const label = el('div', { class: 'plabel' },
      el('span', { class: 'arrow' }, ARROW[seat]),
      el('span', {}, names[seat]));

    if (!action.combo) {
      root.append(el('div', { class: 'passed' }, 'passed'), label);
      return;
    }
    // Rebuilt from scratch on purpose: fresh nodes replay the landing animation.
    const cache = playCaches.get(seat);
    const cards = el('div', { class: 'pcards' },
      ...action.combo.cards.map((c) => cache.get(c, game.level, 'small')));
    cache.prune(new Set(action.combo.cards.map((c) => c.id)));
    root.append(cards, label);
  }
}

function lastAction(trick, seat) {
  if (!trick) return null;
  for (let i = trick.plays.length - 1; i >= 0; i--) {
    if (trick.plays[i].seat === seat) return trick.plays[i];
  }
  return null;
}
