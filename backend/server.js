// server.js — Main Express entry point
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const interviewRoutes = require('./routes/interview');
const analysisRoutes = require('./routes/analysis');
const ttsRoutes = require('./routes/tts');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/interview', interviewRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/tts', ttsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Key pool status — shows which Groq keys are available/exhausted
app.get('/api/keys/status', (req, res) => {
  try {
    const { getKeyPoolStatus } = require('./services/groqService');
    res.json({ keys: getKeyPoolStatus(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Interview Simulator API running on port ${PORT}`);
});
