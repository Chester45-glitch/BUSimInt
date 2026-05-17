// js/config.js — Central configuration for the frontend
const Config = {
  // Backend API base URL — change this to your Render deployment URL in production
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://busimint.onrender.com', // ← Update this after deploying to Render

  // Interview types available in the setup screen
  INTERVIEW_TYPES: [
    { value: 'Software Engineering', label: 'Software Engineering', icon: '💻', color: '#6C63FF' },
    { value: 'IT Support', label: 'IT Support', icon: '🛠️', color: '#3ECFCF' },
    { value: 'Customer Service', label: 'Customer Service', icon: '🎧', color: '#FF6B6B' },
    { value: 'Nursing', label: 'Nursing / Healthcare', icon: '🏥', color: '#4ECDC4' },
    { value: 'Business Management', label: 'Business / Management', icon: '📊', color: '#FFD93D' },
    { value: 'Marketing', label: 'Marketing', icon: '📣', color: '#FF8C42' },
    { value: 'Teaching', label: 'Teaching / Education', icon: '📚', color: '#95E1D3' },
    { value: 'Finance', label: 'Finance / Accounting', icon: '💰', color: '#F38181' },
    { value: 'General', label: 'General / HR', icon: '👔', color: '#A8E6CF' },
  ],

  EXPERIENCE_LEVELS: [
    { value: 'Entry Level (0-1 years)', label: 'Entry Level', sub: '0–1 years' },
    { value: 'Junior (1-3 years)', label: 'Junior', sub: '1–3 years' },
    { value: 'Mid-Level (3-5 years)', label: 'Mid-Level', sub: '3–5 years' },
    { value: 'Senior (5+ years)', label: 'Senior', sub: '5+ years' },
  ],

  MODES: [
    { value: 'chat', label: 'Chat Mode', icon: '💬', desc: 'Type your responses' },
    { value: 'voice', label: 'Voice Mode', icon: '🎙️', desc: 'Speak your responses' },
  ],

  // Speech recognition settings
  SPEECH: {
    LANG: 'en-US',
    SILENCE_TIMEOUT_MS: 2500, // Auto-submit after this much silence
  },

  // App version
  VERSION: '1.0.0'
};

export default Config;
