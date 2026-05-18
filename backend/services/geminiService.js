// services/geminiService.js — Gemini API with key rotation (up to 2 keys)
const { GoogleGenerativeAI } = require('@google/generative-ai');

const COOLDOWN_MS = 60 * 1000; // 1 min cooldown before retrying exhausted key

// ── Key Pool ─────────────────────────────────────────────────
function buildPool() {
  const raw = [
    process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
  ];

  const pool = raw
    .filter(k => k && k.trim() && !k.startsWith('your_'))
    .map((apiKey, i) => ({
      index: i + 1,
      apiKey,
      client: new GoogleGenerativeAI(apiKey),
      exhaustedAt: null,
    }));

  if (pool.length === 0) {
    throw new Error('No valid GEMINI_API_KEY_1 or GEMINI_API_KEY_2 found in environment.');
  }

  console.log(`[Gemini] Key pool initialised with ${pool.length} key(s).`);
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
  const status = err?.status ?? err?.statusCode ?? err?.errorDetails?.[0]?.reason;
  if ([429, 402, 403].includes(status)) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted') || msg.includes('billing');
}

async function withRotation(fn) {
  let lastError;
  for (let attempt = 0; attempt < getPool().length; attempt++) {
    let entry;
    try { entry = getAvailableEntry(); } catch (e) { throw e; }
    try {
      return await fn(entry.client);
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        markExhausted(entry);
        console.log(`[Gemini] Rotating after quota error on key #${entry.index}…`);
      } else {
        throw err;
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
${text}`;
}

async function analyzeInterview(transcript, interviewConfig) {
  const raw = await withRotation(async (client) => {
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(buildAnalysisPrompt(transcript, interviewConfig));
    return result.response.text();
  });

  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Gemini] Failed to parse JSON:', e.message, '\nRaw:', raw.slice(0, 300));
    throw new Error('Failed to parse analysis response from Gemini');
  }
}

// ── TTS (browser fallback — Gemini has no free audio endpoint) ─
async function synthesizeSpeech(text) {
  return { useBrowserTTS: true, text };
}

// ── Status (for /api/keys/status debug endpoint) ──────────────
function getGeminiKeyPoolStatus() {
  const now = Date.now();
  return getPool().map(e => ({
    key: `gemini_key_${e.index}`,
    status: !e.exhaustedAt || now - e.exhaustedAt >= COOLDOWN_MS ? 'available' : 'exhausted',
    cooldownRemainingMs: e.exhaustedAt ? Math.max(0, COOLDOWN_MS - (now - e.exhaustedAt)) : 0,
  }));
}

module.exports = { analyzeInterview, synthesizeSpeech, getGeminiKeyPoolStatus };
