// Jarvis - Stage 4: voice input/output + reactor
//
// Everything here is additive to Stage 3. If this file fails to load, or
// none of the required browser APIs exist, Stage 3's text chat is
// completely unaffected - chat.js has no dependency on this file.
//
// DISCLOSURE: this uses the browser's built-in SpeechRecognition API for
// speech-to-text. On most browsers (including Chrome for Android) that
// API sends captured audio to the browser vendor's servers to do the
// transcription - it is not fully on-device. This is free (no API key,
// no cost to you) but it is a real network call, unlike every other part
// of this app, which makes none. Text-to-speech (speechSynthesis) may
// also use on-device or cloud voices depending on your browser/OS.
//
// No LLM is involved anywhere in this file. Voice input is transcribed
// speech fed into the exact same offline router/search used by typed
// text (window.JarvisChat.handleQuery) - never a separate "smarter" path.

(function () {
  'use strict';

  const micBtn = document.getElementById('mic-btn');
  const voiceStatus = document.getElementById('voice-status');
  const reactorCanvas = document.getElementById('reactor-canvas');
  const reactorCtx = reactorCanvas ? reactorCanvas.getContext('2d') : null;

  if (!micBtn || !voiceStatus || !window.JarvisChat) {
    // Stage 3 UI elements/hook not present - nothing to wire up.
    return;
  }

  // ---------- State ----------
  // Declared before feature detection below, because the degrade branch
  // calls setStatus() immediately, and setStatus() reads/writes `state`.
  // (A `let` declared later in this scope is in the temporal dead zone
  // until its own line runs - calling a function that touches it any
  // earlier throws. Caught by voice-engine test 8, fixed here.)
  // idle -> listening -> processing -> speaking -> (listening again, if
  // still in voice mode) or idle (if voice mode turned off)
  let state = 'idle';
  let voiceModeEnabled = false;
  let recognition = null;
  let audioStream = null;
  let audioCtx = null;
  let analyser = null;
  let levelIntervalId = null; // setInterval, per the Stage 4 spec - NOT requestAnimationFrame

  function setStatus(newState, message) {
    state = newState;
    voiceStatus.textContent = message;
    voiceStatus.dataset.state = newState;
    micBtn.dataset.state = newState;
    micBtn.textContent = newState === 'listening' ? '●' : newState === 'speaking' ? '▮' : newState === 'processing' ? '…' : '🎙';
  }

  // ---------- Feature detection (degrade loudly, never silently) ----------
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sttAvailable = !!SpeechRecognitionCtor;
  const ttsAvailable = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const micAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function missingCapabilities() {
    const missing = [];
    if (!sttAvailable) missing.push('speech recognition');
    if (!ttsAvailable) missing.push('speech synthesis');
    if (!micAvailable) missing.push('microphone access (getUserMedia)');
    return missing;
  }

  const missing = missingCapabilities();
  if (missing.length > 0) {
    micBtn.disabled = true;
    micBtn.title = `Voice unavailable: this browser is missing ${missing.join(', ')}.`;
    setStatus('unavailable', `VOICE UNAVAILABLE — this browser is missing: ${missing.join(', ')}.`);
    return; // nothing below this point can safely run
  }

  setStatus('idle', 'Voice off. Tap the mic to enable.');

  // ---------- Reactor: setInterval-driven level meter ----------
  // Deliberately setInterval, not requestAnimationFrame: RAF stops
  // entirely in a backgrounded tab, which would make the mic look "dead"
  // with no indication why. setInterval keeps running (throttled, but not
  // stopped) in the background.
  function drawReactor(level) {
    if (!reactorCtx) return;
    const w = reactorCanvas.width, h = reactorCanvas.height;
    reactorCtx.clearRect(0, 0, w, h);
    const bars = 20;
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      // Deterministic pseudo-variation per bar from the single real level
      // reading - not fabricated audio data, just a visual spread of one
      // real measurement so the bars aren't all identical heights.
      const wobble = 0.5 + 0.5 * Math.sin(i * 1.3 + level * 10);
      const barH = Math.max(2, level * h * wobble);
      reactorCtx.fillStyle = '#38d9f0';
      reactorCtx.globalAlpha = 0.35 + level * 0.65;
      reactorCtx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
    }
    reactorCtx.globalAlpha = 1;
  }

  function clearReactor() {
    if (!reactorCtx) return;
    reactorCtx.clearRect(0, 0, reactorCanvas.width, reactorCanvas.height);
  }

  function startLevelMeter(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    levelIntervalId = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length); // real measured level, 0..~1
      drawReactor(Math.min(1, rms * 4));
    }, 50);
  }

  function stopLevelMeter() {
    if (levelIntervalId) { clearInterval(levelIntervalId); levelIntervalId = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    analyser = null;
    clearReactor();
  }

  // ---------- Microphone stream (for the reactor; independent of SpeechRecognition's own mic use) ----------
  function acquireMic() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      audioStream = stream;
      startLevelMeter(stream);
    });
  }

  function releaseMic() {
    stopLevelMeter();
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
  }

  // ---------- Speech recognition (single-shot per turn, not continuous streaming) ----------
  function createRecognition() {
    const r = new SpeechRecognitionCtor();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';

    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setStatus('processing', `Heard: "${transcript}" — routing…`);
      window.JarvisChat.handleQuery(transcript);
      // The assistant's response, once rendered, triggers speak() via the
      // JARVIS_ON_ASSISTANT_MESSAGE hook below.
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech') {
        // Not a real failure - just nothing heard. Restart quietly if still in voice mode.
        if (voiceModeEnabled) startListening();
        else setStatus('idle', 'Voice off.');
        return;
      }
      setStatus('error', `Speech recognition error: ${e.error}. Tap the mic to try again.`);
      voiceModeEnabled = false;
      releaseMic();
    };

    r.onend = () => {
      // Recognition stopped (either we stopped it, or it timed out).
      // Only auto-restart if we're still supposed to be listening and
      // nothing else (processing/speaking) has taken over.
      if (voiceModeEnabled && state === 'listening') {
        startListening();
      }
    };

    return r;
  }

  function startListening() {
    if (!voiceModeEnabled) return;
    try {
      recognition = createRecognition();
      recognition.start();
      setStatus('listening', 'Listening… speak now.');
    } catch (err) {
      setStatus('error', `Could not start listening: ${err.message}`);
      voiceModeEnabled = false;
      releaseMic();
    }
  }

  function stopListeningInternal() {
    if (recognition) {
      recognition.onend = null; // prevent auto-restart from the stop we're about to trigger
      try { recognition.stop(); } catch (err) { /* already stopped */ }
      recognition = null;
    }
  }

  // ---------- Text-to-speech ----------
  function speak(text) {
    if (!text) {
      // Nothing to say - go straight back to listening if still in voice mode.
      if (voiceModeEnabled) startListening(); else setStatus('idle', 'Voice off.');
      return;
    }
    // Mic must be deaf while Jarvis speaks, or it transcribes itself.
    stopListeningInternal();
    setStatus('speaking', 'Jarvis is speaking…');

    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => {
      if (voiceModeEnabled) startListening();
      else setStatus('idle', 'Voice off.');
    };
    utter.onerror = () => {
      setStatus('error', 'Speech synthesis failed.');
      if (voiceModeEnabled) startListening();
    };
    window.speechSynthesis.speak(utter);
  }

  // Hook from chat.js: fires after every assistant message is rendered,
  // whether the query came from voice or typed text. If voice mode is on,
  // Jarvis speaks the response; if not, this is a no-op.
  window.JARVIS_ON_ASSISTANT_MESSAGE = function (kind, speakText) {
    if (!voiceModeEnabled) return;
    speak(speakText);
  };

  // ---------- Barge-in ----------
  // Explicit actions only, per spec: mic button, Space, or Esc. Never
  // relies on the mic accidentally picking up the user's voice over
  // Jarvis's own output.
  function bargeIn() {
    if (state === 'speaking') {
      window.speechSynthesis.cancel();
      if (voiceModeEnabled) startListening();
    }
  }

  function disableVoiceMode() {
    voiceModeEnabled = false;
    window.speechSynthesis.cancel();
    stopListeningInternal();
    releaseMic();
    setStatus('idle', 'Voice off. Tap the mic to enable.');
  }

  function enableVoiceMode() {
    voiceModeEnabled = true;
    setStatus('processing', 'Requesting microphone…');
    acquireMic()
      .then(() => startListening())
      .catch((err) => {
        voiceModeEnabled = false;
        setStatus('error', `Microphone permission denied or unavailable (${err.name || err.message}).`);
      });
  }

  micBtn.addEventListener('click', () => {
    if (!voiceModeEnabled) {
      enableVoiceMode();
    } else if (state === 'speaking') {
      bargeIn();
    } else {
      disableVoiceMode();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceModeEnabled) {
      disableVoiceMode();
    }
    if (e.key === ' ' && voiceModeEnabled && state === 'speaking') {
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!typing) {
        e.preventDefault();
        bargeIn();
      }
    }
  });
})();
