// routes/tts.js — TTS endpoint (browser synthesis fallback)
const express = require('express');
const router = express.Router();
const { synthesizeSpeech } = require('../services/geminiService');

router.post('/synthesize', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text string is required' });
    }
    const result = await synthesizeSpeech(text.trim());
    res.json(result);
  } catch (error) {
    console.error('[TTS Route]', error);
    next(error);
  }
});

module.exports = router;
