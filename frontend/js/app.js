// js/app.js — Main application controller / event orchestration
import Config from './config.js';
import InterviewState from './interviewState.js';
import { startInterview, sendMessage, analyzeInterview } from './api.js';
import {
  speakText, stopSpeaking, startListening, stopListening,
  isSpeechRecognitionSupported, getIsListening
} from './speech.js';
import {
  showScreen, renderSetupScreen, selectCard, validateSetupAndGetErrors,
  showSetupError, appendMessage, showTypingIndicator, hideTypingIndicator,
  setInterviewHeader, setVoiceState, updateVoiceTranscript,
  showToast, showEndConfirmModal, renderAnalysis
} from './ui.js';

// ─── App Init ─────────────────────────────────────────────────────────────────

function init() {
  renderSetupScreen();
  bindSetupEvents();
  bindInterviewEvents();
  bindModalEvents();
  showScreen('setup-screen');

  // Check voice support and warn if needed
  if (!isSpeechRecognitionSupported()) {
    document.querySelectorAll('.mode-card[data-value="voice"]').forEach(card => {
      card.title = 'Voice input requires Chrome browser';
    });
  }
}

// ─── Setup Screen Events ──────────────────────────────────────────────────────

function bindSetupEvents() {
  // Interview type selection
  document.getElementById('interview-type-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.type-card');
    if (!card) return;
    InterviewState.setConfig({ type: card.dataset.value });
    selectCard(document.getElementById('interview-type-grid'), card.dataset.value);
    // Auto-fill job title placeholder
    const input = document.getElementById('job-title-input');
    if (input && !input.value) input.placeholder = `e.g., ${card.dataset.value} Specialist`;
  });

  // Experience level selection
  document.getElementById('experience-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.exp-card');
    if (!card) return;
    InterviewState.setConfig({ experienceLevel: card.dataset.value });
    selectCard(document.getElementById('experience-grid'), card.dataset.value);
  });

  // Mode selection
  document.getElementById('mode-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.mode-card');
    if (!card) return;

    if (card.dataset.value === 'voice' && !isSpeechRecognitionSupported()) {
      showToast('Voice mode requires Chrome browser. Switching to Chat mode.', 'error');
      return;
    }

    InterviewState.setConfig({ mode: card.dataset.value });
    selectCard(document.getElementById('mode-grid'), card.dataset.value);
  });

  // Job title input
  document.getElementById('job-title-input').addEventListener('input', (e) => {
    InterviewState.setConfig({ jobTitle: e.target.value.trim() });
  });

  // Start button
  document.getElementById('start-btn').addEventListener('click', handleStartInterview);
}

// ─── Start Interview ──────────────────────────────────────────────────────────

async function handleStartInterview() {
  const errors = validateSetupAndGetErrors(InterviewState.config);
  if (errors.length) {
    showSetupError(errors[0]);
    return;
  }

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';

  try {
    const data = await startInterview(InterviewState.config);

    InterviewState.startSession(data.sessionId);
    InterviewState.addMessage('assistant', data.message);

    // Setup the interview screen
    setInterviewHeader(InterviewState.config);
    showScreen('interview-screen');

    // Setup mode-specific UI
    if (InterviewState.isVoiceMode()) {
      showVoiceUI();
      // Speak the opening message
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      await speakText(
        data.message,
        () => setVoiceState('speaking'),
        () => {
          setVoiceState('idle');
          InterviewState.setSpeaking(false);
        }
      );
    } else {
      showChatUI();
      appendMessage('assistant', data.message);
    }

  } catch (err) {
    console.error('[Start]', err);
    showSetupError(`Failed to start: ${err.message}`);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Interview';
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

// ─── Chat Interface Events ────────────────────────────────────────────────────

function bindInterviewEvents() {
  // Chat send button
  document.getElementById('chat-send-btn').addEventListener('click', handleChatSend);

  // Chat input enter key
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });

  // Speak button on messages (delegated)
  document.getElementById('chat-messages').addEventListener('click', (e) => {
    const speakBtn = e.target.closest('.speak-btn');
    if (!speakBtn) return;
    const text = speakBtn.dataset.content;
    if (text) {
      speakBtn.textContent = '⏸';
      speakText(text,
        () => {},
        () => { speakBtn.textContent = '🔊'; }
      );
    }
  });

  // Voice button
  document.getElementById('voice-btn')?.addEventListener('click', handleVoiceBtnClick);

  // End session button
  document.getElementById('end-interview-btn').addEventListener('click', handleEndRequest);

  // Restart from analysis
  document.getElementById('restart-btn')?.addEventListener('click', handleRestart);

  // Download transcript
  document.getElementById('download-btn')?.addEventListener('click', handleDownloadTranscript);
}

// ─── Chat Send ────────────────────────────────────────────────────────────────

async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();

  if (!text || InterviewState.isLoading || !InterviewState.isActive) return;

  input.value = '';
  input.style.height = 'auto';

  await submitUserMessage(text);
}

// ─── Voice Button ─────────────────────────────────────────────────────────────

function handleVoiceBtnClick() {
  if (InterviewState.isSpeaking) {
    // Stop speaking
    stopSpeaking();
    InterviewState.setSpeaking(false);
    setVoiceState('idle');
    return;
  }

  if (InterviewState.isListening) {
    stopListening();
    InterviewState.setListening(false);
    setVoiceState('idle');
    return;
  }

  if (InterviewState.isLoading) return;

  // Start listening
  setVoiceState('listening');
  InterviewState.setListening(true);
  updateVoiceTranscript('');

  startListening(
    (text, isFinal) => {
      updateVoiceTranscript(text);
    },
    async (finalText) => {
      InterviewState.setListening(false);
      updateVoiceTranscript('');

      if (finalText && finalText.trim()) {
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

// ─── Core Message Exchange ────────────────────────────────────────────────────

async function submitUserMessage(text) {
  if (!InterviewState.isActive) return;

  // Add to transcript & UI
  InterviewState.addMessage('user', text);
  InterviewState.setLoading(true);

  if (!InterviewState.isVoiceMode()) {
    appendMessage('user', text);
    showTypingIndicator();
  } else {
    setVoiceState('processing');
    // Show user message in voice chat log
    appendMessage('user', text);
  }

  // Disable input while loading
  setInputEnabled(false);

  try {
    const response = await sendMessage(InterviewState.getApiMessages(), InterviewState.config);
    const aiMessage = response.message;

    hideTypingIndicator();
    InterviewState.addMessage('assistant', aiMessage);
    InterviewState.saveToStorage();

    if (InterviewState.isVoiceMode()) {
      appendMessage('assistant', aiMessage);
      setVoiceState('speaking');
      InterviewState.setSpeaking(true);
      await speakText(
        aiMessage,
        () => {},
        () => {
          InterviewState.setSpeaking(false);
          setVoiceState('idle');
        }
      );
    } else {
      appendMessage('assistant', aiMessage);
    }

  } catch (err) {
    hideTypingIndicator();
    console.error('[Message]', err);
    showToast(`Error: ${err.message}`, 'error');
    if (InterviewState.isVoiceMode()) setVoiceState('idle');
  } finally {
    InterviewState.setLoading(false);
    setInputEnabled(true);

    if (!InterviewState.isVoiceMode()) {
      document.getElementById('chat-input').focus();
    }
  }
}

function setInputEnabled(enabled) {
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const voiceBtn = document.getElementById('voice-btn');

  if (chatInput) chatInput.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
  if (voiceBtn && !InterviewState.isListening && !InterviewState.isSpeaking) {
    voiceBtn.disabled = !enabled;
  }
}

// ─── End Interview ────────────────────────────────────────────────────────────

function handleEndRequest() {
  stopSpeaking();
  stopListening();

  showEndConfirmModal(
    async () => {
      await handleAnalyzeAndShowResults();
    },
    () => {
      // Cancelled — resume
      if (InterviewState.isVoiceMode()) setVoiceState('idle');
    }
  );
}

async function handleAnalyzeAndShowResults() {
  InterviewState.endSession();

  showScreen('analysis-screen');

  const loadingEl = document.getElementById('analysis-loading');
  const contentEl = document.getElementById('analysis-content');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (contentEl) contentEl.style.display = 'none';

  try {
    const result = await analyzeInterview(
      InterviewState.getApiMessages(),
      InterviewState.config
    );

    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    renderAnalysis(result, result.metadata);
    triggerAnalysisAnimations();

  } catch (err) {
    console.error('[Analysis]', err);
    if (loadingEl) loadingEl.style.display = 'none';
    showToast(`Analysis failed: ${err.message}`, 'error');
    document.getElementById('analysis-error-msg').style.display = 'block';
  }
}

function triggerAnalysisAnimations() {
  // Animate metric bars after a short delay
  setTimeout(() => {
    document.querySelectorAll('.metric-bar__fill').forEach(bar => {
      bar.style.width = bar.style.getPropertyValue('--target') || '0%';
    });
  }, 300);
}

// ─── Restart ──────────────────────────────────────────────────────────────────

function handleRestart() {
  InterviewState.reset();
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('chat-input').value = '';
  showScreen('setup-screen');
  // Re-render in case state changed
  renderSetupScreen();
}

// ─── Download Transcript ──────────────────────────────────────────────────────

function handleDownloadTranscript() {
  const lines = InterviewState.transcript.map(m => {
    const role = m.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE';
    const time = new Date(m.timestamp).toLocaleTimeString();
    return `[${time}] ${role}:\n${m.content}\n`;
  }).join('\n---\n\n');

  const header = `INTERVIEW TRANSCRIPT\n${'='.repeat(40)}\nType: ${InterviewState.config.type}\nJob: ${InterviewState.config.jobTitle || 'N/A'}\nDate: ${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;

  const blob = new Blob([header + lines], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `interview-transcript-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Modal Close on Backdrop ──────────────────────────────────────────────────

function bindModalEvents() {
  document.getElementById('end-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('modal--visible');
    }
  });
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('chat-input');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
  }
  init();
});
