// Jarvis - Stage 5: Memory panel UI
//
// Purely a renderer over public/memory.js's storage engine. Does not
// itself decide what to store - the only write path is chat.js's
// explicit "remember:" command handler. This file only lists, deletes,
// clears, and exports what's already there.

(function () {
  'use strict';

  const badge = document.getElementById('memory-badge');
  const listEl = document.getElementById('memory-list');
  const exportBtn = document.getElementById('memory-export-btn');
  const clearBtn = document.getElementById('memory-clear-btn');

  if (!badge || !listEl || !exportBtn || !clearBtn) return; // panel not present

  if (!window.JarvisMemory) {
    badge.textContent = 'Memory: Unavailable';
    badge.classList.add('offline');
    listEl.innerHTML = '<div class="memory-empty">memory.js did not load - memory features are unavailable.</div>';
    exportBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  if (!window.JarvisMemory.available) {
    badge.textContent = 'Memory: Unavailable in this browser';
    badge.classList.add('offline');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function render() {
    const items = window.JarvisMemory.list();
    if (items.length === 0) {
      listEl.innerHTML = '<div class="memory-empty">Nothing remembered yet. Type "remember: &lt;fact&gt;" in the chat to store something.</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'memory-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="memory-text">${escapeHtml(item.text)}</div>` +
        `<div class="memory-meta">#${i + 1} · stored ${new Date(item.storedAt).toLocaleString()}</div>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Forget';
      btn.addEventListener('click', () => {
        window.JarvisMemory.forget(item.id);
        render();
      });
      row.appendChild(left);
      row.appendChild(btn);
      listEl.appendChild(row);
    });
  }

  exportBtn.addEventListener('click', () => {
    const json = window.JarvisMemory.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener('click', () => {
    const items = window.JarvisMemory.list();
    if (items.length === 0) return;
    const confirmed = window.confirm(`Clear all ${items.length} memory item(s)? This cannot be undone.`);
    if (!confirmed) return;
    window.JarvisMemory.clear();
    render();
  });

  // Chat's "remember:"/"forget:"/"clear memory" commands call this hook
  // (see chat.js) so the panel stays live without polling.
  window.JARVIS_ON_MEMORY_CHANGE = render;

  render();
})();
