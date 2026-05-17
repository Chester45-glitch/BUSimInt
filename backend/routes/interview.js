// routes/interview.js — Interview simulation endpoints
const express = require('express');
const router = express.Router();
const { sendInterviewMessage } = require('../services/groqService');

/**
 * POST /api/interview/message
 * Send a message and get the interviewer's next response
 * 
 * Body:
 *   messages: Array<{role: 'user'|'assistant', content: string}>
 *   config: { type, jobTitle, experienceLevel, mode }
 */
router.post('/message', async (req, res, next) => {
  try {
    const { messages, config } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    if (!config || !config.type) {
      return res.status(400).json({ error: 'config.type is required' });
    }

    const response = await sendInterviewMessage(messages, config);

    res.json({
      message: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Interview Route]', error);
    next(error);
  }
});

/**
 * POST /api/interview/start
 * Initialize a new interview session (get opening message)
 * 
 * Body:
 *   config: { type, jobTitle, experienceLevel, mode }
 */
router.post('/start', async (req, res, next) => {
  try {
    const { config } = req.body;

    if (!config || !config.type) {
      return res.status(400).json({ error: 'Interview config with type is required' });
    }

    // Empty messages array — system prompt handles the opening
    const openingMessage = await sendInterviewMessage([], config);

    res.json({
      message: openingMessage,
      sessionId: `session_${Date.now()}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Interview Start Route]', error);
    next(error);
  }
});

module.exports = router;
