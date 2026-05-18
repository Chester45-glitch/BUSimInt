// routes/stt.js — Speech-to-Text via Groq Whisper (fallback for Web Speech API failures)
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const Groq    = require('groq-sdk');
const { toFile } = require('groq-sdk');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('No GROQ_API_KEY configured');
  return new Groq({ apiKey });
}

// POST /api/stt/whisper — transcribe audio blob
router.post('/whisper', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

    const groq = getGroqClient();

    // toFile() wraps a Buffer into a proper File-like object the Groq SDK
    // can serialise correctly. Using Readable.from(buffer) was broken because
    // the SDK tried to read .read() as a value and serialised the function
    // source instead of the audio bytes.
    const mimeType = req.file.mimetype || 'audio/webm';
    const ext      = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const file     = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });

    const transcription = await groq.audio.transcriptions.create({
      file,
      model:           'whisper-large-v3-turbo',
      language:        'en',
      response_format: 'json',
    });

    res.json({ text: transcription.text || '' });
  } catch (err) {
    console.error('[STT Whisper]', err.message);
    res.json({ text: '' });
  }
});

module.exports = router;
