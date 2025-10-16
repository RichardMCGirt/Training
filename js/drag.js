/* ============================================================
 * Drag-to-reorder for Multiple Choice options (FIXED + DEBUG)
 * Resolves items as direct children of the container (no :scope).
 * Container: #options (each OPTION ROW is a direct child element)
 * Optional handle: .handle / [data-handle] / .drag
 * ============================================================ */
(function () {
  const DEBUG = true;
  const TAG = "[OptionDrag]";
  const LOG = {
    info: (...a) => DEBUG && console.log(TAG, ...a),
    warn: (...a) => DEBUG && console.warn(TAG, ...a),
    error: (...a) => DEBUG && console.error(TAG, ...a),
    group: (label) => DEBUG && console.group(`${TAG} ${label}`),
    groupEnd: () => DEBUG && console.groupEnd(),
  };

  function initOptionDrag(cfg = {}) {
    LOG.group("init");
    const container = typeof cfg.container === 'string'
      ? document.querySelector(cfg.container)
      : cfg.container;

    if (!container) {
      LOG.error("container not found", cfg.container);
      LOG.groupEnd();
      return;
    }

    // We will treat each DIRECT CHILD of container as an item.
    // No combinators in selectors; we’ll use container.children.
    const handleSelector = cfg.handleSelector || '.handle, [data-handle], .drag';

    LOG.info("container:", container);
    LOG.info("item model: direct children of container");
    LOG.info("handleSelector:", handleSelector);

    container.setAttribute('role', container.getAttribute('role') || 'list');

    const getItems = () => {
      const arr = Array.from(container.children).filter(n => n.nodeType === 1);
      LOG.info("getItems ->", arr.length, "items");
      return arr;
    };

    // Convert any node to the direct child item that contains it.
    function getDirectChildItem(node) {
      if (!node) return null;
      let cur = node.nodeType === 1 ? node : node.parentElement;
      while (cur && cur.parentElement !== container) {
        cur = cur.parentElement;
      }
      // Now cur is either a direct child of container, or null/root
      if (cur && cur.parentElement === container) return cur;
      return null;
    }

    function upgradeItems() {
      LOG.group("upgradeItems");
      const items = getItems();
      if (!items.length) LOG.warn("No option items found under container.");
      items.forEach((el, i) => {
        el.setAttribute('role', el.getAttribute('role') || 'listitem');
        if (el.tabIndex === undefined || el.tabIndex === null) el.tabIndex = 0;
        el.dataset.index = String(i);
        el.draggable = true;

        const handle = el.matches(handleSelector) ? el : el.querySelector(handleSelector);
        if (handle) {
          handle.style.cursor = 'grab';
          handle.addEventListener('mousedown', () => {
            el._dragByHandle = true;
            LOG.info("mousedown on handle → will allow drag", { index: i });
          });
          document.addEventListener('mouseup', () => { el._dragByHandle = false; }, { once: true });
        } else {
          LOG.info("no explicit handle in item", { index: i });
        }

        el.addEventListener('keydown', (e) => {
          if (!e.altKey) return;
          if (e.key === 'ArrowUp') { e.preventDefault(); LOG.info("keyboard move ↑", { from: i }); moveItem(el, -1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); LOG.info("keyboard move ↓", { from: i }); moveItem(el, +1); }
        });
      });
      LOG.groupEnd();
    }

    upgradeItems();

    const mo = new MutationObserver((muts) => {
      LOG.group("MutationObserver");
      LOG.info("mutations:", muts.map(m => ({ type: m.type, added: m.addedNodes?.length || 0, removed: m.removedNodes?.length || 0 })));
      upgradeItems();
      LOG.groupEnd();
    });
    mo.observe(container, { childList: true, subtree: false });

    // ---- Drag events
    let draggingEl = null;
    let lastOverTick = 0;

    container.addEventListener('dragstart', (e) => {
      // Find the direct child item for the event target
      const item = getDirectChildItem(e.target);
      if (!item) {
        LOG.warn("dragstart on non-item or outside container", e.target);
        return;
      }

      const handle = item.matches(handleSelector) ? item : item.querySelector(handleSelector);
      if (handle && !item._dragByHandle) {
        const path = e.composedPath?.() || [];
        if (!path.includes(handle)) {
          LOG.warn("dragstart blocked: must begin on handle", { index: item.dataset.index });
          e.preventDefault();
          return;
        }
      }

      draggingEl = item;
      item.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; } catch {}
      try { e.dataTransfer.setData('text/plain', item.dataset.index || ''); } catch {}
      LOG.info("dragstart", { index: item.dataset.index, text: getOptionLabel(item) });
    });

    container.addEventListener('dragend', () => {
      if (draggingEl) {
        LOG.info("dragend", { finalIndex: draggingEl.dataset.index });
        draggingEl.classList.remove('dragging');
      } else {
        LOG.warn("dragend fired with no draggingEl");
      }
      draggingEl = null;
      renumber();
    });

    container.addEventListener('dragover', (e) => {
      if (!draggingEl) return;
      e.preventDefault();
      lastOverTick = performance.now ? performance.now() : Date.now();

      const afterEl = getDragAfterDirectChild(container, e.clientY, draggingEl);
      if (!afterEl) {
        if (draggingEl.nextSibling !== null) {
          LOG.info("dragover → append to end");
          container.appendChild(draggingEl);
        }
      } else if (afterEl !== draggingEl) {
        LOG.info("dragover → insertBefore", {
          moving: getOptionLabel(draggingEl),
          before: getOptionLabel(afterEl)
        });
        container.insertBefore(draggingEl, afterEl);
      }
    });

    container.addEventListener('drop', (e) => {
      if (!draggingEl) {
        LOG.warn("drop with no draggingEl");
        return;
      }
      e.preventDefault();

      const afterEl = getDragAfterDirectChild(container, e.clientY, draggingEl);
      if (!afterEl) {
        LOG.info("drop → append to end");
        container.appendChild(draggingEl);
      } else if (afterEl !== draggingEl) {
        LOG.info("drop → insertBefore", {
          moving: getOptionLabel(draggingEl),
          before: getOptionLabel(afterEl)
        });
        container.insertBefore(draggingEl, afterEl);
      } else {
        LOG.info("drop → position unchanged");
      }
      renumber();

      const now = performance.now ? performance.now() : Date.now();
      if (!lastOverTick || now - lastOverTick > 1000) {
        LOG.warn("drop completed but dragover may not have fired (check overlays / pointer-events).");
      }
    });

    function moveItem(el, delta) {
      const items = getItems();
      const idx = items.indexOf(el);
      if (idx < 0) { LOG.warn("moveItem: element not in list", el); return; }
      const newIdx = clamp(idx + delta, 0, items.length - 1);
      if (newIdx === idx) { LOG.info("moveItem: no-op (boundary)", { idx, delta }); return; }
      const ref = items[newIdx + (delta > 0 ? 1 : 0)] || null;
      LOG.info("moveItem:", { from: idx, to: newIdx, refExists: !!ref });
      container.insertBefore(el, ref);
      el.focus();
      renumber();
    }

    function renumber() {
      LOG.group("renumber");
      const items = getItems();
      const order = [];
      const indices = [];

      items.forEach((el, i) => {
        el.dataset.index = String(i);
        indices.push(i);
        const label = getOptionLabel(el) || `#${i + 1}`;
        order.push(label);
        const orderInput = el.querySelector('.opt-order');
        if (orderInput) {
          orderInput.value = String(i + 1);
          LOG.info("set .opt-order", { i: i + 1, label });
        }
      });

      LOG.info("new order:", order);
      container.dispatchEvent(new CustomEvent('options:reordered', { detail: { order, indices } }));
      LOG.groupEnd();
    }

    // Compute the element that should come *after* the dragged item, using direct children only.
    function getDragAfterDirectChild(list, y, ignoreEl) {
      const children = Array.from(list.children).filter(el => el !== ignoreEl);
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
      for (const child of children) {
        const box = child.getBoundingClientRect();
        const offset = y - (box.top + box.height / 2);
        if (offset < 0 && offset > closest.offset) {
          closest = { offset, element: child };
        }
      }
      return closest.element;
    }

    function getOptionLabel(el) {
      const txt =
        el.querySelector('input[type="text"]')?.value?.trim() ||
        el.querySelector('textarea')?.value?.trim() ||
        el.textContent?.trim();
      return (txt || '').slice(0, 80);
    }

    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    // Quick self-checks
    setTimeout(() => {
      const style = getComputedStyle(container);
      if (style.display === 'contents') LOG.warn("container uses display: contents; drag hit-testing may be odd.");
      if (style.pointerEvents === 'none') LOG.warn("container has pointer-events:none; dragover/drop will fail.");
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) LOG.warn("container has zero size; hit testing will fail.");
      LOG.info("container box:", rect);
    }, 0);

    LOG.groupEnd();
    return { refresh: upgradeItems, renumber };
  }

  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('options');
    if (!el) { console.warn("[OptionDrag] #options not found on DOMContentLoaded."); return; }
    const api = initOptionDrag({ container: el });
    window.OptionDrag = api;
  });
})();
