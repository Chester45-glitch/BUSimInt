// js/app.js — Main application controller
import Config from './config.js';
import InterviewState from './interviewState.js';
import { startInterview, sendMessage, analyzeInterview } from './api.js';
import {
  speakText, stopSpeaking, startListening, stopListening,
  isSpeechRecognitionSupported
} from './speech.js';
import {
  showScreen, renderSetupScreen, selectCard, validateSetupAndGetErrors,
  showSetupError, appendMessage, showTypingIndicator, hideTypingIndicator,
  setInterviewHeader, setVoiceState, updateVoiceTranscript,
  showToast, showEndConfirmModal, renderAnalysis, triggerAnalysisAnimations,
  updateLiveSidebar
} from './ui.js';

// ── Init ─────────────────────────────────────────────────────
function init() {
  renderSetupScreen();
  bindSetupEvents();
  bindInterviewEvents();
  bindModalEvents();
  showScreen('setup-screen');
}

// ── Setup Events ─────────────────────────────────────────────
function bindSetupEvents() {
  document.getElementById('interview-type-grid').addEventListener('click', e => {
    const card = e.target.closest('.type-card');
    if (!card) return;
    InterviewState.setConfig({ type: card.dataset.value });
    selectCard(document.getElementById('interview-type-grid'), card.dataset.value);
    const inp = document.getElementById('job-title-input');
    if (inp && !inp.value) inp.placeholder = `e.g. ${card.dataset.value} Specialist`;
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
      showToast('Voice input requires Chrome. Switching to Chat mode.', 'error');
      return;
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

    setInterviewHeader(InterviewState.config);
    showScreen('interview-screen');

    if (InterviewState.isVoiceMode()) {
      showVoiceUI();
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      appendMessage('assistant', data.message);
      await speakText(data.message,
        () => setVoiceState('speaking'),
        () => { setVoiceState('idle'); InterviewState.setSpeaking(false); }
      );
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
  document.getElementById('chat-input').focus();
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

  // Speak button on messages (delegated)
  document.getElementById('chat-messages').addEventListener('click', e => {
    const btn = e.target.closest('.speak-btn');
    if (!btn) return;
    btn.textContent = '⏸';
    speakText(btn.dataset.content, () => {}, () => { btn.textContent = '🔊'; });
  });

  document.getElementById('voice-btn')?.addEventListener('click', handleVoiceBtnClick);
  document.getElementById('end-interview-btn').addEventListener('click', handleEndRequest);
  document.getElementById('restart-btn')?.addEventListener('click', handleRestart);
  document.getElementById('download-btn')?.addEventListener('click', handleDownload);

  // Auto-resize textarea
  const ta = document.getElementById('chat-input');
  if (ta) {
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
    });
  }
}

// ── Chat Send ─────────────────────────────────────────────────
async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || InterviewState.isLoading || !InterviewState.isActive) return;
  input.value = '';
  input.style.height = 'auto';
  await submitUserMessage(text);
}

// ── Voice Button ──────────────────────────────────────────────
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

// ── Core Message Exchange ─────────────────────────────────────
async function submitUserMessage(text) {
  if (!InterviewState.isActive) return;

  InterviewState.addMessage('user', text);
  InterviewState.setLoading(true);
  appendMessage('user', text);

  if (!InterviewState.isVoiceMode()) showTypingIndicator();
  else setVoiceState('processing');

  setInputEnabled(false);

  try {
    const response = await sendMessage(InterviewState.getApiMessages(), InterviewState.config);
    const aiMsg = response.message;

    hideTypingIndicator();
    InterviewState.addMessage('assistant', aiMsg);
    InterviewState.saveToStorage();

    // Update live sidebar with latest transcript
    updateLiveSidebar(InterviewState.transcript);

    appendMessage('assistant', aiMsg);

    if (InterviewState.isVoiceMode()) {
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      await speakText(aiMsg, () => {}, () => {
        InterviewState.setSpeaking(false);
        setVoiceState('idle');
      });
    }

  } catch (err) {
    hideTypingIndicator();
    console.error('[Message]', err);
    showToast(`Error: ${err.message}`, 'error');
    if (InterviewState.isVoiceMode()) setVoiceState('idle');
  } finally {
    InterviewState.setLoading(false);
    setInputEnabled(true);
    if (!InterviewState.isVoiceMode()) document.getElementById('chat-input').focus();
  }
}

function setInputEnabled(enabled) {
  const chatInput = document.getElementById('chat-input');
  const sendBtn   = document.getElementById('chat-send-btn');
  const voiceBtn  = document.getElementById('voice-btn');
  if (chatInput) chatInput.disabled = !enabled;
  if (sendBtn)   sendBtn.disabled   = !enabled;
  if (voiceBtn && !InterviewState.isListening && !InterviewState.isSpeaking) {
    voiceBtn.disabled = !enabled;
  }
}

// ── End Interview ─────────────────────────────────────────────
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
    const result = await analyzeInterview(InterviewState.getApiMessages(), InterviewState.config);

    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    renderAnalysis(result, result.metadata);
    triggerAnalysisAnimations();

  } catch (err) {
    console.error('[Analysis]', err);
    if (loading) loading.style.display = 'none';
    if (errMsg)  errMsg.style.display  = 'block';
    showToast(`Analysis failed: ${err.message}`, 'error');
  }
}

// ── Restart ───────────────────────────────────────────────────
function handleRestart() {
  InterviewState.reset();
  document.getElementById('chat-messages').innerHTML = '';
  const ta = document.getElementById('chat-input');
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  showScreen('setup-screen');
  renderSetupScreen();
}

// ── Download Transcript ───────────────────────────────────────
function handleDownload() {
  const lines = InterviewState.transcript.map(m => {
    const role = m.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE';
    return `[${new Date(m.timestamp).toLocaleTimeString()}] ${role}:\n${m.content}\n`;
  }).join('\n---\n\n');

  const header = `INTERVIEW TRANSCRIPT\n${'='.repeat(40)}\nType: ${InterviewState.config.type}\nJob: ${InterviewState.config.jobTitle||'N/A'}\nDate: ${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;
  const blob = new Blob([header + lines], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `interview-${Date.now()}.txt` });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Modal backdrop close ──────────────────────────────────────
function bindModalEvents() {
  document.getElementById('end-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('modal--visible');
  });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
