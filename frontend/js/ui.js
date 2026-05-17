// js/ui.js — All DOM manipulation and rendering functions
import Config from './config.js';

// ─── Screen Management ────────────────────────────────────────────────────────

export function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-hidden', 'true');
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    target.setAttribute('aria-hidden', 'false');
  }
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

export function renderSetupScreen() {
  // Render interview type cards
  const typeGrid = document.getElementById('interview-type-grid');
  if (typeGrid) {
    typeGrid.innerHTML = Config.INTERVIEW_TYPES.map(t => `
      <button class="type-card" data-value="${t.value}" style="--accent: ${t.color}" 
              aria-label="Select ${t.label} interview type">
        <span class="type-icon">${t.icon}</span>
        <span class="type-label">${t.label}</span>
      </button>
    `).join('');
  }

  // Render experience level options
  const expGrid = document.getElementById('experience-grid');
  if (expGrid) {
    expGrid.innerHTML = Config.EXPERIENCE_LEVELS.map(l => `
      <button class="exp-card" data-value="${l.value}" aria-label="Select ${l.label} experience level">
        <span class="exp-label">${l.label}</span>
        <span class="exp-sub">${l.sub}</span>
      </button>
    `).join('');
  }

  // Render mode options
  const modeGrid = document.getElementById('mode-grid');
  if (modeGrid) {
    modeGrid.innerHTML = Config.MODES.map(m => `
      <button class="mode-card" data-value="${m.value}" aria-label="Select ${m.label}">
        <span class="mode-icon">${m.icon}</span>
        <span class="mode-label">${m.label}</span>
        <span class="mode-desc">${m.desc}</span>
      </button>
    `).join('');
  }
}

export function selectCard(container, value) {
  container.querySelectorAll('.type-card, .exp-card, .mode-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === value);
  });
}

export function validateSetupAndGetErrors(config) {
  const errors = [];
  if (!config.type) errors.push('Please select an interview type');
  if (!config.experienceLevel) errors.push('Please select your experience level');
  if (!config.mode) errors.push('Please select a simulation mode');
  return errors;
}

export function showSetupError(message) {
  const el = document.getElementById('setup-error');
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

// ─── Chat / Interview Screen ──────────────────────────────────────────────────

/**
 * Append a message bubble to the chat
 */
export function appendMessage(role, content, animate = true) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const messageEl = document.createElement('div');
  messageEl.className = `message message--${role}${animate ? ' message--entering' : ''}`;

  const avatar = role === 'assistant'
    ? `<div class="message-avatar">🤵</div>`
    : `<div class="message-avatar">👤</div>`;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  messageEl.innerHTML = `
    ${avatar}
    <div class="message-body">
      <div class="message-bubble">
        <p class="message-text">${escapeHTML(content)}</p>
      </div>
      <span class="message-time">${time}</span>
    </div>
  `;

  // Add speak button for assistant messages (chat mode)
  if (role === 'assistant') {
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.innerHTML = '🔊';
    speakBtn.title = 'Read aloud';
    speakBtn.setAttribute('data-content', content);
    speakBtn.setAttribute('aria-label', 'Read this message aloud');
    messageEl.querySelector('.message-bubble').appendChild(speakBtn);
  }

  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (animate) {
      requestAnimationFrame(() => messageEl.classList.remove('message--entering'));
    }
  });

  return messageEl;
}

/**
 * Show typing indicator while waiting for response
 */
export function showTypingIndicator() {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages || document.getElementById('typing-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  indicator.className = 'message message--assistant typing-indicator';
  indicator.innerHTML = `
    <div class="message-avatar">🤵</div>
    <div class="message-body">
      <div class="message-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;

  chatMessages.appendChild(indicator);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

/**
 * Set interview header info
 */
export function setInterviewHeader(config) {
  const badge = document.getElementById('interview-type-badge');
  const modeBadge = document.getElementById('interview-mode-badge');

  if (badge) {
    const typeInfo = Config.INTERVIEW_TYPES.find(t => t.value === config.type);
    badge.textContent = `${typeInfo?.icon || '💼'} ${config.jobTitle || config.type}`;
    badge.style.setProperty('--accent', typeInfo?.color || '#6C63FF');
  }

  if (modeBadge) {
    modeBadge.textContent = config.mode === 'voice' ? '🎙️ Voice Mode' : '💬 Chat Mode';
    modeBadge.classList.toggle('voice-mode', config.mode === 'voice');
  }
}

// ─── Voice UI ─────────────────────────────────────────────────────────────────

export function setVoiceState(state) {
  // state: 'idle' | 'listening' | 'speaking' | 'processing'
  const voiceBtn = document.getElementById('voice-btn');
  const voiceStatus = document.getElementById('voice-status');
  const voiceWave = document.getElementById('voice-wave');

  if (!voiceBtn) return;

  voiceBtn.dataset.state = state;
  voiceBtn.className = `voice-btn voice-btn--${state}`;

  const statusMessages = {
    idle: 'Click to speak',
    listening: 'Listening...',
    speaking: 'Interviewer speaking...',
    processing: 'Processing...'
  };

  if (voiceStatus) voiceStatus.textContent = statusMessages[state] || '';
  if (voiceWave) voiceWave.classList.toggle('active', state === 'listening' || state === 'speaking');
}

export function updateVoiceTranscript(text) {
  const el = document.getElementById('voice-interim-text');
  if (el) {
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }
}

// ─── Loading / Error States ───────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 3000) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span>
    <span class="toast-text">${escapeHTML(message)}</span>
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/**
 * Show the end session confirmation modal
 */
export function showEndConfirmModal(onConfirm, onCancel) {
  const modal = document.getElementById('end-modal');
  if (!modal) return;

  modal.classList.add('modal--visible');

  const confirmBtn = document.getElementById('modal-confirm-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');

  const handleConfirm = () => {
    modal.classList.remove('modal--visible');
    cleanup();
    if (onConfirm) onConfirm();
  };

  const handleCancel = () => {
    modal.classList.remove('modal--visible');
    cleanup();
    if (onCancel) onCancel();
  };

  const cleanup = () => {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  };

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
}

// ─── Analysis Screen ──────────────────────────────────────────────────────────

export function renderAnalysis(analysisData, metadata) {
  const { analysis } = analysisData || {};
  if (!analysis) {
    showToast('Failed to load analysis', 'error');
    return;
  }

  // Overall score ring
  setScoreRing('overall-score-ring', analysis.overallScore || 0);
  setTextContent('overall-score-value', `${analysis.overallScore || 0}`);
  setTextContent('readiness-level', analysis.readinessLevel || '—');
  setTextContent('analysis-summary', analysis.summary || '');
  setTextContent('top-tip', analysis.topTip || '');

  // Emotion analysis
  if (analysis.emotionAnalysis) {
    const em = analysis.emotionAnalysis;
    setTextContent('emotion-dominant', em.dominant || '—');
    renderEmotionBars(em);
  }

  // Answer strength bars
  if (analysis.answerStrength) {
    const as = analysis.answerStrength;
    renderStrengthBars(as);
  }

  // Strengths list
  renderStrengths(analysis.strengths || []);

  // Improvements list
  renderImprovements(analysis.improvements || []);

  // Question-by-question feedback
  renderQuestionFeedback(analysis.questionFeedback || []);

  // Metadata
  setTextContent('analysis-job-title', metadata?.jobTitle || metadata?.interviewType || '');
  setTextContent('analysis-question-count', metadata?.totalExchanges || 0);
}

function setScoreRing(id, score) {
  const ring = document.getElementById(id);
  if (!ring) return;
  const circle = ring.querySelector('.score-ring__fill');
  if (!circle) return;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = offset;

  // Color based on score
  const color = score >= 75 ? '#4ECDC4' : score >= 50 ? '#FFD93D' : '#FF6B6B';
  circle.style.stroke = color;
}

function renderEmotionBars(em) {
  const container = document.getElementById('emotion-bars');
  if (!container || !em.breakdown) return;

  const labels = { confident: '💪 Confident', nervous: '😰 Nervous', enthusiastic: '🔥 Enthusiastic', analytical: '🧠 Analytical' };

  container.innerHTML = Object.entries(em.breakdown).map(([key, val]) => `
    <div class="metric-bar">
      <div class="metric-bar__header">
        <span>${labels[key] || key}</span>
        <span class="metric-bar__value">${val}%</span>
      </div>
      <div class="metric-bar__track">
        <div class="metric-bar__fill" style="--target: ${val}%"></div>
      </div>
    </div>
  `).join('');
}

function renderStrengthBars(as) {
  const container = document.getElementById('strength-bars');
  if (!container) return;

  const labels = {
    relevance: '🎯 Relevance',
    structure: '🏗️ Structure',
    specificity: '🔍 Specificity',
    communication: '🗣️ Communication'
  };

  container.innerHTML = Object.entries(as).map(([key, val]) => `
    <div class="metric-bar">
      <div class="metric-bar__header">
        <span>${labels[key] || key}</span>
        <span class="metric-bar__value">${val}%</span>
      </div>
      <div class="metric-bar__track">
        <div class="metric-bar__fill" style="--target: ${val}%"></div>
      </div>
    </div>
  `).join('');
}

function renderStrengths(strengths) {
  const container = document.getElementById('strengths-list');
  if (!container) return;
  container.innerHTML = strengths.map(s => `
    <li class="strength-item"><span class="strength-check">✓</span>${escapeHTML(s)}</li>
  `).join('') || '<li>No specific strengths identified.</li>';
}

function renderImprovements(improvements) {
  const container = document.getElementById('improvements-list');
  if (!container) return;
  container.innerHTML = improvements.map(imp => `
    <div class="improvement-card">
      <div class="improvement-area">${escapeHTML(imp.area || '')}</div>
      <div class="improvement-issue">⚠️ ${escapeHTML(imp.issue || '')}</div>
      <div class="improvement-suggestion">💡 ${escapeHTML(imp.suggestion || '')}</div>
    </div>
  `).join('') || '<p>No improvements suggested.</p>';
}

function renderQuestionFeedback(feedbackList) {
  const container = document.getElementById('question-feedback-list');
  if (!container) return;
  container.innerHTML = feedbackList.map((item, i) => `
    <div class="qf-card">
      <div class="qf-header">
        <span class="qf-num">Q${i + 1}</span>
        <span class="qf-score qf-score--${getScoreClass(item.score)}">${item.score}/100</span>
      </div>
      <div class="qf-question">❓ ${escapeHTML(item.question || '')}</div>
      <div class="qf-answer">💬 ${escapeHTML(item.answer || '')}</div>
      <div class="qf-feedback">📝 ${escapeHTML(item.feedback || '')}</div>
    </div>
  `).join('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getScoreClass(score) {
  if (score >= 75) return 'good';
  if (score >= 50) return 'ok';
  return 'poor';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { escapeHTML };
