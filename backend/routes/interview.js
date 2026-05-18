// routes/interview.js — Interview simulation + Supabase persistence
const express = require('express');
const router = express.Router();
const { sendInterviewMessage } = require('../services/groqService');
const { createSession, saveMessage } = require('../services/supabaseService');

function requireUser(req, res, next) {
  req.userId = req.headers['x-user-id'] || null; // null = guest (no history saved)
  next();
}

// POST /api/interview/start
router.post('/start', requireUser, async (req, res, next) => {
  try {
    const { config } = req.body;
    if (!config || !config.type) return res.status(400).json({ error: 'config.type is required' });

    const openingMessage = await sendInterviewMessage([], config);

    // Save session + opening message to Supabase if user is logged in
    let sessionId = null;
    if (req.userId) {
      try {
        const session = await createSession(req.userId, config);
        sessionId = session.id;
        await saveMessage(sessionId, 'assistant', openingMessage);
      } catch (dbErr) {
        console.warn('[Interview] DB save failed (non-fatal):', dbErr.message);
      }
    }

    res.json({ message: openingMessage, sessionId, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Interview Start]', err);
    next(err);
  }
});

// POST /api/interview/message
router.post('/message', requireUser, async (req, res, next) => {
  try {
    const { messages, config, sessionId } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
    if (!config || !config.type) return res.status(400).json({ error: 'config.type required' });

    const response = await sendInterviewMessage(messages, config);

    // Save user message + AI response to Supabase
    if (req.userId && sessionId) {
      try {
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg?.role === 'user') {
          await saveMessage(sessionId, 'user', lastUserMsg.content);
        }
        await saveMessage(sessionId, 'assistant', response);
      } catch (dbErr) {
        console.warn('[Interview] DB save failed (non-fatal):', dbErr.message);
      }
    }

    res.json({ message: response, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Interview Message]', err);
    next(err);
  }
});

module.exports = router;
