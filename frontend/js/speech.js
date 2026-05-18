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
let useWhisperFallback = false; // Once set true after persistent network errors, stays true for the session
const MAX_NETWORK_RETRIES = 2; // Switch to Whisper after 2 failures, not 3

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

  // Always reset stale state from a previous completed session,
  // even when isListening was already false (e.g. after Whisper finished).
  whisperActive = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
  if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }

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
    // Web Speech API failed in a previous session (or unsupported browser) —
    // go straight to Whisper, skip the 2-retry wait entirely.
    console.log('[STT] Using Whisper directly (Web Speech API unavailable/failed)');
    if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
    setTimeout(() => _startWhisperListening(), 0);
  } else {
    // Probe Web Speech API. It will self-demote to Whisper after 2 network errors.
    setTimeout(() => _startRecognition(SR), 0);
  }
}

// ── Whisper fallback via MediaRecorder + Web Audio VAD ───────
// Records until the user stops speaking (detected via RMS silence),
// rather than cutting off after a fixed 4-second window.
let mediaRecorder  = null;
let audioChunks    = [];
let whisperActive  = false;
let vadAudioCtx    = null; // Web Audio context for voice activity detection

// VAD tuning constants
// VAD_SPEECH_THRESHOLD must be well above ambient mic hiss (~5-8 RMS).
// 12 was too low — room noise alone set hasSpeech=true before any speech.
const VAD_SILENCE_THRESHOLD  = 10;   // RMS below this = silence
const VAD_SPEECH_THRESHOLD   = 22;   // RMS above this = real speech (raised from 12)
const VAD_SPEECH_SUSTAIN_MS  = 120;  // speech must sustain this long before hasSpeech=true
const VAD_SILENCE_MS         = 1800; // ms of silence after speech before we stop
const VAD_MAX_MS             = 45000; // safety cap: stop after 45 s regardless
const VAD_MIN_MS             = 600;   // don't stop before 600 ms (avoid clipping first word)

function _startWhisperListening() {
  if (!isListening) return;
  if (!micStream || !micStream.active) {
    ensureMicPermission().then(ok => {
      if (ok && isListening) _startWhisperListening();
    });
    return;
  }

  whisperActive = true;
  audioChunks   = [];

  // Close any leftover AudioContext from a previous round
  if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }

  let mimeType;
  try {
    mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
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
    // Clean up VAD
    if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }

    if (!whisperActive) return;
    const blob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];

    if (blob.size < 1500) {
      // Too short to contain real speech — restart and wait
      if (isListening) setTimeout(() => _startWhisperListening(), 300);
      return;
    }

    if (onTranscriptCb) onTranscriptCb('🔄 Processing...', false);

    try {
      const formData = new FormData();
      const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
      formData.append('audio', blob, `audio.${ext}`);

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
          // Short pause after processing before calling onEnd
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            if (isListening && fullTranscript.trim()) {
              const result = fullTranscript.trim();
              // Fully clean up so the next mic press starts fresh
              isListening   = false;
              whisperActive = false;
              mediaRecorder = null;
              const _onTranscript = onTranscriptCb;
              const _onEnd        = onEndCb;
              onTranscriptCb = null;
              onEndCb        = null;
              onErrorCb      = null;
              if (_onTranscript) _onTranscript(result, true);
              if (_onEnd)        _onEnd(result);
            }
          }, 600);
          return; // Don't restart — we have a complete answer
        }
      }
    } catch (e) {
      console.warn('[STT Whisper] transcription failed:', e.message);
    }

    // No transcript yet — restart and keep listening
    if (isListening) setTimeout(() => _startWhisperListening(), 200);
  };

  // ── Voice Activity Detection ──────────────────────────────
  // Uses Web Audio AnalyserNode to watch RMS levels in real time.
  // Recording stops only after genuine silence following real speech,
  // not after a fixed timer that would cut the user off mid-sentence.
  try {
    vadAudioCtx        = new (window.AudioContext || window.webkitAudioContext)();
    const source       = vadAudioCtx.createMediaStreamSource(micStream);
    const analyser     = vadAudioCtx.createAnalyser();
    analyser.fftSize   = 512;
    source.connect(analyser);

    const buf          = new Uint8Array(analyser.frequencyBinCount);
    const startTime    = Date.now();
    let hasSpeech      = false;
    let speechOnSince  = null; // when loud audio first appeared (sustain check)
    let silenceStart   = null;
    let vadRunning     = true;
    const VAD_STARTUP_GRACE_MS = 200; // ignore audio for first 200ms — prevents transition noise from triggering hasSpeech

    const tick = () => {
      if (!vadRunning || !whisperActive || !isListening) return;

      analyser.getByteTimeDomainData(buf);

      // Compute RMS on 0-100 scale
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length) * 100;

      const elapsed = Date.now() - startTime;

      if (rms >= VAD_SPEECH_THRESHOLD) {
        // Ignore audio during the startup grace window — prevents transition
        // noise (from switching off Web Speech API) from prematurely setting hasSpeech
        if (elapsed < VAD_STARTUP_GRACE_MS) {
          requestAnimationFrame(tick);
          return;
        }
        // Track how long the loud audio has been sustained
        if (!speechOnSince) speechOnSince = Date.now();
        // Only mark hasSpeech after sustained loud audio — prevents a single
        // breath/click/noise-spike from prematurely starting the silence timer
        if (!hasSpeech && (Date.now() - speechOnSince) >= VAD_SPEECH_SUSTAIN_MS) {
          hasSpeech = true;
          // Immediately tell the user their voice is being picked up
          if (onTranscriptCb) onTranscriptCb('🎙️ Got you, keep going…', false);
        }
        silenceStart = null;
      } else {
        speechOnSince = null; // reset sustain on any quiet frame
      }

      if (rms < VAD_SILENCE_THRESHOLD && hasSpeech) {
        if (!silenceStart) silenceStart = Date.now();
        const silenceDuration = Date.now() - silenceStart;

        if (silenceDuration >= VAD_SILENCE_MS && elapsed >= VAD_MIN_MS) {
          // User stopped speaking — commit the recording
          console.log('[STT Whisper] VAD: silence detected, stopping recording');
          vadRunning = false;
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
          return;
        }
      }

      // Safety cap: stop after VAD_MAX_MS regardless
      if (elapsed >= VAD_MAX_MS) {
        console.log('[STT Whisper] VAD: max duration reached');
        vadRunning = false;
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  } catch (vadErr) {
    // VAD unavailable (very old browser) — fall back to 8-second fixed window
    console.warn('[STT Whisper] VAD unavailable, using fixed window:', vadErr.message);
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 8000);
  }

  mediaRecorder.start(50); // collect chunks every 50 ms for faster onstop data
}

// Track whether the current recognition instance was intentionally stopped by us
let _recognitionStopping = false;

function _startRecognition(SR) {
  if (!isListening) return;

  // Destroy any prior instance cleanly before creating a new one
  if (recognition) {
    const old = recognition;
    recognition = null;
    _recognitionStopping = true;
    old.onstart = null;
    old.onresult = null;
    old.onerror = null;
    old.onend = null;
    try { old.abort(); } catch (_) {}
    _recognitionStopping = false;
  }

  let rec;
  try {
    rec = new SR();
  } catch (e) {
    if (onErrorCb) onErrorCb('Could not initialise microphone: ' + e.message);
    return;
  }

  recognition = rec;

  rec.lang            = Config.SPEECH.LANG;
  rec.continuous      = true;   // continuous avoids the onend→restart→aborted cycle
  rec.interimResults  = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    console.log('[STT] Recognition started');
    // Immediate visual feedback so user knows mic is active
    if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
  };

  rec.onresult = (event) => {
    // We got real speech — the connection is healthy, reset the error counter
    networkRetries = 0;

    let interim = '';
    let final_  = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final_ += r[0].transcript;
      else           interim += r[0].transcript;
    }

    if (final_) fullTranscript += final_ + ' ';

    const display = (fullTranscript + interim).trim();
    // Only show the placeholder if nothing has been heard yet
    if (onTranscriptCb) onTranscriptCb(display || '🎙️ Listening…', false);

    // Reset silence timer on every speech event
    clearTimeout(silenceTimer);
    if (fullTranscript.trim() || interim.trim()) {
      silenceTimer = setTimeout(() => {
        if (fullTranscript.trim() && isListening) {
          const result = fullTranscript.trim();
          // Stop cleanly before calling onEnd
          _stopRecognitionClean();
          if (onTranscriptCb) onTranscriptCb(result, true);
          if (onEndCb) onEndCb(result);
        }
      }, Config.SPEECH.SILENCE_TIMEOUT_MS);
    }
  };

  rec.onerror = (event) => {
    if (rec !== recognition) return; // stale instance — ignore
    const err = event.error;

    // aborted = we called abort/stop ourselves — never restart from here
    if (err === 'aborted') return;

    // no-speech is normal with continuous mode — do nothing
    if (err === 'no-speech') return;

    console.warn('[STT] error:', err);

    if (err === 'network') {
      networkRetries++;
      console.log(`[STT] Network error — retry ${networkRetries}/${MAX_NETWORK_RETRIES}`);

      // Null ALL handlers and abort this rec immediately.
      // Two races this prevents:
      //   1. rec.onend fires ~300ms after onerror; without nulling it sees
      //      recognition===rec and schedules another _startRecognition, which
      //      races the 900ms retry and creates a ghost "retry 3/2" session.
      //   2. A stale 900ms setTimeout from an earlier retry fires after we've
      //      switched to Whisper — guard below catches any survivors.
      rec.onstart  = null;
      rec.onresult = null;
      rec.onerror  = null;
      rec.onend    = null;
      recognition  = null;
      try { rec.abort(); } catch (_) {}

      if (networkRetries < MAX_NETWORK_RETRIES && isListening) {
        setTimeout(() => {
          if (!isListening || useWhisperFallback) return; // guard stale timers
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }, 400 * networkRetries);
        return;
      }
      // Persistent network failures → switch to Whisper for this mic-press session
      console.log('[STT] Switching to Whisper fallback after persistent network errors');
      useWhisperFallback = true;
      networkRetries = 0;
      if (isListening) {
        if (onTranscriptCb) onTranscriptCb('', false);
        _startWhisperListening();
      }
      return;
    }

    if (err === 'not-allowed' || err === 'permission-denied') {
      isListening = false;
      clearTimeout(silenceTimer);
      recognition = null;
      if (onErrorCb) onErrorCb('Microphone access denied. Please allow microphone access in your browser settings.');
      return;
    }

    // Any other error with continuous mode: try to restart once
    if (isListening) {
      recognition = null;
      setTimeout(() => {
        if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
      }, 600);
    }
  };

  rec.onend = () => {
    if (rec !== recognition) return; // stale — ignore
    // With continuous=true, onend only fires when recognition truly stops
    // (network drop, browser killed it, etc.) — restart if we're still listening
    if (isListening) {
      setTimeout(() => {
        if (isListening && recognition === rec) {
          recognition = null;
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }
      }, 300);
    }
  };

  try {
    rec.start();
  } catch (err) {
    console.error('[STT] start() failed:', err);
    recognition = null;
    if (err.name === 'InvalidStateError') {
      setTimeout(() => {
        if (isListening) _startRecognition(SR);
      }, 500);
    } else {
      if (onErrorCb) onErrorCb('Could not start microphone: ' + err.message);
    }
  }
}

// Cleanly stop the active recognition without triggering a restart
function _stopRecognitionClean() {
  isListening = false;
  clearTimeout(silenceTimer);
  if (recognition) {
    const r = recognition;
    recognition = null;
    r.onstart = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.abort(); } catch (_) {}
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
    try { mediaRecorder.stop(); } catch (_) {}
    mediaRecorder = null;
  }

  if (recognition) {
    const r = recognition;
    recognition = null;
    r.onstart = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.abort(); } catch (_) {}
  }
}

export function getIsListening() { return isListening; }

