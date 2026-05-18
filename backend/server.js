// server.js — Main Express entry point
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const interviewRoutes = require('./routes/interview');
const analysisRoutes  = require('./routes/analysis');
const ttsRoutes       = require('./routes/tts');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ────────────────────────────────────────────────────
// Allows requests from any Vercel deployment + localhost.
// To lock it down further, set FRONTEND_URL in your Render env vars
// to your exact Vercel URL, e.g. https://bu-simint.vercel.app
const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  // Vercel preview URLs (*.vercel.app)
  /\.vercel\.app$/,
  // Your custom domain if you have one
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);

    const allowed =
      allowedOrigins.some(o =>
        typeof o === 'string' ? o === origin : o.test(origin)
      );

    if (allowed) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Handle preflight for all routes
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// ── Routes ──────────────────────────────────────────────────
app.use('/api/interview', interviewRoutes);
app.use('/api/analysis',  analysisRoutes);
app.use('/api/tts',       ttsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Key pool status
app.get('/api/keys/status', (req, res) => {
  try {
    const { getKeyPoolStatus } = require('./services/groqService');
    res.json({ keys: getKeyPoolStatus(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Error handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✅ Interview Simulator API running on port ${PORT}`);
  console.log(`   FRONTEND_URL = ${process.env.FRONTEND_URL || '(not set — all *.vercel.app allowed)'}`);
});
