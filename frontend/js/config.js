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
    { value: 'Software Engineering', label: 'Software Engineering', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/><line x1="2" y1="17" x2="22" y2="17"/><polyline points="9 9 12 12 9 15"/><line x1="13" y1="15" x2="16" y2="15"/></svg>` },
    { value: 'IT Support',           label: 'IT Support',           icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07M8.46 8.46a5 5 0 000 7.07"/></svg>` },
    { value: 'Customer Service',     label: 'Customer Service',     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.06 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.36 1.902.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.572 2.81.7A2 2 0 0122 16.92z"/></svg>` },
    { value: 'Nursing',              label: 'Nursing / Healthcare', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>` },
    { value: 'Business Management',  label: 'Business / Management',icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>` },
    { value: 'Marketing',            label: 'Marketing',            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>` },
    { value: 'Teaching',             label: 'Teaching / Education', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>` },
    { value: 'Finance',              label: 'Finance / Accounting', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>` },
    { value: 'General',              label: 'General / HR',         icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>` },
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
