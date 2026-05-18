// routes/auth.js — Google OAuth token verification + user session
const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const { upsertUser } = require('../services/supabaseService');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Body: { credential: <Google ID token from GSI button> }
 * Returns: { user, token }
 */
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    // Verify token with Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture: avatarUrl } = payload;

    // Upsert user in Supabase
    const user = await upsertUser({ googleId, email, name, avatarUrl });

    res.json({
      user: {
        id:        user.id,
        email:     user.email,
        name:      user.name,
        avatarUrl: user.avatar_url,
      }
    });

  } catch (err) {
    console.error('[Auth]', err.message);
    if (err.message?.includes('Token used too late')) {
      return res.status(401).json({ error: 'Token expired. Please sign in again.' });
    }
    next(err);
  }
});

module.exports = router;
