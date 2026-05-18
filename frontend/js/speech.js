// js/speech.js — Text-to-Speech and Speech-to-Text handling
import Config from './config.js';

// ── Text to Speech ────────────────────────────────────────────
let currentAudio = null;
let isSpeaking = false;

export async function speakText(text, onStart, onEnd) {
  stopSpeaking();
  if (!text || !text.trim()) { if (onEnd) onEnd(); return; }
  browserSpeak(text, onStart, onEnd);
}

function browserSpeak(text, onStart, onEnd) {
  if (!window.speechSynthesis) {
    console.warn('[Speech] Browser TTS not supported');
    if (onEnd) onEnd();
    return;
  }

  // Cancel any pending utterances
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = Config.SPEECH.LANG;
  utterance.rate = 0.92;
  utterance.pitch = 1;

  // Pick best available voice
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    return voices.find(v =>
      v.name.includes('Google US English') ||
      v.name.includes('Microsoft Mark')    ||
      v.name.includes('Daniel')            ||
      (v.lang.startsWith('en') && v.localService)
    ) || voices.find(v => v.lang.startsWith('en')) || null;
  };

  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  utterance.onstart = () => { isSpeaking = true;  if (onStart) onStart(); };
  utterance.onend   = () => { isSpeaking = false; if (onEnd)   onEnd();   };
  utterance.onerror = (e) => {
    console.warn('[TTS] utterance error:', e.error);
    isSpeaking = false;
    if (onEnd) onEnd();
  };

  // Voices may not be loaded yet on first call
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      const v = pickVoice();
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.onvoiceschanged = null;
    };
  } else {
    window.speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  isSpeaking = false;
}

export function getIsSpeaking() { return isSpeaking; }

// ── Speech Recognition ────────────────────────────────────────
// Fix for "network" error on HTTPS:
// - Use continuous: false (avoid long-running sessions that time out)
// - Restart manually after each result until stopListening() is called
// - Treat "network" error as a restart signal, not a fatal failure

let recognition   = null;
let silenceTimer  = null;
let isListening   = false;
let fullTranscript = '';
let onTranscriptCb = null;
let onEndCb        = null;
let onErrorCb      = null;
let networkRetries = 0;
const MAX_NETWORK_RETRIES = 3;

export function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startListening(onTranscript, onEnd, onError) {
  if (isListening) stopListening();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (onError) onError('Speech recognition is not supported. Please use Chrome or Edge.');
    return;
  }

  // Store callbacks so restarts can reuse them
  onTranscriptCb = onTranscript;
  onEndCb        = onEnd;
  onErrorCb      = onError;
  fullTranscript = '';
  networkRetries = 0;
  isListening    = true;

  _startRecognition(SR);
}

function _startRecognition(SR) {
  if (!isListening) return;

  try {
    recognition = new SR();
  } catch (e) {
    if (onErrorCb) onErrorCb('Could not initialise microphone: ' + e.message);
    return;
  }

  recognition.lang            = Config.SPEECH.LANG;
  recognition.continuous      = false;  // ← key fix: false prevents network timeout
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    networkRetries = 0; // reset on successful start
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final_  = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final_ += r[0].transcript;
      else           interim += r[0].transcript;
    }

    if (final_) fullTranscript += final_ + ' ';

    const display = (fullTranscript + interim).trim();
    if (onTranscriptCb) onTranscriptCb(display, false);

    // Reset silence timer
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (fullTranscript.trim() && isListening) {
        const result = fullTranscript.trim();
        isListening = false;
        clearTimeout(silenceTimer);
        if (onTranscriptCb) onTranscriptCb(result, true);
        if (onEndCb) onEndCb(result);
      }
    }, Config.SPEECH.SILENCE_TIMEOUT_MS);
  };

  recognition.onerror = (event) => {
    console.warn('[STT] error:', event.error);

    if (event.error === 'no-speech') {
      // Normal — just restart to keep listening
      return;
    }

    if (event.error === 'network') {
      // Network error: retry a few times before giving up
      networkRetries++;
      if (networkRetries <= MAX_NETWORK_RETRIES && isListening) {
        console.log(`[STT] Network error — retry ${networkRetries}/${MAX_NETWORK_RETRIES}`);
        setTimeout(() => {
          if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }, 1000 * networkRetries);
        return;
      }
      // Exceeded retries — tell user
      isListening = false;
      clearTimeout(silenceTimer);
      if (onErrorCb) onErrorCb('Microphone network error. Make sure you\'re using Chrome/Edge and the site is on HTTPS.');
      return;
    }

    if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      isListening = false;
      clearTimeout(silenceTimer);
      if (onErrorCb) onErrorCb('Microphone access denied. Please allow microphone access in your browser settings.');
      return;
    }

    if (event.error === 'aborted') {
      // We triggered this via stop() — ignore
      return;
    }

    // Any other error
    isListening = false;
    clearTimeout(silenceTimer);
    if (onErrorCb) onErrorCb(`Microphone error: ${event.error}`);
  };

  recognition.onend = () => {
    // Restart automatically while still listening and silence timer hasn't fired
    if (isListening) {
      setTimeout(() => {
        if (isListening) {
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }
      }, 100);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('[STT] start() failed:', err);
    if (onErrorCb) onErrorCb('Could not start microphone: ' + err.message);
  }
}

export function stopListening() {
  isListening = false;
  clearTimeout(silenceTimer);
  onTranscriptCb = null;
  onEndCb        = null;
  onErrorCb      = null;
  fullTranscript = '';

  if (recognition) {
    try {
      recognition.onend  = null; // prevent auto-restart
      recognition.onerror = null;
      recognition.stop();
    } catch (e) { /* ignore */ }
    recognition = null;
  }
}

export function getIsListening() { return isListening; }
