// js/config.js — Central configuration
// ⚠️ REPLACE the URL below with your actual Render backend URL
const Config = {
  API_BASE_URL: (() => {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001/api';
    // 🔴 CHANGE THIS to your real Render URL, e.g.:
    // return 'https://interview-sim-api.onrender.com/api';
    return 'https://busimint.onrender.com/api';
  })(),

  INTERVIEW_TYPES: [
    { value: 'Software Engineering', label: 'Software Engineering', icon: '💻', color: '#6366F1' },
    { value: 'IT Support',           label: 'IT Support',           icon: '🛠️', color: '#0EA5E9' },
    { value: 'Customer Service',     label: 'Customer Service',     icon: '🎧', color: '#F43F5E' },
    { value: 'Nursing',              label: 'Nursing / Healthcare', icon: '🏥', color: '#10B981' },
    { value: 'Business Management',  label: 'Business / Management',icon: '📊', color: '#F59E0B' },
    { value: 'Marketing',            label: 'Marketing',            icon: '📣', color: '#8B5CF6' },
    { value: 'Teaching',             label: 'Teaching / Education', icon: '📚', color: '#06B6D4' },
    { value: 'Finance',              label: 'Finance / Accounting', icon: '💰', color: '#84CC16' },
    { value: 'General',              label: 'General / HR',         icon: '👔', color: '#6B7280' },
  ],

  EXPERIENCE_LEVELS: [
    { value: 'Entry Level (0-1 years)', label: 'Entry Level', sub: '0–1 yrs' },
    { value: 'Junior (1-3 years)',       label: 'Junior',      sub: '1–3 yrs' },
    { value: 'Mid-Level (3-5 years)',    label: 'Mid-Level',   sub: '3–5 yrs' },
    { value: 'Senior (5+ years)',        label: 'Senior',      sub: '5+ yrs'  },
  ],

  MODES: [
    { value: 'chat',  label: 'Chat Mode',  icon: '💬', desc: 'Type your responses' },
    { value: 'voice', label: 'Voice Mode', icon: '🎙️', desc: 'Speak your responses' },
  ],

  SPEECH: { LANG: 'en-US', SILENCE_TIMEOUT_MS: 2500 },
};

export default Config;
