// services/supabaseService.js — All Supabase DB operations
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY; // Use SERVICE key (not anon) for backend
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    supabase = createClient(url, key);
  }
  return supabase;
}

// ── Users ─────────────────────────────────────────────────────

async function upsertUser({ googleId, email, name, avatarUrl }) {
  const db = getClient();
  const { data, error } = await db
    .from('users')
    .upsert(
      { google_id: googleId, email, name, avatar_url: avatarUrl, last_login: new Date().toISOString() },
      { onConflict: 'google_id' }
    )
    .select()
    .single();

  if (error) throw new Error(`upsertUser: ${error.message}`);
  return data;
}

async function getUserById(userId) {
  const db = getClient();
  const { data, error } = await db.from('users').select('*').eq('id', userId).single();
  if (error) throw new Error(`getUserById: ${error.message}`);
  return data;
}

// ── Sessions ──────────────────────────────────────────────────

async function createSession(userId, config) {
  const db = getClient();
  const title = `${config.type}${config.jobTitle ? ' · ' + config.jobTitle : ''} · ${config.experienceLevel?.split(' ')[0] || ''}`.trim();

  const { data, error } = await db
    .from('sessions')
    .insert({
      user_id: userId,
      title,
      interview_type: config.type,
      job_title: config.jobTitle || null,
      experience_level: config.experienceLevel || null,
      mode: config.mode || 'chat',
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(`createSession: ${error.message}`);
  return data;
}

async function getUserSessions(userId, limit = 30) {
  const db = getClient();
  const { data, error } = await db
    .from('sessions')
    .select(`
      id, title, interview_type, job_title, experience_level,
      mode, status, created_at, updated_at,
      analysis_results ( overall_score, readiness_level )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getUserSessions: ${error.message}`);
  return data;
}

async function getSessionById(sessionId, userId) {
  const db = getClient();
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (error) throw new Error(`getSessionById: ${error.message}`);
  return data;
}

async function completeSession(sessionId) {
  const db = getClient();
  const { error } = await db
    .from('sessions')
    .update({ status: 'completed' })
    .eq('id', sessionId);
  if (error) throw new Error(`completeSession: ${error.message}`);
}

// ── Messages ──────────────────────────────────────────────────

async function saveMessage(sessionId, role, content) {
  const db = getClient();
  const { data, error } = await db
    .from('messages')
    .insert({ session_id: sessionId, role, content })
    .select()
    .single();
  if (error) throw new Error(`saveMessage: ${error.message}`);
  return data;
}

async function getSessionMessages(sessionId) {
  const db = getClient();
  const { data, error } = await db
    .from('messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getSessionMessages: ${error.message}`);
  return data;
}

// ── Analysis ──────────────────────────────────────────────────

async function saveAnalysis(sessionId, analysis) {
  const db = getClient();
  const { data, error } = await db
    .from('analysis_results')
    .upsert({
      session_id:       sessionId,
      overall_score:    analysis.overallScore,
      readiness_level:  analysis.readinessLevel,
      summary:          analysis.summary,
      top_tip:          analysis.topTip,
      emotion_analysis: analysis.emotionAnalysis,
      answer_strength:  analysis.answerStrength,
      strengths:        analysis.strengths,
      improvements:     analysis.improvements,
      question_feedback: analysis.questionFeedback,
    }, { onConflict: 'session_id' })
    .select()
    .single();

  if (error) throw new Error(`saveAnalysis: ${error.message}`);
  return data;
}

async function getSessionAnalysis(sessionId) {
  const db = getClient();
  const { data, error } = await db
    .from('analysis_results')
    .select('*')
    .eq('session_id', sessionId)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(`getSessionAnalysis: ${error.message}`);
  return data || null;
}

module.exports = {
  upsertUser, getUserById,
  createSession, getUserSessions, getSessionById, completeSession,
  saveMessage, getSessionMessages,
  saveAnalysis, getSessionAnalysis,
};
