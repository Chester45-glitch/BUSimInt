// services/ttsService.js — Google Cloud Text-to-Speech integration
// Falls back to browser speech synthesis hint if API key not configured

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Voice options per interview formality
const VOICE_CONFIG = {
  default: {
    languageCode: 'en-US',
    name: 'en-US-Neural2-D', // Professional male voice
    ssmlGender: 'MALE'
  },
  female: {
    languageCode: 'en-US',
    name: 'en-US-Neural2-F',
    ssmlGender: 'FEMALE'
  }
};

/**
 * Convert text to speech audio using Google Cloud TTS
 * Returns base64 encoded MP3 audio
 */
async function textToSpeech(text, voiceType = 'default') {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;

  if (!apiKey) {
    // Signal frontend to use browser's built-in TTS
    return { useBrowserTTS: true, text };
  }

  const voice = VOICE_CONFIG[voiceType] || VOICE_CONFIG.default;

  const requestBody = {
    input: { text },
    voice,
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.95,    // Slightly slower for clarity
      pitch: 0,
      volumeGainDb: 0
    }
  };

  try {
    const response = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('[TTS] Google API error:', err);
      // Graceful fallback
      return { useBrowserTTS: true, text };
    }

    const data = await response.json();
    return {
      useBrowserTTS: false,
      audioContent: data.audioContent, // base64 MP3
      mimeType: 'audio/mpeg'
    };
  } catch (error) {
    console.error('[TTS] Request failed:', error.message);
    return { useBrowserTTS: true, text };
  }
}

module.exports = { textToSpeech };
