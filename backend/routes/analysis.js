// routes/analysis.js — Post-interview analysis via Gemini (falls back to Groq on quota errors)
const express = require('express');
const router = express.Router();
const { analyzeInterview: analyzeWithGemini } = require('../services/geminiService');
const { analyzeInterview: analyzeWithGroq }   = require('../services/groqService');
const { saveAnalysis, completeSession } = require('../services/supabaseService');

function requireUser(req, res, next) {
  req.userId = req.headers['x-user-id'] || null;
  next();
}

function isQuotaError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('quota') || msg.includes('429') || msg.includes('rate limit') ||
    msg.includes('too many requests') || msg.includes('exhausted') || msg.includes('billing');
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

    // Try Gemini first, fall back to Groq on quota/rate-limit errors
    let analysis;
    let provider = 'gemini';
    try {
      analysis = await analyzeWithGemini(transcript, config);
    } catch (geminiErr) {
      if (isQuotaError(geminiErr)) {
        console.warn('[Analysis] Gemini quota exceeded — falling back to Groq:', geminiErr.message);
        provider = 'groq';
        analysis = await analyzeWithGroq(transcript, config);
      } else {
        throw geminiErr;
      }
    }

    console.log(`[Analysis] Completed via ${provider}`);

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
        analyzedAt:     new Date().toISOString(),
        provider,
      }
    });
  } catch (err) {
    console.error('[Analysis Route]', err);
    next(err);
  }
});

module.exports = router;
