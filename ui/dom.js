// Minimal DOM helpers. No innerHTML anywhere in the view layer.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    // Duck-typed rather than `instanceof Node`: works across realms (iframes)
    // and outside a real browser (the headless tests).
    else node.append(isNode(c) ? c : document.createTextNode(String(c)));
  }
}

const isNode = (v) => typeof v === 'object' && v !== null && typeof v.nodeType === 'number';

/** Set textContent only when it actually changed, so the DOM stays quiet. */
export function text(node, value) {
  const s = value == null ? '' : String(value);
  if (node.textContent !== s) node.textContent = s;
}

export function toggle(node, cls, on) {
  if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}

export function enable(node, on) {
  if (node.disabled !== !on) node.disabled = !on;
}

/**
 * Make `root`'s children exactly `nodes`, in order, reusing the nodes given.
 * Existing elements keep their identity — which is what makes focus, scroll
 * position, and (later) card animations possible.
 */
export function reconcile(root, nodes) {
  let i = 0;
  for (const node of nodes) {
    const current = root.childNodes[i];
    if (current !== node) root.insertBefore(node, current ?? null);
    i++;
  }
  while (root.childNodes.length > nodes.length) root.lastChild.remove();
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}
