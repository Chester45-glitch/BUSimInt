// js/interviewState.js — Manages all interview session state
const InterviewState = {
  // Config set during setup
  config: {
    type: '',
    jobTitle: '',
    experienceLevel: '',
    mode: 'chat', // 'chat' | 'voice'
    voiceGender: 'default'
  },

  // The full conversation transcript
  // Each item: { role: 'user'|'assistant', content: string, timestamp: string }
  transcript: [],

  // UI state
  isActive: false,        // Interview is in progress
  isLoading: false,       // Waiting for AI response
  isSpeaking: false,      // AI is speaking (voice mode)
  isListening: false,     // User mic is active
  sessionId: null,

  // ─── Mutators ───────────────────────────────────────────────────────────

  setConfig(updates) {
    this.config = { ...this.config, ...updates };
  },

  startSession(sessionId) {
    this.isActive = true;
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.transcript = [];
  },

  endSession() {
    this.isActive = false;
    this.isListening = false;
    this.isSpeaking = false;
    this.isLoading = false;
  },

  addMessage(role, content) {
    const message = {
      role,
      content,
      timestamp: new Date().toISOString()
    };
    this.transcript.push(message);
    return message;
  },

  setLoading(val) {
    this.isLoading = val;
  },

  setSpeaking(val) {
    this.isSpeaking = val;
  },

  setListening(val) {
    this.isListening = val;
  },

  // ─── Getters ─────────────────────────────────────────────────────────────

  // Returns messages in the format expected by the API (role + content only)
  getApiMessages() {
    return this.transcript.map(({ role, content }) => ({ role, content }));
  },

  getUserAnswers() {
    return this.transcript.filter(m => m.role === 'user');
  },

  getInterviewerQuestions() {
    return this.transcript.filter(m => m.role === 'assistant');
  },

  getMessageCount() {
    return this.transcript.length;
  },

  isVoiceMode() {
    return this.config.mode === 'voice';
  },

  // ─── Persistence (localStorage for session recovery) ─────────────────────

  saveToStorage() {
    try {
      localStorage.setItem('interview_session', JSON.stringify({
        config: this.config,
        transcript: this.transcript,
        sessionId: this.sessionId,
        savedAt: new Date().toISOString()
      }));
    } catch (e) {
      // Storage full or unavailable — ignore
    }
  },

  loadFromStorage() {
    try {
      const saved = localStorage.getItem('interview_session');
      if (saved) {
        const data = JSON.parse(saved);
        this.config = data.config || this.config;
        this.transcript = data.transcript || [];
        this.sessionId = data.sessionId;
        return true;
      }
    } catch (e) {
      // Corrupt data — ignore
    }
    return false;
  },

  clearStorage() {
    localStorage.removeItem('interview_session');
  },

  reset() {
    this.config = { type: '', jobTitle: '', experienceLevel: '', mode: 'chat', voiceGender: 'default' };
    this.transcript = [];
    this.isActive = false;
    this.isLoading = false;
    this.isSpeaking = false;
    this.isListening = false;
    this.sessionId = null;
    this.clearStorage();
  }
};

export default InterviewState;
