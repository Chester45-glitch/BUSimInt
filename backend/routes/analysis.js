// routes/analysis.js — Post-interview analysis endpoint
const express = require('express');
const router = express.Router();
const { analyzeInterview } = require('../services/groqService');

/**
 * POST /api/analysis/analyze
 * Analyze the complete interview transcript
 * 
 * Body:
 *   transcript: Array<{role: 'user'|'assistant', content: string}>
 *   config: { type, jobTitle, experienceLevel }
 */
router.post('/analyze', async (req, res, next) => {
  try {
    const { transcript, config } = req.body;

    if (!transcript || !Array.isArray(transcript) || transcript.length < 2) {
      return res.status(400).json({
        error: 'A transcript with at least one exchange is required'
      });
    }

    if (!config || !config.type) {
      return res.status(400).json({ error: 'Interview config is required' });
    }

    // Filter to only user responses for analysis (candidate answers)
    const userMessages = transcript.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No candidate responses found in transcript' });
    }

    const analysis = await analyzeInterview(transcript, config);

    res.json({
      analysis,
      metadata: {
        totalExchanges: userMessages.length,
        interviewType: config.type,
        jobTitle: config.jobTitle,
        analyzedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Analysis Route]', error);
    next(error);
  }
});

module.exports = router;
