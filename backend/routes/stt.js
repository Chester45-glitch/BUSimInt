// routes/stt.js — Speech-to-Text via Groq Whisper (fallback for Web Speech API failures)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Groq = require('groq-sdk');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Build Groq client (reuse key from existing pool)
function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('No GROQ_API_KEY configured');
  return new Groq({ apiKey });
}

// POST /api/stt/whisper — transcribe audio blob
router.post('/whisper', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

    const groq = getGroqClient();

    // Groq's Node SDK expects a File-like object; wrap the buffer
    const { Readable } = require('stream');
    const stream = Readable.from(req.file.buffer);
    stream.path = 'audio.webm'; // helps Groq detect format

    const transcription = await groq.audio.transcriptions.create({
      file: stream,
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'json',
    });

    res.json({ text: transcription.text || '' });
  } catch (err) {
    console.error('[STT Whisper]', err.message);
    // Return empty string on failure so the client can degrade gracefully
    res.json({ text: '' });
  }
});

module.exports = router;
