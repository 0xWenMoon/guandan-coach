// Card elements, cached by card id so a card keeps ONE DOM node for its whole
// life. That identity is what lets focus survive a redraw and what future
// FLIP animations will hang off.
import { el, toggle } from '../dom.js';
import { isWild, isJoker, RANK_LABEL, SUIT_SYMBOL } from '../../src/cards.js';

const SIZES = ['small', 'mini'];

function build(card) {
  const node = el('div', { class: 'card', dataset: { id: card.id }, role: 'img' },
    el('span', { class: 'r' }),
    el('span', { class: 's' }),
    el('span', { class: 'wildtag' }));
  const [r, s] = node.children;
  if (isJoker(card)) {
    r.textContent = card.rank === 16 ? '大' : '小';
    s.textContent = '★';
  } else {
    r.textContent = RANK_LABEL[card.rank];
    s.textContent = SUIT_SYMBOL[card.suit];
  }
  return node;
}

export function cardName(card, level) {
  if (isJoker(card)) return card.rank === 16 ? 'big joker' : 'small joker';
  const suit = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' }[card.suit];
  const wild = isWild(card, level) ? ', wildcard' : '';
  return `${RANK_LABEL[card.rank]} of ${suit}${wild}`;
}

function style(node, card, level, size) {
  const joker = isJoker(card);
  const wild = isWild(card, level);
  toggle(node, 'joker', joker);
  // Deliberately NOT "big"/"small": those collide with the size classes.
  toggle(node, 'jbig', joker && card.rank === 16);
  toggle(node, 'red', !joker && (card.suit === 'H' || card.suit === 'D'));
  toggle(node, 'black', !joker && (card.suit === 'S' || card.suit === 'C'));
  toggle(node, 'wild', wild);
  toggle(node, 'levelcard', !wild && card.rank === level);
  for (const s of SIZES) toggle(node, s, size === s);
  node.children[2].textContent = wild ? '百搭' : '';
  node.setAttribute('aria-label', cardName(card, level));
}

export function createCardCache() {
  const cache = new Map();
  return {
    get(card, level, size = '') {
      let node = cache.get(card.id);
      if (!node) { node = build(card); cache.set(card.id, node); }
      style(node, card, level, size);
      return node;
    },
    prune(keep) {
      for (const id of [...cache.keys()]) if (!keep.has(id)) cache.delete(id);
    },
    size: () => cache.size,
  };
}
