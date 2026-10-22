// Runs in the page. Passed as a string, not a function, because tsx/esbuild can inject
// helpers (e.g. __name) into function bodies that don't exist inside the browser.
// Includes ARIA widgets (custom selects, menus, tabs, toggles) that apps build from divs:
// without them, agents can open a dropdown but never see its options.
export const SCAN_SCRIPT = `(() => {
  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="option"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="combobox"]',
  ].join(', ');
  const visible = (el) => typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : (getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
  const textOf = (el) => (el && (el.innerText || el.textContent)) || '';
  const out = [];
  let next = 0;
  // Ids from the last look stay on elements that have since gone out of sight; the same number
  // given to another element then matches two ("strict mode violation"). Start clean each time.
  for (const el of document.querySelectorAll('[data-debutly-id]')) el.removeAttribute('data-debutly-id');
  for (const el of document.querySelectorAll(selector)) {
    // Apps hide the real file field behind a styled button or drop zone; files can still be
    // attached to it, so list it.
    const fileField = el.tagName === 'INPUT' && el.type === 'file';
    if (el.type === 'hidden' || (!visible(el) && !fileField)) continue;
    const id = next++;
    el.setAttribute('data-debutly-id', String(id));
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'input:' + (el.type || 'text') : tag);
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
      .map((ref) => textOf(document.getElementById(ref))).join(' ');
    // A field's label points at it (for=) or wraps it; a wrapping label's name is its own text,
    // without the field's (a select's options, a textarea's content).
    const field = tag === 'input' || tag === 'select' || tag === 'textarea';
    const labelEl = (field && el.labels && el.labels[0]) || (el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null);
    let label = null;
    if (labelEl) {
      label = labelEl.cloneNode(true);
      label.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
    }
    // title is the accessible name of last resort, as browsers and screen readers treat it.
    // A native select's text is all its options run together: name it by its label, and list them apart.
    const isSelect = tag === 'select';
    const fileHint = fileField ? 'file upload' + (el.getAttribute('accept') ? ' (' + el.getAttribute('accept') + ')' : '') : '';
    const raw = el.getAttribute('aria-label') || labelledBy || (label && label.textContent) || el.getAttribute('placeholder') || (isSelect ? '' : textOf(el).trim()) || el.getAttribute('title') || fileHint;
    const item = { id, role, name: raw.replace(/\\s+/g, ' ').trim().slice(0, 80), tag };
    if (isSelect) {
      const chosen = el.selectedOptions[0];
      item.value = chosen ? chosen.label.slice(0, 80) : '';
      item.options = Array.from(el.options).slice(0, 30).map((o) => o.label.slice(0, 60));
    }
    out.push(item);
  }
  return out;
})()`;
