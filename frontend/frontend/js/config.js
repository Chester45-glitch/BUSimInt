// js/config.js — Central configuration
const Config = {
  API_BASE_URL: (() => {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001/api';
    return 'https://busimint.onrender.com/api';
  })(),

  // Your Google OAuth Client ID from Google Cloud Console
  // Authorized origins: https://bu-simint.vercel.app
  // Authorized redirect URIs: https://bu-simint.vercel.app
  GOOGLE_CLIENT_ID: '319842770289-crkihr84al4t270s38p918aj0d2pd8fe.apps.googleusercontent.com',

  INTERVIEW_TYPES: [
    { value: 'Software Engineering', label: 'Software Engineering', icon: '💻' },
    { value: 'IT Support',           label: 'IT Support',           icon: '🛠️' },
    { value: 'Customer Service',     label: 'Customer Service',     icon: '🎧' },
    { value: 'Nursing',              label: 'Nursing / Healthcare', icon: '🏥' },
    { value: 'Business Management',  label: 'Business / Management',icon: '📊' },
    { value: 'Marketing',            label: 'Marketing',            icon: '📣' },
    { value: 'Teaching',             label: 'Teaching / Education', icon: '📚' },
    { value: 'Finance',              label: 'Finance / Accounting', icon: '💰' },
    { value: 'General',              label: 'General / HR',         icon: '👔' },
  ],

  EXPERIENCE_LEVELS: [
    { value: 'Entry Level (0-1 years)', label: 'Entry Level', sub: '0–1 yrs' },
    { value: 'Junior (1-3 years)',      label: 'Junior',      sub: '1–3 yrs' },
    { value: 'Mid-Level (3-5 years)',   label: 'Mid-Level',   sub: '3–5 yrs' },
    { value: 'Senior (5+ years)',       label: 'Senior',      sub: '5+ yrs'  },
  ],

  MODES: [
    { value: 'chat',  label: 'Chat Mode',  icon: '✍', desc: 'Type your responses' },
    { value: 'voice', label: 'Voice Mode', icon: '◎', desc: 'Speak your responses' },
  ],

  SPEECH: { LANG: 'en-US', SILENCE_TIMEOUT_MS: 2500 },
};

export default Config;
