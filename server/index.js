import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { processTextWithLLM, fetchLinkMetadata, generateLinkCard } from './llm.js';
import {
  initDatabase,
  getAllEntries,
  saveEntry,
  deleteEntry,
  saveAllEntries,
  getUserById,
  getUserByPhone,
  createUser,
  isUsernameTaken,
  setUsername,
  saveVerificationCode,
  verifyPhoneCode
} from './db.js';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Optional Twilio client for SMS / Verify (used for sending verification codes)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

app.use(cors());
app.use(express.json());

// Only serve static files in local development
// On Vercel, static files are served automatically
if (process.env.VERCEL !== '1') {
  app.use(express.static('public'));
}

// Initialize database on startup (for local development)
// On Vercel, initialization happens lazily on first request
if (process.env.VERCEL !== '1') {
  initDatabase().catch(console.error);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [key, ...valParts] = part.trim().split('=');
    if (!key) return acc;
    const value = valParts.join('=');
    acc[decodeURIComponent(key)] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = [
    `auth_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProd ? 'Secure' : ''
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
}

async function attachUser(req, _res, next) {
  try {
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    if (!token) {
      req.user = null;
      return next();
    }
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.id) {
      req.user = null;
      return next();
    }
    const user = await getUserById(payload.id);
    req.user = user || null;
    return next();
  } catch {
    req.user = null;
    return next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Middleware to ensure database is initialized
app.use('/api/*', async (req, res, next) => {
  try {
    await initDatabase();
    next();
  } catch (error) {
    console.error('Database initialization error:', error);
    next();
  }
});

app.use(attachUser);

app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone is required' });
    }
    const normalizedPhone = phone.trim();
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    // If Twilio Verify is configured, let it fully manage codes
    if (twilioClient && TWILIO_VERIFY_SERVICE_SID) {
      try {
        await twilioClient.verify.v2
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verifications.create({
            to: normalizedPhone,
            channel: 'sms'
          });
      } catch (verifyError) {
        console.error('Error starting Twilio Verify verification:', verifyError);
        return res.status(500).json({ error: 'Failed to send verification code' });
      }
      return res.json({ success: true, via: 'twilio-verify' });
    }

    // Fallback: generate/store own code, then send via SMS (or console log)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await saveVerificationCode(normalizedPhone, code, expiresAt);

    if (twilioClient && TWILIO_FROM_NUMBER) {
      try {
        await twilioClient.messages.create({
          to: normalizedPhone,
          from: TWILIO_FROM_NUMBER,
          body: `Your Canvas login code is ${code}. It expires in 10 minutes.`
        });
      } catch (smsError) {
        console.error('Error sending SMS via Twilio:', smsError);
      }
    } else {
      console.log('Twilio not configured; falling back to console log for verification codes.');
    }

    console.log(`Verification code for ${normalizedPhone}: ${code}`);

    return res.json({ success: true, via: 'local-code' });
  } catch (error) {
    console.error('Error sending verification code:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code are required' });
    }
    const normalizedPhone = String(phone).trim();
    const normalizedCode = String(code).trim();

    let valid = false;

    // If Twilio Verify is configured, delegate code checking to it
    if (twilioClient && TWILIO_VERIFY_SERVICE_SID) {
      try {
        const check = await twilioClient.verify.v2
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks.create({
            to: normalizedPhone,
            code: normalizedCode
          });

        valid = check.status === 'approved';
      } catch (verifyError) {
        console.error('Error verifying code with Twilio Verify:', verifyError);
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
    } else {
      // Fallback: use local verification_codes table
      valid = await verifyPhoneCode(normalizedPhone, normalizedCode);
    }
    if (!valid) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    let user = await getUserByPhone(normalizedPhone);
    if (!user) {
      user = await createUser(normalizedPhone);
    }

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    setAuthCookie(res, token);

    const needsUsername = !user.username;
    return res.json({
      user: { id: user.id, phone: user.phone, username: user.username || null },
      needsUsername
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/set-username', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }
    const trimmed = username.trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (trimmed.length > 40) {
      return res.status(400).json({ error: 'Username too long' });
    }

    const taken = await isUsernameTaken(trimmed);
    if (taken) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const updated = await setUsername(req.user.id, trimmed);
    const token = jwt.sign(
      { id: updated.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    setAuthCookie(res, token);

    return res.json({
      user: { id: updated.id, phone: updated.phone, username: updated.username }
    });
  } catch (error) {
    console.error('Error setting username:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.json({
    id: req.user.id,
    phone: req.user.phone,
    username: req.user.username
  });
});

app.post('/api/process-text', async (req, res) => {
  try {
    const { text, existingCards } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await processTextWithLLM(text, existingCards || []);
    res.json(result);
  } catch (error) {
    console.error('Error processing text:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-link-card', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const metadata = await fetchLinkMetadata(url);
    const card = await generateLinkCard(metadata);
    
    res.json(card);
  } catch (error) {
    console.error('Error generating link card:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/entries', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const entries = await getAllEntries(req.user.id);
    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id, text, position, parentEntryId } = req.body;
    
    if (!id || !text || !position) {
      return res.status(400).json({ error: 'id, text, and position are required' });
    }

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      userId: req.user.id
    };

    const savedEntry = await saveEntry(entry);
    res.json(savedEntry);
  } catch (error) {
    console.error('Error saving entry:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    const { text, position, parentEntryId } = req.body;
    
    if (!text || !position) {
      return res.status(400).json({ error: 'text and position are required' });
    }

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      userId: req.user.id
    };

    const savedEntry = await saveEntry(entry);
    res.json(savedEntry);
  } catch (error) {
    console.error('Error updating entry:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    await deleteEntry(id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/entries/batch', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { entries } = req.body;
    
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' });
    }

    const savedEntries = await saveAllEntries(entries, req.user.id);
    res.json(savedEntries);
  } catch (error) {
    console.error('Error saving entries:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export for Vercel serverless functions
export default app;

// Start server for local development
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
