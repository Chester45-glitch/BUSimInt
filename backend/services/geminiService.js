// services/geminiService.js — Gemini API for analysis + TTS
const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getClient() {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.startsWith('your_')) {
      throw new Error('GEMINI_API_KEY is not set in environment variables.');
    }
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function buildAnalysisPrompt(transcript, interviewConfig) {
  const transcriptText = transcript
    .map(t => `${t.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.content}`)
    .join('\n\n');

  return `You are an expert interview coach and HR specialist.

Analyze this ${interviewConfig.type} interview transcript for the "${interviewConfig.jobTitle || interviewConfig.type}" position and return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "overallScore": <0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "emotionAnalysis": {
    "dominant": "<confident|nervous|enthusiastic|uncertain|calm|defensive>",
    "confidence": <0-100>,
    "positivity": <0-100>,
    "clarity": <0-100>,
    "breakdown": {
      "confident": <0-100>,
      "nervous": <0-100>,
      "enthusiastic": <0-100>,
      "analytical": <0-100>
    }
  },
  "answerStrength": {
    "relevance": <0-100>,
    "structure": <0-100>,
    "specificity": <0-100>,
    "communication": <0-100>
  },
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": [
    { "area": "<area>", "issue": "<issue>", "suggestion": "<actionable fix>" },
    { "area": "<area>", "issue": "<issue>", "suggestion": "<actionable fix>" },
    { "area": "<area>", "issue": "<issue>", "suggestion": "<actionable fix>" }
  ],
  "questionFeedback": [
    { "question": "<q>", "answer": "<summary>", "score": <0-100>, "feedback": "<feedback>" }
  ],
  "readinessLevel": "<Not Ready|Needs Work|Almost There|Interview Ready|Exceptional>",
  "topTip": "<single most important advice>"
}

TRANSCRIPT:
${transcriptText}`;
}

async function analyzeInterview(transcript, interviewConfig) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(buildAnalysisPrompt(transcript, interviewConfig));
  const raw = result.response.text();
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Gemini] Failed to parse analysis JSON:', e.message, '\nRaw:', raw.slice(0, 300));
    throw new Error('Failed to parse analysis response from Gemini');
  }
}

// ─── TTS via Gemini ───────────────────────────────────────────────────────────
// Gemini doesn't have a dedicated TTS endpoint like Google Cloud TTS,
// so we signal the frontend to use the browser's built-in speech synthesis.
// This is reliable, free, and works in all browsers.
// If Google ever ships a free Gemini TTS REST endpoint, swap it in here.

async function synthesizeSpeech(text) {
  // Always use browser TTS — no billing required
  return { useBrowserTTS: true, text };
}

module.exports = { analyzeInterview, synthesizeSpeech };
