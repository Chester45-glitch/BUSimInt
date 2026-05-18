// services/groqService.js — Handles all Groq API interactions with key rotation
const Groq = require('groq-sdk');

// ─── Key Rotation Pool ────────────────────────────────────────────────────────
//
// Reads up to 3 Groq API keys from environment variables:
//   GROQ_API_KEY_1  (primary)
//   GROQ_API_KEY_2  (first fallback)
//   GROQ_API_KEY_3  (second fallback)
//
// Also accepts the legacy GROQ_API_KEY as an alias for _1.
// Keys are tried in order. If a key returns a rate-limit (429) or
// quota-exhausted (402/403) error, it is marked exhausted for
// COOLDOWN_MS and the next key is tried automatically.
//
// ─────────────────────────────────────────────────────────────────────────────

const COOLDOWN_MS = 60 * 1000; // 1 minute cooldown before re-trying an exhausted key

// Build the pool from env — filter out any that are missing / placeholder
function buildKeyPool() {
  const raw = [
    process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ];

  const pool = raw
    .filter(k => k && k.trim() && !k.startsWith('your_'))
    .map((apiKey, index) => ({
      index: index + 1,
      apiKey,
      client: new Groq({ apiKey }),
      exhaustedAt: null,   // timestamp when marked exhausted (null = available)
    }));

  if (pool.length === 0) {
    throw new Error(
      'No valid Groq API keys found. Set GROQ_API_KEY_1 (and optionally _2, _3) in your .env file.'
    );
  }

  console.log(`[Groq] Key pool initialised with ${pool.length} key(s).`);
  return pool;
}

let keyPool = null;

function getPool() {
  if (!keyPool) keyPool = buildKeyPool();
  return keyPool;
}

/**
 * Returns the next available (non-exhausted) Groq client.
 * Throws if all keys are currently exhausted.
 */
function getAvailableClient() {
  const pool = getPool();
  const now = Date.now();

  for (const entry of pool) {
    if (entry.exhaustedAt === null) return entry;           // never exhausted
    if (now - entry.exhaustedAt >= COOLDOWN_MS) {           // cooldown elapsed
      entry.exhaustedAt = null;
      console.log(`[Groq] Key #${entry.index} cooldown expired — back in rotation.`);
      return entry;
    }
  }

  const soonestMs = Math.min(...pool.map(e => COOLDOWN_MS - (now - e.exhaustedAt)));
  throw new Error(
    `All Groq API keys are currently exhausted. ` +
    `Earliest retry in ${Math.ceil(soonestMs / 1000)}s.`
  );
}

/**
 * Mark a key as exhausted after a quota/rate-limit error.
 */
function markExhausted(entry) {
  entry.exhaustedAt = Date.now();
  console.warn(`[Groq] Key #${entry.index} marked exhausted — will retry after ${COOLDOWN_MS / 1000}s.`);
}

/**
 * Returns true if the error from Groq means this key is out of quota/rate.
 */
function isQuotaError(err) {
  const status = err?.status ?? err?.statusCode ?? err?.error?.status;
  if ([402, 429].includes(status)) return true;

  // Groq SDK wraps errors — also check message text
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('billing') ||
    msg.includes('insufficient') ||
    msg.includes('exceeded')
  );
}

/**
 * Core retry wrapper — tries each available key in order.
 * @param {function} fn  async (groqClient) => result
 */
async function withRotation(fn) {
  const pool = getPool();
  let lastError;

  for (let attempt = 0; attempt < pool.length; attempt++) {
    let entry;
    try {
      entry = getAvailableClient();
    } catch (allExhausted) {
      throw allExhausted; // no keys available at all
    }

    try {
      const result = await fn(entry.client);
      return result; // success ✓
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        markExhausted(entry);
        console.log(`[Groq] Rotating to next key after quota error on key #${entry.index}…`);
        // loop continues to try the next key
      } else {
        // Non-quota error (bad request, network, etc.) — don't rotate, just throw
        throw err;
      }
    }
  }

  throw lastError || new Error('All Groq keys failed.');
}

/**
 * Build the system prompt for the interview simulation
 */
function buildInterviewerSystemPrompt(interviewType, jobTitle, experienceLevel) {
  return `You are a professional interviewer conducting a ${interviewType} interview for the position of "${jobTitle || interviewType + ' role'}".

The candidate's experience level is: ${experienceLevel || 'not specified'}.

Your behavior:
- Ask ONE question at a time. Never ask multiple questions in one turn.
- Be professional, encouraging but realistic — like a real interviewer.
- After the candidate answers, briefly acknowledge their response (1 sentence max), then ask the NEXT interview question.
- Ask a mix of: behavioral (STAR-method), situational, technical (if applicable), and motivational questions.
- Do NOT give scores or feedback during the interview — save that for the end.
- Do NOT break character. Stay as the interviewer throughout.
- Keep responses concise — max 3 sentences total per turn.
- Start by briefly introducing yourself and asking the candidate to introduce themselves.

Interview type context:
- IT/Software: Focus on technical skills, problem-solving, system design, past projects
- Customer Service: Focus on empathy, conflict resolution, communication, scenarios
- Nursing/Healthcare: Focus on patient care, critical thinking, protocols, teamwork
- Business/Management: Focus on leadership, strategy, KPIs, team management
- General: Use universally applicable behavioral and situational questions`;
}

/**
 * Build system prompt for final analysis
 */
function buildAnalysisSystemPrompt() {
  return `You are an expert interview coach and HR specialist. Analyze interview transcripts and provide detailed, actionable feedback.

Your analysis must be structured as valid JSON with this exact schema:
{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "emotionAnalysis": {
    "dominant": "<primary emotion: confident/nervous/enthusiastic/uncertain/calm/defensive>",
    "confidence": <number 0-100>,
    "positivity": <number 0-100>,
    "clarity": <number 0-100>,
    "breakdown": {
      "confident": <number 0-100>,
      "nervous": <number 0-100>,
      "enthusiastic": <number 0-100>,
      "analytical": <number 0-100>
    }
  },
  "answerStrength": {
    "relevance": <number 0-100>,
    "structure": <number 0-100>,
    "specificity": <number 0-100>,
    "communication": <number 0-100>
  },
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": [
    { "area": "<area>", "issue": "<what went wrong>", "suggestion": "<specific actionable fix>" },
    { "area": "<area>", "issue": "<what went wrong>", "suggestion": "<specific actionable fix>" },
    { "area": "<area>", "issue": "<what went wrong>", "suggestion": "<specific actionable fix>" }
  ],
  "questionFeedback": [
    { "question": "<interviewer question>", "answer": "<candidate answer summary>", "score": <0-100>, "feedback": "<specific feedback>" }
  ],
  "readinessLevel": "<Not Ready / Needs Work / Almost There / Interview Ready / Exceptional>",
  "topTip": "<single most important piece of advice>"
}

Be honest, specific, and constructive. Base everything strictly on the transcript provided.`;
}

/**
 * Send a message in an ongoing interview simulation
 */
async function sendInterviewMessage(messages, interviewConfig) {
  const systemPrompt = buildInterviewerSystemPrompt(
    interviewConfig.type,
    interviewConfig.jobTitle,
    interviewConfig.experienceLevel
  );

  return withRotation(async (client) => {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 300,
    });
    return completion.choices[0]?.message?.content || 'I apologize, could you please repeat that?';
  });
}

/**
 * Analyze the full interview transcript
 */
async function analyzeInterview(transcript, interviewConfig) {
  const transcriptText = transcript
    .map(t => `${t.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.content}`)
    .join('\n\n');

  const userPrompt = `Please analyze this ${interviewConfig.type} interview transcript for the "${interviewConfig.jobTitle || interviewConfig.type}" position:

---TRANSCRIPT START---
${transcriptText}
---TRANSCRIPT END---

Provide your complete analysis as JSON only. No markdown, no explanation — pure JSON.`;

  const raw = await withRotation(async (client) => {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: buildAnalysisSystemPrompt() },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
    return completion.choices[0]?.message?.content || '{}';
  });

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Groq] Failed to parse analysis JSON:', e.message);
    throw new Error('Failed to parse analysis response from AI');
  }
}

/**
 * Expose key pool status (useful for a health/debug endpoint)
 */
function getKeyPoolStatus() {
  const pool = getPool();
  const now = Date.now();
  return pool.map(entry => ({
    key: `key_${entry.index}`,
    status: entry.exhaustedAt === null
      ? 'available'
      : (now - entry.exhaustedAt >= COOLDOWN_MS ? 'available (cooldown elapsed)' : 'exhausted'),
    exhaustedAt: entry.exhaustedAt ? new Date(entry.exhaustedAt).toISOString() : null,
    cooldownRemainingMs: entry.exhaustedAt
      ? Math.max(0, COOLDOWN_MS - (now - entry.exhaustedAt))
      : 0,
  }));
}

module.exports = { sendInterviewMessage, analyzeInterview, getKeyPoolStatus };
