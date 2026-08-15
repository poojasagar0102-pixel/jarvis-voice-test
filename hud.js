// Jarvis - Stage 6/7 - HUD decoration controller
//
// PURELY DECORATIVE. This file does not call any Stage 1-5 function, does
// not modify any existing element's id/content/behavior, and does not
// change routing, search, voice, or memory logic in any way. It only
// *observes* DOM state that chat.js/voice.js/memory-ui.js already expose
// (via MutationObserver), and *defines* one hook function
// (window.JARVIS_ON_STATE_CHANGE) that Stage 7's chat.js/llm.js call at
// real decision points - the same producer/consumer pattern
// memory-ui.js already uses for JARVIS_ON_MEMORY_CHANGE.
//
// If this file fails to load entirely, every Stage 1-5 feature still
// works exactly as before - confirmed by the Stage 6 test suite, and the
// Stage 7 hook calls are all defensive (typeof === 'function' checks) so
// their absence changes nothing either.

(function () {
  'use strict';

  const core = document.getElementById('hud-core');
  const coreLabel = document.getElementById('hud-core-label');
  const micBtn = document.getElementById('mic-btn');
  const chatLog = document.getElementById('chat-log');
  const modelBadge = document.getElementById('model-badge');

  if (!core) return; // HUD markup not present - nothing to decorate

  function setCoreState(state, label) {
    core.dataset.hudState = state;
    if (coreLabel && label) coreLabel.textContent = label;
  }

  // Stage 7: real system-busy states take priority over the mic's idle
  // state when both are true (e.g. thinking about a typed query while
  // voice mode happens to be off). If the system isn't busy, the core
  // just reflects voice.js's actual mic state, same as Stage 6.
  const SYSTEM_BUSY_LABELS = {
    searching: 'SEARCHING', thinking: 'THINKING', tool_executing: 'TOOL EXECUTION',
  };
  let currentSystemState = 'idle';

  function currentMicState() {
    if (!micBtn) return { state: 'idle', label: 'STANDBY' };
    const state = micBtn.dataset.state || 'idle';
    const labels = {
      idle: 'STANDBY', listening: 'LISTENING', processing: 'PROCESSING',
      speaking: 'TRANSMITTING', error: 'FAULT', unavailable: 'VOICE OFFLINE',
    };
    return { state, label: labels[state] || state.toUpperCase() };
  }

  function refreshCore() {
    if (SYSTEM_BUSY_LABELS[currentSystemState]) {
      setCoreState(currentSystemState, SYSTEM_BUSY_LABELS[currentSystemState]);
      return;
    }
    const mic = currentMicState();
    setCoreState(mic.state, mic.label);
  }

  refreshCore();

  // Mirror voice.js's existing data-state on #mic-btn - read-only.
  if (micBtn) {
    new MutationObserver(refreshCore).observe(micBtn, { attributes: true, attributeFilter: ['data-state'] });
  }

  // Stage 7 hook: chat.js/llm.js call this at real decision points
  // (searching/thinking/tool_executing/idle) - never as a cosmetic
  // default. If a state is never actually entered (e.g. no tool call
  // happened), TOOL EXECUTION never displays.
  window.JARVIS_ON_STATE_CHANGE = function (state) {
    currentSystemState = state || 'idle';
    refreshCore();
  };

  // Brief pulse on every new chat message, purely visual, doesn't read
  // or alter message content.
  if (chatLog) {
    new MutationObserver((mutations) => {
      const addedNodes = mutations.reduce((n, m) => n + m.addedNodes.length, 0);
      if (addedNodes === 0) return;
      core.classList.add('hud-core-pulse');
      setTimeout(() => core.classList.remove('hud-core-pulse'), 700);
    }).observe(chatLog, { childList: true });
  }

  // Reflect MODEL OFFLINE in the HUD core ring color without touching
  // the badge element itself.
  if (modelBadge) {
    const applyModelState = () => {
      const offline = modelBadge.classList.contains('offline');
      core.classList.toggle('hud-core-offline', offline);
    };
    applyModelState();
    new MutationObserver(applyModelState).observe(modelBadge, { attributes: true, attributeFilter: ['class'] });
  }
})();

