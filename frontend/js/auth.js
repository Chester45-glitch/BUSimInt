// js/auth.js — Google Auth state management
import Config from './config.js';

const AUTH_KEY = 'busimint_user';

let currentUser = null;

export function getUser() {
  if (currentUser) return currentUser;
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) currentUser = JSON.parse(stored);
  } catch (e) {}
  return currentUser;
}

export function setUser(user) {
  currentUser = user;
  if (user) localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  else localStorage.removeItem(AUTH_KEY);
}

export function isLoggedIn() {
  return !!getUser();
}

export function logout() {
  setUser(null);
  currentUser = null;
  // Sign out from Google
  if (window.google?.accounts?.id) {
    window.google.accounts.id.disableAutoSelect();
  }
}

// Verify Google credential with our backend and get user object
export async function verifyGoogleCredential(credential) {
  const res = await fetch(`${Config.API_BASE_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Authentication failed');
  }
  const data = await res.json();
  setUser(data.user);
  return data.user;
}
