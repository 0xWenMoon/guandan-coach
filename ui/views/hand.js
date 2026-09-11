// Your hand. One click listener for the whole row, and cards keep their nodes.
import { reconcile, toggle } from '../dom.js';
import { createCardCache } from './cards.js';

function setVar(node, name, value) {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

export function createHandView(root, { onToggle }) {
  const cache = createCardCache();

  const hit = (e) => (e.target.closest ? e.target.closest('.card') : null);
  root.addEventListener('click', (e) => {
    if (root.dataset.interactive !== 'true') return;
    const node = hit(e);
    if (node?.dataset.id) onToggle(node.dataset.id);
  });
  root.addEventListener('keydown', (e) => {
    if (root.dataset.interactive !== 'true') return;
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    const node = hit(e);
    if (!node?.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    onToggle(node.dataset.id);
  });

  return function render({ cards, level, selected, interactive }) {
    root.dataset.interactive = interactive ? 'true' : 'false';
    toggle(root, 'locked', !interactive);
    const last = cards.length - 1;
    const nodes = cards.map((card, i) => {
      const node = cache.get(card, level, '');
      toggle(node, 'sel', selected.has(card.id));
      // Cards of the same rank squeeze together into one stack; a new rank
      // starts a new stack. That is how a hand actually sits in your fingers.
      toggle(node, 'stack-start', i === 0 || cards[i - 1].rank !== card.rank);
      // A gentle fan, strongest at the ends.
      const t = last > 0 ? (i / last) * 2 - 1 : 0;
      setVar(node, '--tilt', `${(t * 2.6).toFixed(2)}deg`);
      setVar(node, '--lift', `${(Math.abs(t) ** 2 * 7).toFixed(1)}px`);
      node.style.zIndex = String(i);
      node.tabIndex = interactive ? 0 : -1;
      node.setAttribute('role', interactive ? 'button' : 'img');
      node.setAttribute('aria-pressed', selected.has(card.id) ? 'true' : 'false');
      return node;
    });
    cache.prune(new Set(cards.map((c) => c.id)));
    reconcile(root, nodes);
  };
}
