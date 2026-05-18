// js/api.js — All backend API communication
import Config from './config.js';
import { getUser } from './auth.js';

async function apiFetch(endpoint, options = {}) {
  const url = `${Config.API_BASE_URL}${endpoint}`;
  const user = getUser();

  const headers = {
    'Content-Type': 'application/json',
    ...(user ? { 'x-user-id': user.id } : {}),
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Cannot connect to server. Is the backend running?');
    }
    throw err;
  }
}

export async function startInterview(config) {
  return apiFetch('/interview/start', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

export async function sendMessage(messages, config, sessionId) {
  return apiFetch('/interview/message', {
    method: 'POST',
    body: JSON.stringify({ messages, config, sessionId }),
  });
}

export async function analyzeInterview(transcript, config, sessionId) {
  return apiFetch('/analysis/analyze', {
    method: 'POST',
    body: JSON.stringify({ transcript, config, sessionId }),
  });
}

export async function synthesizeSpeech(text) {
  return apiFetch('/tts/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}
