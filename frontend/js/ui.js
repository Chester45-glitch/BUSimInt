// js/ui.js — All DOM manipulation and rendering
import Config from './config.js';

// ── Screen Management ────────────────────────────────────────
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-hidden', 'true');
  });
  const t = document.getElementById(id);
  if (t) { t.classList.add('active'); t.setAttribute('aria-hidden', 'false'); }
}

// ── Setup Screen ─────────────────────────────────────────────
export function renderSetupScreen() {
  const typeGrid = document.getElementById('interview-type-grid');
  if (typeGrid) {
    typeGrid.innerHTML = Config.INTERVIEW_TYPES.map(t => `
      <button class="type-card" data-value="${t.value}" aria-label="${t.label}">
        <span class="type-icon type-icon--svg">${t.icon}</span>
        <span class="type-label">${t.label}</span>
      </button>`).join('');
  }
  const expGrid = document.getElementById('experience-grid');
  if (expGrid) {
    expGrid.innerHTML = Config.EXPERIENCE_LEVELS.map(l => `
      <button class="exp-card" data-value="${l.value}" aria-label="${l.label}">
        <span class="exp-label">${l.label}</span>
        <span class="exp-sub">${l.sub}</span>
      </button>`).join('');
  }
  const modeGrid = document.getElementById('mode-grid');
  if (modeGrid) {
    modeGrid.innerHTML = Config.MODES.map(m => `
      <button class="mode-card" data-value="${m.value}" aria-label="${m.label}">
        <span class="mode-icon">${m.icon}</span>
        <span class="mode-label">${m.label}</span>
        <span class="mode-desc">${m.desc}</span>
      </button>`).join('');
  }
}

export function selectCard(container, value) {
  container.querySelectorAll('[data-value]').forEach(c => {
    c.classList.toggle('selected', c.dataset.value === value);
  });
}

export function validateSetupAndGetErrors(config) {
  const e = [];
  if (!config.type) e.push('Please select an interview type');
  if (!config.experienceLevel) e.push('Please select your experience level');
  if (!config.mode) e.push('Please select a simulation mode');
  return e;
}

export function showSetupError(msg) {
  const el = document.getElementById('setup-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Interview Screen ─────────────────────────────────────────
export function setInterviewHeader(config) {
  const badge = document.getElementById('interview-type-badge');
  const modeBadge = document.getElementById('interview-mode-badge');
  if (badge) badge.textContent = config.jobTitle || config.type;
  if (modeBadge) {
    modeBadge.textContent = config.mode === 'voice' ? 'Voice Mode' : 'Chat Mode';
  }
}

export function appendMessage(role, content, animate = true) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `message message--${role}`;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatar = role === 'assistant'
    ? `<img src="./BUSimInt_Logo.png" alt="AI" style="width:100%;height:100%;object-fit:contain;border-radius:50%;">`
    : `<span style="font-size:.8rem;font-weight:700;color:var(--accent);">You</span>`;

  el.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-bubble">
        <p class="message-text">${escapeHTML(content)}</p>
      </div>
      <span class="message-time">${time}</span>
    </div>`;

  container.appendChild(el);
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  return el;
}

export function showTypingIndicator() {
  const container = document.getElementById('chat-messages');
  if (!container || document.getElementById('typing-indicator')) return;
  const el = document.createElement('div');
  el.id = 'typing-indicator';
  el.className = 'message message--assistant';
  el.innerHTML = `
    <div class="message-avatar"><img src="./BUSimInt_Logo.png" alt="AI" style="width:100%;height:100%;object-fit:contain;border-radius:50%;"></div>
    <div class="message-body">
      <div class="message-bubble">
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

export function hideTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

// ── Voice UI ─────────────────────────────────────────────────
export function setVoiceState(state) {
  const btn = document.getElementById('voice-btn');
  const status = document.getElementById('voice-status');
  const wave = document.getElementById('voice-wave');
  if (!btn) return;
  btn.className = `voice-btn voice-btn--${state}`;
  const labels = { idle: 'Click to speak', listening: 'Listening…', speaking: 'Interviewer speaking…', processing: 'Processing…' };
  if (status) status.textContent = labels[state] || '';
  if (wave) wave.classList.toggle('active', state === 'listening' || state === 'speaking');
}

export function updateVoiceTranscript(text) {
  const el = document.getElementById('voice-interim-text');
  if (!el) return;
  if (text && !text.startsWith('🎙️')) {
    // Real transcript words — show text, hide meter
    el.innerHTML = `<span class="voice-caption-text">${text}</span>`;
    el.style.display = 'block';
    const meter = document.getElementById('voice-live-meter');
    if (meter) meter.style.display = 'none';
  } else if (text) {
    // Placeholder (🎙️) — clear text, let meter show
    el.textContent = '';
    el.style.display = 'none';
  } else {
    el.textContent = '';
    el.style.display = 'none';
    const meter = document.getElementById('voice-live-meter');
    if (meter) meter.style.display = 'none';
  }
}

// Live audio level meter — shows a bar that pulses with the user's voice
let _meterBars = null;
export function setLiveMeter(rms) {
  let meter = document.getElementById('voice-live-meter');
  if (!meter) return;

  const textEl = document.getElementById('voice-interim-text');
  const hasText = textEl && textEl.querySelector('.voice-caption-text');
  if (hasText) return; // don't show meter while words are visible

  if (rms > 3) {
    meter.style.display = 'flex';
    // Map rms (0-100) to bar heights
    if (!_meterBars) _meterBars = Array.from(meter.querySelectorAll('.vm-bar'));
    const n = _meterBars.length;
    _meterBars.forEach((bar, i) => {
      // Each bar gets a slightly offset amplitude for a wave feel
      const offset = Math.abs(Math.sin((i / n) * Math.PI));
      const h = Math.max(4, Math.min(28, (rms / 100) * 28 * offset + 4));
      bar.style.height = h + 'px';
    });
  } else {
    meter.style.display = 'none';
  }
}

// ── Live Sidebar Reset ───────────────────────────────────────
// Call when starting a new chat to clear inherited emotion data
export function resetLiveSidebar() {
  const ring = document.getElementById('ering-fill');
  if (ring) {
    const circumference = 2 * Math.PI * 50; // 314.159
    ring.style.strokeDashoffset = circumference;
    ring.style.stroke = 'var(--accent)';
  }
  setText('ering-pct', '—');
  setText('emotion-live-label', 'Confidence');
  setBar('ebar-confident', 0);   setText('eval-confident',   '—');
  setBar('ebar-nervous',   0);   setText('eval-nervous',     '—');
  setBar('ebar-enthusiastic', 0); setText('eval-enthusiastic', '—');
  setText('live-strength-overall',   '—');
  setText('live-strength-clarity',   '—');
  setText('live-strength-relevance', '—');
  const tipCard = document.getElementById('live-tip-card');
  if (tipCard) tipCard.style.display = 'none';
}

// ── Live Sidebar Updates ─────────────────────────────────────
// Called after each user answer to give a "live feel" in the sidebar
// Uses simple heuristics since we don't run a real-time model per message
export function updateLiveSidebar(transcript) {
  const userMsgs = transcript.filter(m => m.role === 'user');
  if (userMsgs.length === 0) return;

  // Simple keyword-based sentiment for live updates (full analysis uses Gemini)
  const allText = userMsgs.map(m => m.content).join(' ').toLowerCase();
  const wordCount = allText.split(/\s+/).length;

  const confidentWords  = ['experience','achieved','led','built','improved','successfully','managed','implemented','delivered','created','designed'];
  const nervousWords    = ['um','uh','hmm','i think','i guess','maybe','not sure','i dont know','sorry','apologize'];
  const enthusiastWords = ['passionate','love','enjoy','excited','amazing','great','really','definitely','absolutely'];

  const score = (words) => words.filter(w => allText.includes(w)).length;

  const confScore  = Math.min(100, 30 + score(confidentWords)  * 10 + Math.min(30, wordCount / 5));
  const nervScore  = Math.max(0,  40 - score(nervousWords) * 8 + score(nervousWords) * 12);
  const enthScore  = Math.min(100, 20 + score(enthusiastWords) * 12);

  // Clamp
  const conf  = Math.round(Math.min(100, confScore));
  const nerv  = Math.round(Math.min(100, Math.max(0, nervScore)));
  const enth  = Math.round(Math.min(100, enthScore));

  // Dominant emotion
  const dominant = conf >= enth ? (conf >= 60 ? 'Confident' : 'Neutral') : 'Enthusiastic';

  // Update ring
  const ring = document.getElementById('ering-fill');
  if (ring) {
    const pct = conf;
    const circumference = 2 * Math.PI * 50; // = 314.159
    ring.style.strokeDashoffset = circumference - (pct / 100) * circumference;
    ring.style.stroke = pct >= 65 ? '#22C55E' : pct >= 45 ? '#F59E0B' : '#F43F5E';
  }
  setText('ering-pct', `${conf}%`);
  setText('emotion-live-label', dominant);

  // Bars
  setBar('ebar-confident', conf);   setText('eval-confident',   `${conf}%`);
  setBar('ebar-nervous',   nerv);   setText('eval-nervous',     `${nerv}%`);
  setBar('ebar-enthusiastic', enth); setText('eval-enthusiastic', `${enth}%`);

  // Strength estimates
  const avgWords = wordCount / userMsgs.length;
  const overallStr = Math.round(Math.min(100, 40 + avgWords * 1.5 + conf * 0.3));
  const clarityStr = Math.round(Math.min(100, 50 + conf * 0.4 - nerv * 0.2));
  const relevStr   = Math.round(Math.min(100, 45 + score(confidentWords) * 8));

  setText('live-strength-overall',   `${overallStr}%`);
  setText('live-strength-clarity',   `${clarityStr}%`);
  setText('live-strength-relevance', `${relevStr}%`);

  // Show a quick tip after 2+ answers
  if (userMsgs.length >= 2) {
    const tipCard = document.getElementById('live-tip-card');
    const tipText = document.getElementById('live-tip-text');
    if (tipCard && tipText) {
      const tips = nerv > 50
        ? 'Try to slow down and breathe before answering. Confidence comes through in your pace.'
        : avgWords < 30
        ? 'Try to expand your answers with specific examples using the STAR method.'
        : conf >= 65
        ? 'Great confidence! Keep including measurable results in your answers.'
        : 'Use concrete numbers and outcomes to strengthen your answers.';
      tipText.textContent = tips;
      tipCard.style.display = 'block';
    }
  }
}

// ── Toast ────────────────────────────────────────────────────
export function showToast(message, type = 'info', duration = 3000) {
  document.getElementById('toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast--${type}`;
  const label = type === 'error' ? 'Error' : type === 'success' ? 'Done' : 'Info';
  toast.innerHTML = `<span class="toast-label">${label}</span><span>${escapeHTML(message)}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ── End Modal ────────────────────────────────────────────────
export function showEndConfirmModal(onConfirm, onCancel) {
  const modal = document.getElementById('end-modal');
  if (!modal) return;
  modal.classList.add('modal--visible');
  const confirm = document.getElementById('modal-confirm-btn');
  const cancel  = document.getElementById('modal-cancel-btn');
  const cleanup = () => {
    confirm.removeEventListener('click', doConfirm);
    cancel.removeEventListener('click', doCancel);
  };
  const doConfirm = () => { modal.classList.remove('modal--visible'); cleanup(); onConfirm?.(); };
  const doCancel  = () => { modal.classList.remove('modal--visible'); cleanup(); onCancel?.(); };
  confirm.addEventListener('click', doConfirm);
  cancel.addEventListener('click', doCancel);
}

// ── Analysis Screen ──────────────────────────────────────────
export function renderAnalysis(analysisData, metadata) {
  const { analysis } = analysisData || {};
  if (!analysis) { showToast('Failed to load analysis', 'error'); return; }

  // Score ring
  setScoreRing(analysis.overallScore || 0);
  setText('overall-score-value', analysis.overallScore || '—');
  setText('readiness-level', analysis.readinessLevel || '—');
  setText('analysis-summary', analysis.summary || '');
  setText('top-tip', analysis.topTip || '');
  setText('emotion-dominant', analysis.emotionAnalysis?.dominant || '—');

  // Badges
  setText('analysis-job-title', metadata?.jobTitle || metadata?.interviewType || '');
  setText('analysis-question-count-badge', `${metadata?.totalExchanges || 0} questions`);

  // Emotion bars
  if (analysis.emotionAnalysis?.breakdown) {
    const b = analysis.emotionAnalysis.breakdown;
    const labels = { confident:'Confident', nervous:'Nervous', enthusiastic:'Enthusiastic', analytical:'Analytical' };
    document.getElementById('emotion-bars').innerHTML = Object.entries(b).map(([k,v]) => `
      <div class="metric-bar">
        <div class="metric-bar__header"><span>${labels[k]||k}</span><span class="metric-bar__value">${v}%</span></div>
        <div class="metric-bar__track"><div class="metric-bar__fill" style="--target:${v}%"></div></div>
      </div>`).join('');
  }

  // Answer strength bars
  if (analysis.answerStrength) {
    const labels = { relevance:'Relevance', structure:'Structure', specificity:'Specificity', communication:'Communication' };
    document.getElementById('strength-bars').innerHTML = Object.entries(analysis.answerStrength).map(([k,v]) => `
      <div class="metric-bar">
        <div class="metric-bar__header"><span>${labels[k]||k}</span><span class="metric-bar__value">${v}%</span></div>
        <div class="metric-bar__track"><div class="metric-bar__fill" style="--target:${v}%"></div></div>
      </div>`).join('');
  }

  // Strengths
  document.getElementById('strengths-list').innerHTML =
    (analysis.strengths || []).map(s => `<li class="strength-item"><span class="strength-check">✓</span>${escapeHTML(s)}</li>`).join('') || '<li>No specific strengths noted.</li>';

  // Improvements
  document.getElementById('improvements-list').innerHTML =
    (analysis.improvements || []).map(imp => `
      <div class="improvement-card">
        <div class="improvement-area">${escapeHTML(imp.area||'')}</div>
        <div class="improvement-issue">Issue: ${escapeHTML(imp.issue||'')}</div>
        <div class="improvement-suggestion">Tip: ${escapeHTML(imp.suggestion||'')}</div>
      </div>`).join('') || '<p>No improvements flagged.</p>';

  // Q&A feedback
  document.getElementById('question-feedback-list').innerHTML =
    (analysis.questionFeedback || []).map((item, i) => `
      <div class="qf-card">
        <div class="qf-header">
          <span class="qf-num">Q${i+1}</span>
          <span class="qf-score qf-score--${scoreClass(item.score)}">${item.score}/100</span>
        </div>
        <div class="qf-question">Question: ${escapeHTML(item.question||'')}</div>
        <div class="qf-answer">Your answer: ${escapeHTML(item.answer||'')}</div>
        <div class="qf-feedback">Feedback: ${escapeHTML(item.feedback||'')}</div>
      </div>`).join('');
}

function setScoreRing(score) {
  const fill = document.querySelector('#overall-score-ring .sring-fill');
  if (!fill) return;
  const r = 58, circ = 2 * Math.PI * r;
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = circ - (score / 100) * circ;
  fill.style.stroke = score >= 75 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#F43F5E';
}

export function triggerAnalysisAnimations() {
  setTimeout(() => {
    document.querySelectorAll('.metric-bar__fill').forEach(b => {
      b.style.width = b.style.getPropertyValue('--target') || '0%';
    });
  }, 250);
}

// ── Helpers ──────────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setBar(id, pct)  { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; }
function scoreClass(s)    { return s >= 75 ? 'good' : s >= 50 ? 'ok' : 'poor'; }

function escapeHTML(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export { escapeHTML };
