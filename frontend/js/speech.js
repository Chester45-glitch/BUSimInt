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

// Request mic permission first to warm up the audio pipeline.
// On mobile (especially iOS) streams can go inactive — always verify tracks are live.
async function ensureMicPermission() {
  // Check if existing stream has live tracks
  if (micStream && micStream.active) {
    const tracks = micStream.getAudioTracks();
    if (tracks.length > 0 && tracks[0].readyState === 'live') return true;
  }
  // Stream is dead or missing — stop stale tracks and get a fresh one
  if (micStream) {
    micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    micStream = null;
  }
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
    // go straight to Whisper. Call directly (no setTimeout) to keep iOS gesture chain alive.
    console.log('[STT] Using Whisper directly (Web Speech API unavailable/failed)');
    if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
    // Pre-unlock AudioContext on iOS while still inside the gesture chain
    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (tmpCtx.state === 'suspended') tmpCtx.resume().catch(() => {});
      tmpCtx.close().catch(() => {});
    } catch (_) {}
    _startWhisperListening();
  } else {
    // Probe Web Speech API. Run a parallel AudioContext analyser so we can
    // push live RMS to the UI even before the first onresult fires.
    _startWebSpeechVADMeter();
    setTimeout(() => _startRecognition(SR), 0);
  }
}

// Lightweight audio meter for Web Speech path (no VAD logic — just RMS → UI)
let _wsMeterCtx = null;
function _startWebSpeechVADMeter() {
  if (!micStream || !micStream.active) return;
  try {
    _wsMeterCtx = new (window.AudioContext || window.webkitAudioContext)();
    const resume = _wsMeterCtx.state === 'suspended' ? _wsMeterCtx.resume() : Promise.resolve();
    resume.then(() => {
      const source   = _wsMeterCtx.createMediaStreamSource(micStream);
      const analyser = _wsMeterCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!isListening || !_wsMeterCtx) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length) * 100;
        if (onLiveAudioCb) onLiveAudioCb(rms);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } catch (_) {}
}
function _stopWebSpeechVADMeter() {
  if (_wsMeterCtx) { try { _wsMeterCtx.close(); } catch (_) {} _wsMeterCtx = null; }
  if (onLiveAudioCb) onLiveAudioCb(0);
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
const VAD_SILENCE_THRESHOLD  = 8;    // RMS below this = true silence (below typical room noise)
const VAD_SPEECH_THRESHOLD   = 22;   // RMS above this = confirmed speech
const VAD_SPEECH_SUSTAIN_MS  = 100;  // speech must sustain this long to set hasSpeech=true
const VAD_SILENCE_MS         = 2000; // ms of true silence before stopping
const VAD_MAX_MS             = 60000; // safety cap: 60s
const VAD_MIN_MS             = 200;  // don't stop before 200ms
const VAD_POLL_MS            = 80;   // how often to sample the analyser

// Live audio level callback — set by startListening to push RMS to the UI
let onLiveAudioCb = null;
export function setLiveAudioCallback(cb) { onLiveAudioCb = cb; }

async function _startWhisperListening() {
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
    // Priority order: webm/opus (Chrome/Firefox) → mp4 (iOS Safari) → webm → ogg
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else {
      mimeType = 'audio/ogg';
    }
    mediaRecorder = new MediaRecorder(micStream, { mimeType });
  } catch (e) {
    // Last resort: let browser pick its own format
    try {
      mediaRecorder = new MediaRecorder(micStream);
      mimeType = mediaRecorder.mimeType || 'audio/webm';
    } catch (e2) {
      if (onErrorCb) onErrorCb('Could not start recording: ' + e2.message);
      return;
    }
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
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      formData.append('audio', blob, `audio.${ext}`);

      const res = await fetch(`${Config.API_BASE_URL}/stt/whisper`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const text = (data.text || '').trim();
        if (text) {
          // Strip stop keyword phrase from the transcript if present
          const cleanText = stripStopKeyword(text);
          fullTranscript = cleanText;
          isListening   = false;
          whisperActive = false;
          mediaRecorder = null;
          const _onTranscript = onTranscriptCb;
          const _onEnd        = onEndCb;
          onTranscriptCb = null;
          onEndCb        = null;
          onErrorCb      = null;
          if (_onTranscript) _onTranscript(cleanText, true);
          if (_onEnd)        _onEnd(cleanText);
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
    vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS Safari starts AudioContext suspended — must resume inside a user-gesture chain
    if (vadAudioCtx.state === 'suspended') await vadAudioCtx.resume();

    const source       = vadAudioCtx.createMediaStreamSource(micStream);
    const analyser     = vadAudioCtx.createAnalyser();
    analyser.fftSize   = 512;
    source.connect(analyser);

    const buf          = new Uint8Array(analyser.frequencyBinCount);
    const startTime    = Date.now();
    let hasSpeech      = false;
    let speechOnSince  = null;
    let silenceTimer_  = null; // independent wall-clock silence countdown
    let vadRunning     = true;
    const VAD_STARTUP_GRACE_MS = 100;

    const stopRecording = () => {
      if (!vadRunning) return;
      vadRunning = false;
      clearTimeout(silenceTimer_);
      if (onLiveAudioCb) onLiveAudioCb(0);
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    };

    // Safety cap — always fires regardless of VAD state
    const maxTimer = setTimeout(() => {
      console.log('[STT Whisper] VAD: max duration reached');
      stopRecording();
    }, VAD_MAX_MS);

    const poll = () => {
      if (!vadRunning || !whisperActive || !isListening) {
        clearTimeout(maxTimer);
        return;
      }

      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length) * 100;

      if (onLiveAudioCb) onLiveAudioCb(rms);

      const elapsed = Date.now() - startTime;

      if (elapsed >= VAD_STARTUP_GRACE_MS) {
        if (rms >= VAD_SPEECH_THRESHOLD) {
          if (!speechOnSince) speechOnSince = Date.now();
          if (!hasSpeech && (Date.now() - speechOnSince) >= VAD_SPEECH_SUSTAIN_MS) {
            hasSpeech = true;
          }
          // Voice is loud — cancel any pending silence cutoff
          if (silenceTimer_) { clearTimeout(silenceTimer_); silenceTimer_ = null; }
        } else {
          speechOnSince = null;

          if (hasSpeech && elapsed >= VAD_MIN_MS) {
            // Below speech threshold — start the silence countdown if not already running
            if (!silenceTimer_) {
              silenceTimer_ = setTimeout(() => {
                console.log('[STT Whisper] VAD stop — silence timeout');
                clearTimeout(maxTimer);
                stopRecording();
              }, VAD_SILENCE_MS);
            }
          }
        }
      }

      setTimeout(poll, VAD_POLL_MS);
    };

    setTimeout(poll, 0);
  } catch (vadErr) {
    // VAD unavailable (very old browser) — fall back to 8-second fixed window
    console.warn('[STT Whisper] VAD unavailable, using fixed window:', vadErr.message);
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 8000);
  }

  mediaRecorder.start(50); // collect chunks every 50 ms for faster onstop data
}

// ── Stop Keywords ─────────────────────────────────────────────
const STOP_PHRASES = [
  "that's all", "thats all", "that's all po", "thats all po",
  "that's it", "thats it", "that's it po", "thats it po",
  "i'm done", "im done", "i am done",
  "done talking", "done speaking",
  "submit now", "submit answer", "submit that",
  "send it", "send answer", "send that",
  "finish", "finished",
  "end answer",
];

function checkStopKeyword(text) {
  const lower = text.toLowerCase().trim();
  return STOP_PHRASES.some(phrase => lower.endsWith(phrase) || lower === phrase);
}

function stripStopKeyword(text) {
  const lower = text.toLowerCase().trim();
  for (const phrase of STOP_PHRASES) {
    if (lower.endsWith(phrase)) {
      return text.slice(0, text.toLowerCase().lastIndexOf(phrase)).trim().replace(/[,.\s]+$/, '').trim();
    }
  }
  return text;
}

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
  // iOS/Android don't support continuous=true reliably — use continuous=false
  // and restart the session in onend to simulate continuous capture.
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  rec.continuous      = !isMobile;  // false on mobile, true on desktop
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

    // Check stop keywords against the full current transcript
    const currentText = (fullTranscript + interim).trim();
    if (currentText && checkStopKeyword(currentText)) {
      const cleanText = stripStopKeyword(currentText);
      clearTimeout(silenceTimer); silenceTimer = null;
      fullTranscript = cleanText;
      _stopRecognitionClean();
      if (onTranscriptCb) onTranscriptCb(cleanText, true);
      if (onEndCb) onEndCb(cleanText);
      return;
    }

    // Reset silence timer on every speech event
    clearTimeout(silenceTimer); silenceTimer = null;
    if (fullTranscript.trim() || interim.trim()) {
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (fullTranscript.trim() && isListening) {
          const result = fullTranscript.trim();
          _stopRecognitionClean();
          if (onTranscriptCb) onTranscriptCb(result, true);
          if (onEndCb) onEndCb(result);
        }
      }, 2000);
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
    // With continuous=true, onend only fires when recognition truly stops.
    // On mobile (continuous=false), onend fires after each utterance — restart
    // unless a silence timer is actively running (meaning we're about to auto-submit).
    if (isListening) {
      setTimeout(() => {
        if (isListening && recognition === rec) {
          // Only skip restart if silence timer is pending AND we have content to submit
          if (silenceTimer !== null && fullTranscript.trim() !== '') return;
          recognition = null;
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }
      }, 200);
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
  clearTimeout(silenceTimer); silenceTimer = null;
  _stopWebSpeechVADMeter();
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
  clearTimeout(silenceTimer); silenceTimer = null;
  _stopWebSpeechVADMeter();
  onTranscriptCb = null;
  onEndCb        = null;
  onErrorCb      = null;
  onLiveAudioCb  = null;
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

// Returns whatever has been captured so far (for the Submit button)
export function getPartialTranscript() { return fullTranscript.trim(); }

// Immediately finalise the current recording and fire onEnd with what we have.
// Called by the Submit Answer button.
export function submitNow() {
  if (!isListening) return;

  // Web Speech API path — we have fullTranscript already
  if (recognition) {
    const text = fullTranscript.trim();
    _stopRecognitionClean();
    const _onTranscript = onTranscriptCb;
    const _onEnd        = onEndCb;
    onTranscriptCb = null;
    onEndCb        = null;
    onErrorCb      = null;
    if (text) {
      if (_onTranscript) _onTranscript(text, true);
      if (_onEnd)        _onEnd(text);
    }
    return;
  }

  // Whisper path — stop the recorder; onstop will handle transcription
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    whisperActive = true; // keep onstop handler alive
    mediaRecorder.stop();
    // onstop will call onTranscriptCb / onEndCb as usual
  }
}

