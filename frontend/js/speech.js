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

// ── Device Detection ─────────────────────────────────────────
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// ── Speech Recognition ────────────────────────────────────────
// Strategy:
//   MOBILE  → go straight to Whisper (MediaRecorder + backend STT).
//             Web Speech API on mobile is too unreliable (network errors,
//             no-speech timeouts, iOS restrictions). Skip it entirely.
//   DESKTOP → try Web Speech API first; fall back to Whisper after 2
//             consecutive network errors.

let recognition    = null;
let silenceTimer   = null;
let isListening    = false;
let fullTranscript = '';
let onTranscriptCb = null;
let onEndCb        = null;
let onErrorCb      = null;
let networkRetries = 0;
let micStream      = null;
let useWhisperFallback = false;
const MAX_NETWORK_RETRIES = 2;

export function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) || !!navigator.mediaDevices;
}

// ── Mic Permission ────────────────────────────────────────────
// Try with ideal constraints first; fall back to plain { audio: true }
// because iOS Safari rejects echoCancellation:false and returns an error.
async function ensureMicPermission() {
  if (micStream && micStream.active) {
    const tracks = micStream.getAudioTracks();
    if (tracks.length > 0 && tracks[0].readyState === 'live') return true;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    micStream = null;
  }

  // Try ideal constraints (disabling AGC gives VAD a raw signal to work with)
  const constraintSets = [
    { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false },
    { audio: { echoCancellation: true,  noiseSuppression: true,  autoGainControl: true  }, video: false },
    { audio: true, video: false }, // last resort
  ];

  for (const constraints of constraintSets) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[STT] Mic granted with constraints:', JSON.stringify(constraints.audio));
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.error('[STT] Mic permission denied:', err.message);
        return false; // No point retrying — user denied
      }
      console.warn('[STT] Mic constraint set failed, trying next:', err.message);
    }
  }
  console.error('[STT] All mic constraint sets failed');
  return false;
}

// ── Start Listening ───────────────────────────────────────────
export async function startListening(onTranscript, onEnd, onError) {
  if (isListening) stopListening();

  // Reset all stale state
  whisperActive = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
  if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }
  useWhisperFallback = false; // Reset each session so desktop gets a fresh attempt

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const permitted = await ensureMicPermission();
  if (!permitted) {
    if (onError) onError('Microphone access denied. Please allow microphone in your browser settings.');
    return;
  }

  onTranscriptCb = onTranscript;
  onEndCb        = onEnd;
  onErrorCb      = onError;
  fullTranscript = '';
  networkRetries = 0;
  isListening    = true;

  // MOBILE: always use Whisper — Web Speech API is too unreliable on mobile browsers
  // DESKTOP with no SR: fall back to Whisper
  if (isMobile || !SR) {
    console.log(`[STT] Using Whisper (${isMobile ? 'mobile device' : 'Web Speech API unavailable'})`);
    useWhisperFallback = true;
    if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
    // Pre-unlock AudioContext on iOS while still inside the gesture chain
    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (tmpCtx.state === 'suspended') tmpCtx.resume().catch(() => {});
      tmpCtx.close().catch(() => {});
    } catch (_) {}
    _startWhisperListening();
    return;
  }

  // DESKTOP: try Web Speech API
  _startWebSpeechVADMeter();
  setTimeout(() => _startRecognition(SR), 0);
}

// ── Web Speech VAD Meter (desktop only) ──────────────────────
let _wsMeterCtx = null;
let _wsMeterSmoothed = 0;
function _startWebSpeechVADMeter() {
  if (!micStream || !micStream.active) return;
  _wsMeterSmoothed = 0;
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
        _wsMeterSmoothed = _wsMeterSmoothed * 0.65 + rms * 0.35;
        if (onLiveAudioCb) onLiveAudioCb(_wsMeterSmoothed);
        setTimeout(tick, 80);
      };
      setTimeout(tick, 80);
    });
  } catch (_) {}
}
function _stopWebSpeechVADMeter() {
  if (_wsMeterCtx) { try { _wsMeterCtx.close(); } catch (_) {} _wsMeterCtx = null; }
  if (onLiveAudioCb) onLiveAudioCb(0);
}

// ── Whisper via MediaRecorder + VAD ──────────────────────────
let mediaRecorder  = null;
let audioChunks    = [];
let whisperActive  = false;
let vadAudioCtx    = null;

// VAD constants
// VAD_SPEECH_THRESHOLD is now a MINIMUM floor — the actual threshold is
// computed adaptively from the ambient noise baseline during the first
// calibration window. This handles devices where AGC makes speech very
// quiet AND devices where background noise is loud.
const VAD_SPEECH_THRESHOLD_MIN = 5;   // absolute floor (very quiet mics)
const VAD_SPEECH_THRESHOLD_MAX = 40;  // absolute ceiling
const VAD_CALIBRATION_MS    = 1000;  // measure ambient noise for this long before VAD activates
const VAD_SPEECH_MULTIPLIER = 2.8;   // speech threshold = baseline * this multiplier
const VAD_SPEECH_SUSTAIN_MS = 120;   // speech must sustain this long before hasSpeech=true
const VAD_SILENCE_MS        = 2500;  // ms of silence after speech before stopping
                                      // Increased from 1500 — natural thinking pauses can be 1-2s
const VAD_MAX_MS            = 90000; // safety cap
const VAD_MIN_MS            = 300;
const VAD_POLL_MS           = 60;    // poll faster for responsiveness
const VAD_NO_WORDS_MS       = 10000; // stop if no speech confirmed within 10s

let onLiveAudioCb = null;
export function setLiveAudioCallback(cb) { onLiveAudioCb = cb; }

// VAD debug — logs peak RMS every 2s to help tune thresholds
let _vadPeak = 0, _vadDebugTimer = null;
function _startVadDebug() {
  _vadPeak = 0;
  _vadDebugTimer = setInterval(() => {
    console.log(`[STT VAD] peak RMS last 2s: ${_vadPeak.toFixed(2)}`);
    _vadPeak = 0;
  }, 2000);
}
function _stopVadDebug() { clearInterval(_vadDebugTimer); _vadDebugTimer = null; }

async function _startWhisperListening() {
  if (!isListening) return;

  // Ensure mic is alive
  if (!micStream || !micStream.active) {
    const ok = await ensureMicPermission();
    if (!ok || !isListening) return;
  }

  whisperActive = true;
  audioChunks   = [];
  if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }

  // Pick best supported MIME type
  let mimeType = 'audio/webm';
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }

  try {
    mediaRecorder = new MediaRecorder(micStream, { mimeType });
  } catch (e) {
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
    _stopVadDebug();
    if (vadAudioCtx) { try { vadAudioCtx.close(); } catch (_) {} vadAudioCtx = null; }
    if (!whisperActive) return;

    const blob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];

    if (blob.size < 1500) {
      // Too small — no real speech; restart quietly
      if (isListening) setTimeout(() => _startWhisperListening(), 300);
      return;
    }

    if (onTranscriptCb) onTranscriptCb('🔄 Processing…', false);

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
          const cleanText = stripStopKeyword(text);
          fullTranscript = cleanText;
          isListening    = false;
          whisperActive  = false;
          mediaRecorder  = null;
          const _cb = onTranscriptCb, _end = onEndCb;
          onTranscriptCb = null; onEndCb = null; onErrorCb = null;
          if (_cb)  _cb(cleanText, true);
          if (_end) _end(cleanText);
          return;
        }
      }
    } catch (e) {
      console.warn('[STT Whisper] transcription failed:', e.message);
    }

    // No text — restart
    if (isListening) setTimeout(() => _startWhisperListening(), 200);
  };

  // ── VAD ───────────────────────────────────────────────────
  try {
    vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (vadAudioCtx.state === 'suspended') await vadAudioCtx.resume();

    const source   = vadAudioCtx.createMediaStreamSource(micStream);
    const analyser = vadAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buf       = new Uint8Array(analyser.frequencyBinCount);
    const startTime = Date.now();
    let hasSpeech     = false;
    let speechOnSince = null;
    let silenceTimer_ = null;
    let noWordsTimer_ = null;
    let vadRunning    = true;
    let smoothed      = 0;

    // Adaptive calibration state
    // During VAD_CALIBRATION_MS we sample ambient noise and compute a dynamic
    // speech threshold = baseline * VAD_SPEECH_MULTIPLIER.
    // This makes detection work regardless of the device's mic sensitivity or
    // ambient noise level — quiet mics, loud rooms, AGC-compressed signals, all handled.
    let calibrating      = true;
    let calibSamples     = [];
    let speechThreshold  = VAD_SPEECH_THRESHOLD_MIN; // updated after calibration

    _startVadDebug();

    const stopRecording = (reason) => {
      if (!vadRunning) return;
      vadRunning = false;
      clearTimeout(silenceTimer_);
      clearTimeout(noWordsTimer_);
      clearTimeout(maxTimer);
      _stopVadDebug();
      if (onLiveAudioCb) onLiveAudioCb(0);
      console.log(`[STT Whisper] VAD stop — ${reason}`);
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    };

    // No-speech safety timer — starts AFTER calibration finishes
    const startNoWordsTimer = () => {
      noWordsTimer_ = setTimeout(() => {
        if (!hasSpeech) stopRecording('no speech confirmed in time limit');
      }, VAD_NO_WORDS_MS);
    };

    const maxTimer = setTimeout(() => stopRecording('max duration'), VAD_MAX_MS);

    const poll = () => {
      if (!vadRunning || !whisperActive || !isListening) { clearTimeout(maxTimer); return; }

      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length) * 100;
      if (rms > _vadPeak) _vadPeak = rms;
      smoothed = smoothed * 0.65 + rms * 0.35;
      if (onLiveAudioCb) onLiveAudioCb(smoothed);

      const elapsed = Date.now() - startTime;

      // ── Phase 1: Calibration ──────────────────────────────
      if (calibrating) {
        calibSamples.push(rms);
        if (elapsed >= VAD_CALIBRATION_MS) {
          calibrating = false;
          // Use the 80th-percentile sample as baseline (more robust than mean —
          // ignores occasional loud spikes during calibration)
          const sorted = [...calibSamples].sort((a, b) => a - b);
          const baseline = sorted[Math.floor(sorted.length * 0.8)] || 4;
          speechThreshold = Math.min(
            VAD_SPEECH_THRESHOLD_MAX,
            Math.max(VAD_SPEECH_THRESHOLD_MIN, baseline * VAD_SPEECH_MULTIPLIER)
          );
          console.log(`[STT VAD] Calibrated — baseline: ${baseline.toFixed(2)}, speech threshold: ${speechThreshold.toFixed(2)}`);
          startNoWordsTimer();
        }
        setTimeout(poll, VAD_POLL_MS);
        return;
      }

      // ── Phase 2: Active VAD ───────────────────────────────
      if (rms >= speechThreshold) {
        if (!speechOnSince) speechOnSince = Date.now();
        if (!hasSpeech && (Date.now() - speechOnSince) >= VAD_SPEECH_SUSTAIN_MS) {
          hasSpeech = true;
          clearTimeout(noWordsTimer_); noWordsTimer_ = null;
          console.log(`[STT VAD] Speech confirmed — RMS: ${rms.toFixed(2)}, threshold was: ${speechThreshold.toFixed(2)}`);
        }
        // Voice active — cancel any pending silence cutoff
        if (silenceTimer_) { clearTimeout(silenceTimer_); silenceTimer_ = null; }
      } else {
        speechOnSince = null;
        if (hasSpeech && elapsed >= VAD_MIN_MS && !silenceTimer_) {
          silenceTimer_ = setTimeout(() => stopRecording('silence after speech'), VAD_SILENCE_MS);
        }
      }

      setTimeout(poll, VAD_POLL_MS);
    };
    setTimeout(poll, 0);

  } catch (vadErr) {
    console.warn('[STT Whisper] VAD unavailable, fixed 8s window:', vadErr.message);
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 8000);
  }

  mediaRecorder.start(50);
}

// ── Stop Keywords ─────────────────────────────────────────────
const STOP_PHRASES = [
  "that's all", "thats all", "that's all po", "thats all po",
  "that's it", "thats it", "that's it po", "thats it po",
  "i'm done", "im done", "i am done",
  "done talking", "done speaking",
  "submit now", "submit answer", "submit that",
  "send it", "send answer", "send that",
  "finish", "finished", "end answer",
];

function checkStopKeyword(text) {
  const lower = text.toLowerCase().trim();
  return STOP_PHRASES.some(p => lower.endsWith(p) || lower === p);
}

function stripStopKeyword(text) {
  const lower = text.toLowerCase().trim();
  for (const p of STOP_PHRASES) {
    if (lower.endsWith(p)) {
      return text.slice(0, text.toLowerCase().lastIndexOf(p)).trim().replace(/[,.\s]+$/, '').trim();
    }
  }
  return text;
}

// ── Web Speech API (desktop only) ────────────────────────────
const WS_SILENCE_MS     = 2500; // finalize after this many ms of no new words (matches VAD_SILENCE_MS)
const WS_NO_WORDS_MS    = 10000; // give up if zero results in this window
let _wsNoWordsTimer = null;
let _recognitionStopping = false;

function _startRecognition(SR) {
  if (!isListening) return;

  if (recognition) {
    const old = recognition;
    recognition = null;
    _recognitionStopping = true;
    old.onstart = null; old.onresult = null; old.onerror = null; old.onend = null;
    try { old.abort(); } catch (_) {}
    _recognitionStopping = false;
  }

  let rec;
  try { rec = new SR(); }
  catch (e) { if (onErrorCb) onErrorCb('Could not initialise microphone: ' + e.message); return; }

  recognition = rec;
  rec.lang           = Config.SPEECH.LANG;
  rec.continuous     = true;   // desktop only — continuous works fine on Chrome
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  // No-words watchdog
  clearTimeout(_wsNoWordsTimer);
  _wsNoWordsTimer = setTimeout(() => {
    if (isListening && !fullTranscript.trim()) {
      console.log('[STT] No words detected — switching to Whisper');
      // Switch to Whisper instead of just giving up
      useWhisperFallback = true;
      _stopRecognitionClean();
      if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
      _startWhisperListening();
    }
  }, WS_NO_WORDS_MS);

  rec.onstart = () => {
    console.log('[STT] Web Speech started');
    if (onTranscriptCb) onTranscriptCb('🎙️ Listening…', false);
  };

  rec.onresult = (event) => {
    networkRetries = 0;
    clearTimeout(_wsNoWordsTimer); _wsNoWordsTimer = null;

    let interim = '', final_ = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final_ += r[0].transcript;
      else           interim += r[0].transcript;
    }
    if (final_) fullTranscript += final_ + ' ';

    const display = (fullTranscript + interim).trim();
    if (onTranscriptCb) onTranscriptCb(display || '🎙️ Listening…', false);

    const currentText = (fullTranscript + interim).trim();
    if (currentText && checkStopKeyword(currentText)) {
      const clean = stripStopKeyword(currentText);
      clearTimeout(silenceTimer); silenceTimer = null;
      fullTranscript = clean;
      _stopRecognitionClean();
      if (onTranscriptCb) onTranscriptCb(clean, true);
      if (onEndCb) onEndCb(clean);
      return;
    }

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
      }, WS_SILENCE_MS);
    }
  };

  rec.onerror = (event) => {
    if (rec !== recognition) return;
    const err = event.error;
    if (err === 'aborted') return;

    // no-speech on desktop: reset the no-words timer and keep going
    if (err === 'no-speech') {
      console.log('[STT] no-speech event — restarting recognition');
      recognition = null;
      rec.onstart = null; rec.onresult = null; rec.onerror = null; rec.onend = null;
      setTimeout(() => {
        if (isListening && !useWhisperFallback) {
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }
      }, 200);
      return;
    }

    console.warn('[STT] error:', err);

    if (err === 'network') {
      networkRetries++;
      console.log(`[STT] Network error — retry ${networkRetries}/${MAX_NETWORK_RETRIES}`);
      rec.onstart = null; rec.onresult = null; rec.onerror = null; rec.onend = null;
      recognition = null;
      try { rec.abort(); } catch (_) {}

      if (networkRetries < MAX_NETWORK_RETRIES && isListening) {
        setTimeout(() => {
          if (!isListening || useWhisperFallback) return;
          _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
        }, 400 * networkRetries);
        return;
      }
      // Persistent network errors → Whisper
      console.log('[STT] Switching to Whisper after network errors');
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
      clearTimeout(silenceTimer); clearTimeout(_wsNoWordsTimer);
      recognition = null;
      if (onErrorCb) onErrorCb('Microphone access denied. Please allow microphone access in your browser settings.');
      return;
    }

    if (isListening) {
      recognition = null;
      setTimeout(() => {
        if (isListening) _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
      }, 600);
    }
  };

  rec.onend = () => {
    if (rec !== recognition) return;
    if (!isListening) return;
    // continuous=true on desktop means onend only fires on error/abort — restart
    recognition = null;
    setTimeout(() => {
      if (isListening && !useWhisperFallback) {
        _startRecognition(window.SpeechRecognition || window.webkitSpeechRecognition);
      }
    }, 150);
  };

  try {
    rec.start();
  } catch (err) {
    console.error('[STT] start() failed:', err);
    recognition = null;
    if (err.name === 'InvalidStateError') {
      setTimeout(() => { if (isListening) _startRecognition(SR); }, 500);
    } else {
      if (onErrorCb) onErrorCb('Could not start microphone: ' + err.message);
    }
  }
}

function _stopRecognitionClean() {
  isListening = false;
  clearTimeout(silenceTimer); silenceTimer = null;
  clearTimeout(_wsNoWordsTimer); _wsNoWordsTimer = null;
  _stopWebSpeechVADMeter();
  if (recognition) {
    const r = recognition; recognition = null;
    r.onstart = null; r.onresult = null; r.onerror = null; r.onend = null;
    try { r.abort(); } catch (_) {}
  }
}

export function stopListening() {
  isListening    = false;
  whisperActive  = false;
  clearTimeout(silenceTimer);    silenceTimer    = null;
  clearTimeout(_wsNoWordsTimer); _wsNoWordsTimer = null;
  _stopWebSpeechVADMeter();
  _stopVadDebug();
  onTranscriptCb = null; onEndCb = null; onErrorCb = null; onLiveAudioCb = null;
  fullTranscript = '';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
    mediaRecorder = null;
  }
  if (recognition) {
    const r = recognition; recognition = null;
    r.onstart = null; r.onresult = null; r.onerror = null; r.onend = null;
    try { r.abort(); } catch (_) {}
  }
}

export function getIsListening() { return isListening; }
export function getPartialTranscript() { return fullTranscript.trim(); }

export function submitNow() {
  if (!isListening) return;

  if (recognition) {
    const text = fullTranscript.trim();
    _stopRecognitionClean();
    const _cb = onTranscriptCb, _end = onEndCb;
    onTranscriptCb = null; onEndCb = null; onErrorCb = null;
    if (text) { if (_cb) _cb(text, true); if (_end) _end(text); }
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    whisperActive = true;
    mediaRecorder.stop();
  }
}
