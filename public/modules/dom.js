const SVG_NS = 'http://www.w3.org/2000/svg';

export function byId(id) {
  return document.getElementById(id);
}

export function clear(node) {
  if (node) node.replaceChildren();
  return node;
}

export function text(tag, value, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value == null ? '' : String(value);
  return node;
}

export function icon(name, className = 'ui-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  use.setAttribute('href', `/icons.svg#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function setText(node, value) {
  if (node) node.textContent = value == null ? '' : String(value);
  return node;
}

export function create(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value != null) node.setAttribute(name, String(value));
    }
  }
  node.append(...children.filter(Boolean));
  return node;
}

export function announce(message) {
  const live = byId('a11yLive');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = String(message || ''); });
}

