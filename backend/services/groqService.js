// services/groqService.js — Handles all Groq API interactions
const Groq = require('groq-sdk');

let groqClient = null;

function getClient() {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
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
  const client = getClient();

  const systemPrompt = buildInterviewerSystemPrompt(
    interviewConfig.type,
    interviewConfig.jobTitle,
    interviewConfig.experienceLevel
  );

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
}

/**
 * Analyze the full interview transcript
 */
async function analyzeInterview(transcript, interviewConfig) {
  const client = getClient();

  const transcriptText = transcript
    .map(t => `${t.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.content}`)
    .join('\n\n');

  const userPrompt = `Please analyze this ${interviewConfig.type} interview transcript for the "${interviewConfig.jobTitle || interviewConfig.type}" position:

---TRANSCRIPT START---
${transcriptText}
---TRANSCRIPT END---

Provide your complete analysis as JSON only. No markdown, no explanation — pure JSON.`;

  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildAnalysisSystemPrompt() },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  
  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[Groq] Failed to parse analysis JSON:', e.message);
    throw new Error('Failed to parse analysis response from AI');
  }
}

module.exports = { sendInterviewMessage, analyzeInterview };
