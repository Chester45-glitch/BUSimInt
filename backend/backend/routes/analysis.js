// routes/analysis.js — Post-interview analysis via Gemini + save to Supabase
const express = require('express');
const router = express.Router();
const { analyzeInterview } = require('../services/geminiService');
const { saveAnalysis, completeSession } = require('../services/supabaseService');

function requireUser(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  next();
}

router.post('/analyze', requireUser, async (req, res, next) => {
  try {
    const { transcript, config, sessionId } = req.body;

    if (!transcript || !Array.isArray(transcript) || transcript.length < 2) {
      return res.status(400).json({ error: 'A transcript with at least one exchange is required' });
    }
    if (!config || !config.type) {
      return res.status(400).json({ error: 'Interview config is required' });
    }

    const userMessages = transcript.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No candidate responses found in transcript' });
    }

    const analysis = await analyzeInterview(transcript, config);

    // Persist to Supabase
    if (req.userId && sessionId) {
      try {
        await completeSession(sessionId);
        await saveAnalysis(sessionId, analysis);
      } catch (dbErr) {
        console.warn('[Analysis] DB save failed (non-fatal):', dbErr.message);
      }
    }

    res.json({
      analysis,
      metadata: {
        totalExchanges: userMessages.length,
        interviewType:  config.type,
        jobTitle:       config.jobTitle,
        analyzedAt:     new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Analysis Route]', err);
    next(err);
  }
});

module.exports = router;
