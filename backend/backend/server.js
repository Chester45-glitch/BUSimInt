// server.js — BUSimInt Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes      = require('./routes/auth');
const interviewRoutes = require('./routes/interview');
const analysisRoutes  = require('./routes/analysis');
const ttsRoutes       = require('./routes/tts');
const sessionsRoutes  = require('./routes/sessions');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ─────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5500', 'http://localhost:3000', 'http://127.0.0.1:5500',
  /\.vercel\.app$/,
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some(o => typeof o === 'string' ? o === origin : o.test(origin));
    ok ? cb(null, true) : cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/analysis',  analysisRoutes);
app.use('/api/tts',       ttsRoutes);
app.use('/api/sessions',  sessionsRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.get('/api/keys/status', (req, res) => {
  try {
    const { getKeyPoolStatus }      = require('./services/groqService');
    const { getGeminiKeyPoolStatus } = require('./services/geminiService');
    res.json({ groq: getKeyPoolStatus(), gemini: getGeminiKeyPoolStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✅ BUSimInt API on port ${PORT}`);
  console.log(`   FRONTEND_URL = ${process.env.FRONTEND_URL || 'all *.vercel.app'}`);
});
