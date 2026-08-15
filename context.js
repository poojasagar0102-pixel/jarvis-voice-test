// Jarvis - Stage 7: context assembly
//
// Builds the bounded context sent to the LLM. Reuses EXISTING Stage 3
// search and Stage 5 memory functions verbatim - adds no new data
// source. Conversation history lives ONLY in page memory (a plain JS
// array) - never written to localStorage, never treated as "saved,"
// cleared on reload. This is deliberate: Stage 5's explicit-only memory
// rule stays the only way anything persists across sessions.

(function () {
  'use strict';

  const MAX_HISTORY_TURNS = 6; // conversational turns (user+assistant pairs) kept for context
  let history = [];

  function pushHistory(role, text) {
    if (!text) return;
    history.push({ role, content: text });
    const maxEntries = MAX_HISTORY_TURNS * 2;
    if (history.length > maxEntries) {
      history = history.slice(history.length - maxEntries);
    }
  }

  function getHistory() {
    return history.slice();
  }

  function clearHistory() {
    history = [];
  }

  function buildContext(query) {
    const searchResults = (window.JarvisChat && typeof window.JarvisChat.searchFiles === 'function')
      ? window.JarvisChat.searchFiles(query, 3)
      : [];
    const memory = window.JarvisMemory ? window.JarvisMemory.list() : [];
    return {
      searchResults,
      memory,
      history: getHistory(),
    };
  }

  window.JarvisContext = { buildContext, pushHistory, getHistory, clearHistory, MAX_HISTORY_TURNS };
})();
