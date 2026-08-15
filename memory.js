// Jarvis - Stage 5: browser-local memory
//
// IMPORTANT: this stores data in the browser's localStorage - scoped to
// one browser, on one device, for this site's origin. It is NOT a real
// filesystem folder, is NOT synced anywhere, and can be lost by clearing
// browser/site data or switching browsers/devices. See CLAUDE.md.
//
// Writes only happen when explicitly called by chat.js's "remember:"
// command handler - this file never decides on its own what to store.

(function () {
  'use strict';

  const STORAGE_KEY = 'jarvis_memory_v1';
  const MAX_ITEMS = 200;
  const MAX_ITEM_LENGTH = 2000;

  function isStorageAvailable() {
    try {
      const testKey = '__jarvis_storage_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  const available = isStorageAvailable();

  function loadAll() {
    if (!available) return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return []; // corrupted storage - degrade to empty rather than throw
    }
  }

  function saveAll(items) {
    if (!available) return { ok: false, reason: 'localStorage is not available in this browser/context.' };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      return { ok: true };
    } catch (err) {
      // Most likely quota exceeded
      return { ok: false, reason: `Could not save: ${err.message}` };
    }
  }

  function remember(text) {
    if (!available) {
      return { ok: false, reason: 'Browser storage is unavailable, so I cannot remember anything right now.' };
    }
    const trimmed = (text || '').trim();
    if (!trimmed) {
      return { ok: false, reason: 'Nothing to remember - the text after "remember:" was empty.' };
    }
    if (trimmed.length > MAX_ITEM_LENGTH) {
      return { ok: false, reason: `That's too long to store (${trimmed.length} chars, max ${MAX_ITEM_LENGTH}).` };
    }
    const items = loadAll();
    if (items.length >= MAX_ITEMS) {
      return { ok: false, reason: `Memory is full (${MAX_ITEMS} items max). Forget something first, or clear memory.` };
    }
    const item = { id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text: trimmed, storedAt: new Date().toISOString() };
    items.push(item);
    const result = saveAll(items);
    if (!result.ok) return result;
    return { ok: true, item };
  }

  function list() {
    return loadAll();
  }

  function forget(idOrIndex) {
    const items = loadAll();
    let idx = -1;
    if (typeof idOrIndex === 'number') {
      idx = idOrIndex;
    } else {
      idx = items.findIndex((i) => i.id === idOrIndex);
    }
    if (idx < 0 || idx >= items.length) {
      return { ok: false, reason: `No memory item found matching "${idOrIndex}".` };
    }
    const [removed] = items.splice(idx, 1);
    const result = saveAll(items);
    if (!result.ok) return result;
    return { ok: true, removed };
  }

  function clear() {
    const result = saveAll([]);
    return result;
  }

  function exportJSON() {
    const items = loadAll();
    return JSON.stringify(
      { exportedAt: new Date().toISOString(), source: 'jarvis-browser-memory', items },
      null,
      2
    );
  }

  window.JarvisMemory = {
    available,
    remember,
    list,
    forget,
    clear,
    exportJSON,
    MAX_ITEMS,
    MAX_ITEM_LENGTH,
  };
})();
