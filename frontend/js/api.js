// js/api.js — All backend API communication
import Config from './config.js';

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${Config.API_BASE_URL}${endpoint}`;

  const defaultHeaders = { 'Content-Type': 'application/json' };

  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();

  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Cannot connect to server. Is the backend running?');
    }
    throw err;
  }
}

/**
 * Start a new interview session — get the opening message
 */
export async function startInterview(config) {
  return apiFetch('/interview/start', {
    method: 'POST',
    body: JSON.stringify({ config })
  });
}

/**
 * Send a user message and get the next interviewer response
 */
export async function sendMessage(messages, config) {
  return apiFetch('/interview/message', {
    method: 'POST',
    body: JSON.stringify({ messages, config })
  });
}

/**
 * Analyze the full interview transcript
 */
export async function analyzeInterview(transcript, config) {
  return apiFetch('/analysis/analyze', {
    method: 'POST',
    body: JSON.stringify({ transcript, config })
  });
}

/**
 * Convert text to speech audio
 * Returns { useBrowserTTS, audioContent?, text }
 */
export async function synthesizeSpeech(text, voice = 'default') {
  return apiFetch('/tts/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text, voice })
  });
}

/**
 * Health check
 */
export async function checkHealth() {
  return apiFetch('/health');
}
