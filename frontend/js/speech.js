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
    // 'interrupted' is normal when we cancel — not a real error
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.warn('[TTS] utterance error:', e.error);
    }
    isSpeaking = false;
    if (onEnd) onEnd();
  };

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
// Strategy:
// 1. Request mic permission ONCE up front and keep the stream alive.
// 2. Use short-session recognition (continuous: false) to avoid network timeouts.
// 3. On persistent network errors (3+ retries): fall back to MediaRecorder → Groq Whisper STT.
// 4. On 'aborted': silently restart (we triggered it).

let recognition   = null;
let silenceTimer  = null;
let isListening   = false;
let fullTranscript = '';
let onTranscriptCb = null;
let onEndCb        = null;
let onErrorCb      = null;
let networkRetries = 0;
let micStream      = null; // Keep mic stream alive to prevent network errors
let useWhisperFallback = false; // Switch to Whisper after repeated network failures
const MAX_NETWORK_RETRIES = 3;

export function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) || !!navigator.mediaDevices;
}

// Request mic permission first to warm up the audio pipeline
async function ensureMicPermission() {
  if (micStream && micStream.active) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[STT] Microphone permission granted, stream active');
    return true;
  } catch (err) {
    console.error('[STT] Mic permission denied:', err.message);
    return false;
  }
}

export async function startListening(onTranscript, onEnd, onError) {
  if (isListening) stopListening();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Warm up mic
  const permitted = await ensureMicPermission();
  if (!permitted) {
    if (onError) onError('Microphone access denied. Please allow microphone in browser settings.');
    return;
  }

  onTranscriptCb = onTranscript;
  onEndCb        = onEnd;
  onErrorCb      = onError;
  fullTranscript = '';
  networkRetries = 0;
  isListening    = true;

  if (useWhisperFallback || !SR) {
    // Use Groq Whisper via MediaRecorder
    setTimeout(() => _startWhisperListening(), 250);
  } else {
    // Use Web Speech API first
    setTimeout(() => _startRecognition(SR), 250);
  }
}

// ── Whisper fallback via MediaRecorder ────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let whisperActive = false;

function _startWhisperListening() {
  if (!isListening) return;
  if (!micStream || !micStream.active) {
    ensureMicPermission().then(ok => {
      if (ok && isListening) _startWhisperListening();
    });
    return;
  }

  whisperActive = true;
  audioChunks = [];

  try {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';

    mediaRecorder = new MediaRecorder(micStream, { mimeType });
  } catch (e) {
    if (onErrorCb) onErrorCb('Could not start recording: ' + e.message);
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    if (!whisperActive) return;
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
    audioChunks = [];

    if (blob.size < 1000) {
      // Too short — restart
      if (isListening) setTimeout(() => _startWhisperListening(), 300);
      return;
    }

    if (onTranscriptCb) onTranscriptCb('🔄 Processing...', false);

    try {
      const import_ = await import('./config.js');
      const Config = import_.default;
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');

      const res = await fetch(`${Config.API_BASE_URL}/stt/whisper`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const text = (data.text || '').trim();
        if (text) {
          fullTranscript = text;
          if (onTranscriptCb) onTranscriptCb(text, false);
          // Silence timer
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            if (isListening && fullTranscript.trim()) {
              const result = fullTranscript.trim();
              isListening = false;
              if (onTranscriptCb) onTranscriptCb(result, true);
              if (onEndCb) onEndCb(result);
            }
          }, 1500);
        }
      }
    } catch (e) {
      console.warn('[STT Whisper] transcription failed:', e.message);
    }

    // Restart recording segment
    if (isListening) setTimeout(() => _startWhisperListening(), 200);
  };

  // Record in 4-second segments
  mediaRecorder.start();
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, 4000);
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
  recognition.continuous      = false;  // short sessions avoid network timeouts
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    networkRetries = 0; // reset on successful start
    console.log('[STT] Recognition started');
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
    const err = event.error;
    console.warn('[STT] error:', err);

    if (err === 'no-speech') {
      // Normal — restart to keep listening
      return;
    }

    if (err === 'aborted') {
      // We triggered this via stop() — ignore
      return;
    }

    if (err === 'network') {
      networkRetries++;
      console.log(`[STT] Network error — retry ${networkRetries}/${MAX_NETWORK_RETRIES}`);
      if (networkRetries <= MAX_NETWORK_RETRIES && isListening) {
        // Re-acquire mic stream on retry to reset audio pipeline
        if (networkRetries > 1) {
          micStream?.getTracks().forEach(t => t.stop());
          micStream = null;
          setTimeout(async () => {
            if (!isListening) return;
            await ensureMicPermission();
            setTimeout(() => {
              if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
            }, 300);
          }, 800 * networkRetries);
        } else {
          setTimeout(() => {
            if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
          }, 600 * networkRetries);
        }
        return;
      }
      // Switch to Whisper fallback
      console.log('[STT] Switching to Whisper fallback after repeated network errors');
      useWhisperFallback = true;
      if (isListening) {
        if (onTranscriptCb) onTranscriptCb('', false); // clear interim
        _startWhisperListening();
      }
      return;
    }

    if (err === 'not-allowed' || err === 'permission-denied') {
      isListening = false;
      clearTimeout(silenceTimer);
      if (onErrorCb) onErrorCb('Microphone access denied. Please allow microphone access in your browser settings.');
      return;
    }

    // Any other error — restart if still listening
    if (isListening) {
      setTimeout(() => {
        if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
      }, 500);
    }
  };

  recognition.onend = () => {
    // Auto-restart while still listening and silence timer hasn't fired
    if (isListening) {
      setTimeout(() => {
        if (isListening) {
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }
      }, 150);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('[STT] start() failed:', err);
    // InvalidStateError = already started — retry after brief pause
    if (err.name === 'InvalidStateError') {
      setTimeout(() => {
        if (isListening) _startRecognition(SR);
      }, 400);
    } else {
      if (onErrorCb) onErrorCb('Could not start microphone: ' + err.message);
    }
  }
}

export function stopListening() {
  isListening = false;
  whisperActive = false;
  clearTimeout(silenceTimer);
  onTranscriptCb = null;
  onEndCb        = null;
  onErrorCb      = null;
  fullTranscript = '';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    mediaRecorder = null;
  }

  if (recognition) {
    try {
      recognition.onend  = null;
      recognition.onerror = null;
      recognition.stop();
    } catch (e) { /* ignore */ }
    recognition = null;
  }
}

export function getIsListening() { return isListening; }

