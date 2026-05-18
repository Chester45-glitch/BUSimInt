// js/app.js — Main application controller
import Config from './config.js';
import InterviewState from './interviewState.js';
import { getUser, isLoggedIn } from './auth.js';
import { startInterview, sendMessage, analyzeInterview } from './api.js';
import { renderSidebar, highlightActiveSession } from './history.js';
import {
  speakText, stopSpeaking, startListening, stopListening, isSpeechRecognitionSupported
} from './speech.js';
import {
  showScreen, renderSetupScreen, selectCard, validateSetupAndGetErrors,
  showSetupError, appendMessage, showTypingIndicator, hideTypingIndicator,
  setInterviewHeader, setVoiceState, updateVoiceTranscript,
  showToast, showEndConfirmModal, renderAnalysis, triggerAnalysisAnimations,
  updateLiveSidebar, resetLiveSidebar
} from './ui.js';

// ── Init ─────────────────────────────────────────────────────
function init() {
  if (!isLoggedIn()) {
    showScreen('login-screen');
    initGoogleLogin();
    return;
  }

  showAppShell();
  renderSetupScreen();
  bindSetupEvents();
  bindInterviewEvents();
  bindModalEvents();
  showScreen('setup-screen');

  // Load sidebar history
  renderSidebar(handleLoadSession, handleNewChat);
}

function showAppShell() {
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('login-screen').style.display = 'none';
}

// ── Google Login ──────────────────────────────────────────────
function initGoogleLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';

  // Load Google Identity Services script
  if (!window.google) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = setupGoogleButton;
    document.head.appendChild(script);
  } else {
    setupGoogleButton();
  }
}

function setupGoogleButton() {
  if (!Config.GOOGLE_CLIENT_ID || Config.GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE')) {
    document.getElementById('google-btn-container').innerHTML =
      `<div style="color:#e53e3e;font-size:.85rem;padding:12px;text-align:center;">
        ⚠️ Google Client ID not configured.<br>
        Set <code>GOOGLE_CLIENT_ID</code> in <code>config.js</code>.
      </div>`;
    return;
  }

  window.google.accounts.id.initialize({
    client_id: Config.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  window.google.accounts.id.renderButton(
    document.getElementById('google-btn-container'),
    {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      locale: 'en',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: 360,
    }
  );
}

async function handleGoogleCredential(response) {
  const btn = document.getElementById('google-btn-container');
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    showLoginLoading(true);
    const { verifyGoogleCredential } = await import('./auth.js');
    await verifyGoogleCredential(response.credential);

    // Refresh page to boot into app
    window.location.reload();
  } catch (err) {
    console.error('[Login]', err);
    errEl.textContent = `Sign-in failed: ${err.message}`;
    errEl.style.display = 'block';
    showLoginLoading(false);
  }
}

function showLoginLoading(loading) {
  const spinner = document.getElementById('login-spinner');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
}

// ── New Chat / Load Session ───────────────────────────────────
function handleNewChat() {
  InterviewState.reset();
  document.getElementById('chat-messages').innerHTML = '';
  const ta = document.getElementById('chat-input');
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  // Reset live sidebar emotion panels so previous session data doesn't bleed
  resetLiveSidebar();
  showScreen('setup-screen');
  renderSetupScreen();
  document.querySelectorAll('.sidebar-session-item').forEach(el => el.classList.remove('active'));
}

async function handleLoadSession(sessionId) {
  // TODO: load past session transcript and analysis into view
  showToast('Loading past session…', 'info');
  highlightActiveSession(sessionId);

  const { fetchSession } = await import('./history.js');
  const data = await fetchSession(sessionId);
  if (!data) { showToast('Could not load session', 'error'); return; }

  const { session, messages, analysis } = data;

  if (analysis) {
    // Show analysis screen for completed sessions
    InterviewState.setConfig({
      type: session.interview_type,
      jobTitle: session.job_title,
      experienceLevel: session.experience_level,
      mode: session.mode,
    });
    showScreen('analysis-screen');

    const loading = document.getElementById('analysis-loading');
    const content = document.getElementById('analysis-content');
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    renderAnalysis(
      { analysis },
      { totalExchanges: messages.filter(m => m.role === 'user').length, jobTitle: session.job_title, interviewType: session.interview_type }
    );
    triggerAnalysisAnimations();
  } else {
    // Active session — resume chat view
    document.getElementById('chat-messages').innerHTML = '';
    InterviewState.reset();
    resetLiveSidebar();
    InterviewState.setConfig({
      type: session.interview_type,
      jobTitle: session.job_title,
      experienceLevel: session.experience_level,
      mode: session.mode || 'chat',
    });
    InterviewState.startSession(sessionId);

    messages.forEach(m => {
      InterviewState.addMessage(m.role, m.content);
      appendMessage(m.role, m.content, false);
    });

    setInterviewHeader(InterviewState.config);
    showScreen('interview-screen');
    if (InterviewState.isVoiceMode()) showVoiceUI();
    else showChatUI();
  }
}

// ── Setup Events ─────────────────────────────────────────────
function bindSetupEvents() {
  document.getElementById('interview-type-grid').addEventListener('click', e => {
    const card = e.target.closest('.type-card');
    if (!card) return;
    InterviewState.setConfig({ type: card.dataset.value });
    selectCard(document.getElementById('interview-type-grid'), card.dataset.value);
  });

  document.getElementById('experience-grid').addEventListener('click', e => {
    const card = e.target.closest('.exp-card');
    if (!card) return;
    InterviewState.setConfig({ experienceLevel: card.dataset.value });
    selectCard(document.getElementById('experience-grid'), card.dataset.value);
  });

  document.getElementById('mode-grid').addEventListener('click', e => {
    const card = e.target.closest('.mode-card');
    if (!card) return;
    if (card.dataset.value === 'voice' && !isSpeechRecognitionSupported()) {
      showToast('Voice input requires Chrome or Edge browser.', 'error'); return;
    }
    InterviewState.setConfig({ mode: card.dataset.value });
    selectCard(document.getElementById('mode-grid'), card.dataset.value);
  });

  document.getElementById('job-title-input').addEventListener('input', e => {
    InterviewState.setConfig({ jobTitle: e.target.value.trim() });
  });

  document.getElementById('start-btn').addEventListener('click', handleStartInterview);
}

// ── Start Interview ───────────────────────────────────────────
async function handleStartInterview() {
  const errors = validateSetupAndGetErrors(InterviewState.config);
  if (errors.length) { showSetupError(errors[0]); return; }

  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const data = await startInterview(InterviewState.config);
    InterviewState.startSession(data.sessionId);
    InterviewState.addMessage('assistant', data.message);

    // Reset live sidebar for fresh session
    resetLiveSidebar();

    setInterviewHeader(InterviewState.config);
    highlightActiveSession(data.sessionId);

    // Refresh sidebar to show new session
    renderSidebar(handleLoadSession, handleNewChat);

    showScreen('interview-screen');

    if (InterviewState.isVoiceMode()) {
      showVoiceUI();
      appendMessage('assistant', data.message);
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      await speakText(data.message, () => setVoiceState('speaking'), () => {
        InterviewState.setSpeaking(false);
        setVoiceState('idle');
        setInputEnabled(true); // re-enable voice button after opening question
      });
    } else {
      showChatUI();
      appendMessage('assistant', data.message);
    }
  } catch (err) {
    console.error('[Start]', err);
    showSetupError(`Failed to start: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Start Interview <span class="btn-arrow">→</span>';
  }
}

function showChatUI() {
  document.getElementById('chat-interface').style.display = 'flex';
  document.getElementById('voice-interface').style.display = 'none';
  setTimeout(() => document.getElementById('chat-input')?.focus(), 100);
}

function showVoiceUI() {
  document.getElementById('chat-interface').style.display = 'none';
  document.getElementById('voice-interface').style.display = 'flex';
}

// ── Interview Events ──────────────────────────────────────────
function bindInterviewEvents() {
  document.getElementById('chat-send-btn').addEventListener('click', handleChatSend);

  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  });

  document.getElementById('chat-messages').addEventListener('click', e => {
    const btn = e.target.closest('.speak-btn');
    if (!btn) return;
    btn.textContent = '⏸';
    speakText(btn.dataset.content, () => {}, () => { btn.textContent = '🔊'; });
  });

  document.getElementById('voice-btn')?.addEventListener('click', handleVoiceBtnClick);
  document.getElementById('end-interview-btn').addEventListener('click', handleEndRequest);
  document.getElementById('restart-btn')?.addEventListener('click', handleNewChat);
  document.getElementById('download-btn')?.addEventListener('click', handleDownload);

  const ta = document.getElementById('chat-input');
  if (ta) {
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
    });
  }
}

async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text || InterviewState.isLoading || !InterviewState.isActive) return;
  input.value = '';
  input.style.height = 'auto';
  await submitUserMessage(text);
}

function handleVoiceBtnClick() {
  if (InterviewState.isSpeaking) {
    stopSpeaking(); InterviewState.setSpeaking(false); setVoiceState('idle'); return;
  }
  if (InterviewState.isListening) {
    stopListening(); InterviewState.setListening(false); setVoiceState('idle'); return;
  }
  if (InterviewState.isLoading) return;

  setVoiceState('listening');
  InterviewState.setListening(true);
  updateVoiceTranscript('');

  startListening(
    (text) => updateVoiceTranscript(text),
    async (finalText) => {
      InterviewState.setListening(false);
      updateVoiceTranscript('');
      if (finalText?.trim()) {
        setVoiceState('processing');
        await submitUserMessage(finalText.trim());
      } else {
        setVoiceState('idle');
        showToast('No speech detected. Try again.', 'info');
      }
    },
    (errMsg) => {
      InterviewState.setListening(false);
      setVoiceState('idle');
      showToast(errMsg, 'error');
    }
  );
}

async function submitUserMessage(text) {
  if (!InterviewState.isActive) return;

  InterviewState.addMessage('user', text);
  InterviewState.setLoading(true);
  appendMessage('user', text);

  if (!InterviewState.isVoiceMode()) showTypingIndicator();
  else setVoiceState('processing');

  setInputEnabled(false);

  try {
    const response = await sendMessage(
      InterviewState.getApiMessages(),
      InterviewState.config,
      InterviewState.sessionId
    );

    hideTypingIndicator();
    InterviewState.addMessage('assistant', response.message);
    InterviewState.saveToStorage();
    updateLiveSidebar(InterviewState.transcript);
    appendMessage('assistant', response.message);

    if (InterviewState.isVoiceMode()) {
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      await speakText(response.message, () => {}, () => {
        InterviewState.setSpeaking(false);
        setVoiceState('idle');
        setInputEnabled(true); // safety net: re-enable after TTS finishes
      });
    }
  } catch (err) {
    hideTypingIndicator();
    showToast(`Error: ${err.message}`, 'error');
    if (InterviewState.isVoiceMode()) setVoiceState('idle');
  } finally {
    InterviewState.setLoading(false);
    setInputEnabled(true);
    if (!InterviewState.isVoiceMode()) document.getElementById('chat-input')?.focus();
  }
}

function setInputEnabled(enabled) {
  ['chat-input', 'chat-send-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  const vb = document.getElementById('voice-btn');
  if (!vb) return;
  if (enabled) {
    // Always re-enable the voice button. The old code kept vb.disabled=true
    // whenever isSpeaking was true at the time finally{} ran — but speakText()
    // is fire-and-forget, so await resolves immediately while TTS still plays.
    // Result: button stayed permanently disabled after the first answer.
    vb.disabled = false;
  } else if (!InterviewState.isListening && !InterviewState.isSpeaking) {
    // Only disable during loading; never while actively listening/speaking
    // (tapping then should stop the active state, not be silently ignored).
    vb.disabled = true;
  }
}

function handleEndRequest() {
  stopSpeaking(); stopListening();
  showEndConfirmModal(
    async () => { await handleAnalyzeAndShow(); },
    () => { if (InterviewState.isVoiceMode()) setVoiceState('idle'); }
  );
}

async function handleAnalyzeAndShow() {
  InterviewState.endSession();
  showScreen('analysis-screen');

  const loading = document.getElementById('analysis-loading');
  const content = document.getElementById('analysis-content');
  const errMsg  = document.getElementById('analysis-error-msg');

  if (loading) loading.style.display = 'flex';
  if (content) content.style.display = 'none';
  if (errMsg)  errMsg.style.display  = 'none';

  try {
    const result = await analyzeInterview(
      InterviewState.getApiMessages(),
      InterviewState.config,
      InterviewState.sessionId
    );

    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    renderAnalysis(result, result.metadata);
    triggerAnalysisAnimations();

    // Refresh sidebar to show updated score
    renderSidebar(handleLoadSession, handleNewChat);
  } catch (err) {
    console.error('[Analysis]', err);
    if (loading) loading.style.display = 'none';
    if (errMsg)  errMsg.style.display  = 'block';
    showToast(`Analysis failed: ${err.message}`, 'error');
  }
}

function handleDownload() {
  const lines = InterviewState.transcript.map(m => {
    const role = m.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE';
    return `[${new Date(m.timestamp).toLocaleTimeString()}] ${role}:\n${m.content}\n`;
  }).join('\n---\n\n');
  const header = `INTERVIEW TRANSCRIPT\n${'='.repeat(40)}\nType: ${InterviewState.config.type}\nJob: ${InterviewState.config.jobTitle || 'N/A'}\nDate: ${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([header + lines], { type: 'text/plain' })),
    download: `interview-${Date.now()}.txt`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

function bindModalEvents() {
  document.getElementById('end-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('modal--visible');
  });
}

document.addEventListener('DOMContentLoaded', init);
