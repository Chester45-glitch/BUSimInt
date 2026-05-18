// services/geminiService.js — Gemini API with key rotation (up to 2 keys)
const { GoogleGenerativeAI } = require('@google/generative-ai');

const COOLDOWN_MS = 60 * 1000;
// Use gemini-1.5-flash — stable, free-tier, widely available
const GEMINI_MODEL = 'gemini-1.5-flash';

// ── Key Pool ─────────────────────────────────────────────────
function buildPool() {
  const raw = [
    process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
  ];

  const pool = raw
    .filter(k => k && k.trim() && !k.startsWith('your_') && !k.startsWith('AIza...'))
    .map((apiKey, i) => ({
      index: i + 1,
      apiKey,
      client: new GoogleGenerativeAI(apiKey),
      exhaustedAt: null,
    }));

  if (pool.length === 0) {
    throw new Error('No valid GEMINI_API_KEY_1 or GEMINI_API_KEY_2 found in environment.');
  }

  console.log(`[Gemini] Key pool ready with ${pool.length} key(s). Model: ${GEMINI_MODEL}`);
  return pool;
}

let pool = null;
function getPool() {
  if (!pool) pool = buildPool();
  return pool;
}

function getAvailableEntry() {
  const now = Date.now();
  for (const entry of getPool()) {
    if (!entry.exhaustedAt || now - entry.exhaustedAt >= COOLDOWN_MS) {
      if (entry.exhaustedAt) {
        entry.exhaustedAt = null;
        console.log(`[Gemini] Key #${entry.index} cooldown expired — back in rotation.`);
      }
      return entry;
    }
  }
  const soonest = Math.min(...getPool().map(e => COOLDOWN_MS - (Date.now() - e.exhaustedAt)));
  throw new Error(`All Gemini API keys exhausted. Retry in ${Math.ceil(soonest / 1000)}s.`);
}

function markExhausted(entry) {
  entry.exhaustedAt = Date.now();
  console.warn(`[Gemini] Key #${entry.index} exhausted — cooldown ${COOLDOWN_MS / 1000}s.`);
}

function isQuotaError(err) {
  const status = err?.status ?? err?.statusCode;
  if ([429, 402, 403].includes(Number(status))) return true;
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('billing') ||
    msg.includes('too many requests')
  );
}

async function withRotation(fn) {
  let lastError;
  const p = getPool();
  for (let attempt = 0; attempt < p.length; attempt++) {
    let entry;
    try { entry = getAvailableEntry(); } catch (e) { throw e; }
    try {
      return await fn(entry.client);
    } catch (err) {
      lastError = err;
      console.error(`[Gemini] Key #${entry.index} error:`, err.message);
      if (isQuotaError(err)) {
        markExhausted(entry);
        console.log(`[Gemini] Rotating to next key…`);
      } else {
        throw err; // Non-quota error — don't rotate
      }
    }
  }
  throw lastError || new Error('All Gemini keys failed.');
}

// ── Analysis ─────────────────────────────────────────────────
function buildAnalysisPrompt(transcript, interviewConfig) {
  const text = transcript
    .map(t => `${t.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.content}`)
    .join('\n\n');

  return `You are an expert interview coach and HR specialist. Analyze the interview transcript below and return ONLY a valid JSON object. No markdown code fences, no explanation, no preamble — just the raw JSON.

Return this exact structure:
{
  "overallScore": 75,
  "summary": "2-3 sentence assessment here.",
  "emotionAnalysis": {
    "dominant": "confident",
    "confidence": 70,
    "positivity": 65,
    "clarity": 72,
    "breakdown": {
      "confident": 70,
      "nervous": 30,
      "enthusiastic": 55,
      "analytical": 60
    }
  },
  "answerStrength": {
    "relevance": 75,
    "structure": 68,
    "specificity": 62,
    "communication": 70
  },
  "strengths": ["Strength one", "Strength two", "Strength three"],
  "improvements": [
    { "area": "Area name", "issue": "What went wrong", "suggestion": "How to fix it" },
    { "area": "Area name", "issue": "What went wrong", "suggestion": "How to fix it" },
    { "area": "Area name", "issue": "What went wrong", "suggestion": "How to fix it" }
  ],
  "questionFeedback": [
    { "question": "The interviewer's question", "answer": "Summary of candidate answer", "score": 70, "feedback": "Specific feedback" }
  ],
  "readinessLevel": "Almost There",
  "topTip": "Your single most important piece of advice."
}

Interview type: ${interviewConfig.type}
Position: ${interviewConfig.jobTitle || interviewConfig.type}
Experience level: ${interviewConfig.experienceLevel || 'not specified'}

TRANSCRIPT:
${text}`;
}

async function analyzeInterview(transcript, interviewConfig) {
  console.log(`[Gemini] Starting analysis of ${transcript.length} messages…`);

  const raw = await withRotation(async (client) => {
    const model = client.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json', // Ask Gemini to return JSON directly
      },
    });
    const result = await model.generateContent(buildAnalysisPrompt(transcript, interviewConfig));
    const text = result.response.text();
    console.log(`[Gemini] Raw response (first 200 chars): ${text.slice(0, 200)}`);
    return text;
  });

  // Strip any accidental markdown fences just in case
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Gemini] JSON parse failed:', e.message);
    console.error('[Gemini] Full raw response:', raw);
    throw new Error(`Failed to parse Gemini analysis response: ${e.message}`);
  }
}

// ── TTS (browser fallback) ────────────────────────────────────
async function synthesizeSpeech(text) {
  return { useBrowserTTS: true, text };
}

// ── Status ────────────────────────────────────────────────────
function getGeminiKeyPoolStatus() {
  const now = Date.now();
  return getPool().map(e => ({
    key: `gemini_key_${e.index}`,
    status: !e.exhaustedAt || now - e.exhaustedAt >= COOLDOWN_MS ? 'available' : 'exhausted',
    cooldownRemainingMs: e.exhaustedAt ? Math.max(0, COOLDOWN_MS - (now - e.exhaustedAt)) : 0,
  }));
}

module.exports = { analyzeInterview, synthesizeSpeech, getGeminiKeyPoolStatus };
