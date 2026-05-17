// routes/tts.js — Text-to-Speech endpoint
const express = require('express');
const router = express.Router();
const { textToSpeech } = require('../services/ttsService');

/**
 * POST /api/tts/synthesize
 * Convert text to speech audio
 * 
 * Body:
 *   text: string
 *   voice: 'default' | 'female' (optional)
 */
router.post('/synthesize', async (req, res, next) => {
  try {
    const { text, voice = 'default' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text string is required' });
    }

    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 5000 characters' });
    }

    const result = await textToSpeech(text.trim(), voice);

    res.json(result);

  } catch (error) {
    console.error('[TTS Route]', error);
    next(error);
  }
});

module.exports = router;
