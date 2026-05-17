// js/speech.js — Text-to-Speech and Speech-to-Text handling
import { synthesizeSpeech } from './api.js';
import Config from './config.js';

// ─── Text to Speech ─────────────────────────────────────────────────────────

let currentAudio = null;
let isSpeaking = false;

/**
 * Speak text using Google TTS (via API) or browser fallback
 */
export async function speakText(text, onStart, onEnd) {
  // Stop any currently playing audio
  stopSpeaking();

  if (!text || text.trim() === '') return;

  try {
    const result = await synthesizeSpeech(text);

    if (result.useBrowserTTS) {
      // Use browser's built-in speech synthesis as fallback
      browserSpeak(text, onStart, onEnd);
    } else {
      // Play Google TTS audio
      const audioBlob = base64ToBlob(result.audioContent, result.mimeType || 'audio/mpeg');
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudio = new Audio(audioUrl);

      currentAudio.onplay = () => {
        isSpeaking = true;
        if (onStart) onStart();
      };

      currentAudio.onended = () => {
        isSpeaking = false;
        URL.revokeObjectURL(audioUrl);
        if (onEnd) onEnd();
      };

      currentAudio.onerror = () => {
        // Fallback to browser TTS if audio fails
        browserSpeak(text, onStart, onEnd);
      };

      await currentAudio.play();
    }
  } catch (err) {
    console.warn('[Speech] TTS API failed, using browser fallback:', err.message);
    browserSpeak(text, onStart, onEnd);
  }
}

/**
 * Browser's native speech synthesis fallback
 */
function browserSpeak(text, onStart, onEnd) {
  if (!window.speechSynthesis) {
    console.warn('[Speech] Browser TTS not supported');
    if (onEnd) onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = Config.SPEECH.LANG;
  utterance.rate = 0.95;
  utterance.pitch = 1;

  // Prefer a clear, professional voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.includes('Google US English') ||
    v.name.includes('Microsoft Mark') ||
    v.name.includes('Daniel') ||
    (v.lang === 'en-US' && !v.name.includes('Female'))
  );
  if (preferred) utterance.voice = preferred;

  utterance.onstart = () => {
    isSpeaking = true;
    if (onStart) onStart();
  };

  utterance.onend = () => {
    isSpeaking = false;
    if (onEnd) onEnd();
  };

  utterance.onerror = () => {
    isSpeaking = false;
    if (onEnd) onEnd();
  };

  window.speechSynthesis.speak(utterance);
}

/**
 * Stop any currently playing audio
 */
export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  isSpeaking = false;
}

export function getIsSpeaking() {
  return isSpeaking;
}

// ─── Speech Recognition ──────────────────────────────────────────────────────

let recognition = null;
let silenceTimer = null;
let isListening = false;

/**
 * Check if speech recognition is supported
 */
export function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start speech recognition
 * @param {function} onTranscript - Called with (text, isFinal)
 * @param {function} onEnd - Called when recognition ends
 * @param {function} onError - Called with error message
 */
export function startListening(onTranscript, onEnd, onError) {
  if (isListening) stopListening();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    if (onError) onError('Speech recognition is not supported in this browser. Please use Chrome.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = Config.SPEECH.LANG;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let fullTranscript = '';

  recognition.onstart = () => {
    isListening = true;
    fullTranscript = '';
  };

  recognition.onresult = (event) => {
    let interimText = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interimText += result[0].transcript;
      }
    }

    if (finalText) {
      fullTranscript += finalText + ' ';
    }

    const displayText = fullTranscript + interimText;
    if (onTranscript) onTranscript(displayText.trim(), false);

    // Reset silence timer
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (fullTranscript.trim()) {
        if (onTranscript) onTranscript(fullTranscript.trim(), true);
        stopListening();
        if (onEnd) onEnd(fullTranscript.trim());
      }
    }, Config.SPEECH.SILENCE_TIMEOUT_MS);
  };

  recognition.onerror = (event) => {
    isListening = false;
    clearTimeout(silenceTimer);
    if (event.error === 'no-speech') {
      if (onEnd) onEnd('');
      return;
    }
    if (onError) onError(`Microphone error: ${event.error}`);
  };

  recognition.onend = () => {
    if (isListening) {
      // Restart if we stopped unexpectedly without manual stop
      try { recognition.start(); } catch (e) { /* already stopped */ }
    }
  };

  try {
    recognition.start();
  } catch (err) {
    if (onError) onError('Could not access microphone: ' + err.message);
  }
}

/**
 * Stop speech recognition
 */
export function stopListening() {
  isListening = false;
  clearTimeout(silenceTimer);

  if (recognition) {
    try {
      recognition.onend = null; // Prevent restart
      recognition.stop();
    } catch (e) { /* ignore */ }
    recognition = null;
  }
}

export function getIsListening() {
  return isListening;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNums)], { type: mimeType });
}
