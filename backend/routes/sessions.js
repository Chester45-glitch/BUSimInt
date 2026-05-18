// routes/sessions.js — Chat history / session management
const express = require('express');
const router = express.Router();
const {
  getUserSessions, getSessionById, getSessionMessages,
  getSessionAnalysis, completeSession, createSession, saveMessage
} = require('../services/supabaseService');

// Simple auth middleware — reads userId from header set by frontend
function requireUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = userId;
  next();
}

// GET /api/sessions — list all sessions for the user (sidebar history)
router.get('/', requireUser, async (req, res, next) => {
  try {
    const sessions = await getUserSessions(req.userId);
    res.json({ sessions });
  } catch (err) {
    console.error('[Sessions]', err.message);
    next(err);
  }
});

// GET /api/sessions/:id — get a specific session with messages + analysis
router.get('/:id', requireUser, async (req, res, next) => {
  try {
    const session  = await getSessionById(req.params.id, req.userId);
    const messages = await getSessionMessages(req.params.id);
    const analysis = await getSessionAnalysis(req.params.id);
    res.json({ session, messages, analysis });
  } catch (err) {
    console.error('[Session get]', err.message);
    next(err);
  }
});

module.exports = router;
