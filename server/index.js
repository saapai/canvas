import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { processTextWithLLM, fetchLinkMetadata, generateLinkCard } from './llm.js';
import {
  initDatabase,
  getAllEntries,
  saveEntry,
  deleteEntry,
  saveAllEntries,
  getUserById,
  getUserByPhone,
  getUsersByPhone,
  getUserByUsername,
  getEntriesByUsername,
  getEntryPath,
  createUser,
  isUsernameTaken,
  setUsername
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

// Serve static files BEFORE any other routes
// This ensures app.js, styles.css, etc. are served correctly
app.use(express.static('public'));

// Helper function to generate user page HTML (canvas view, editable if owner)
function generateUserPageHTML(user, isOwner = false, pathParts = []) {
  // Read the index.html template
  try {
    const indexPath = join(__dirname, '../public/index.html');
    let html = readFileSync(indexPath, 'utf8');
    
    // Add base href to ensure static files load correctly from subdirectories
    html = html.replace('<head>', '<head>\n  <base href="/" />');
    
    // Update title
    html = html.replace('<title>Infinite Diary Page</title>', `<title>${user.username} - Duttapad</title>`);
    
    // Add script to set page context before app.js loads
    const contextScript = `
  <script>
    window.PAGE_USERNAME = '${user.username}';
    window.PAGE_IS_OWNER = ${isOwner};
    window.PAGE_PATH = ${JSON.stringify(pathParts)};
  </script>`;
    html = html.replace('<script src="app.js"></script>', `${contextScript}\n  <script src="app.js"></script>`);
    
    return html;
  } catch (error) {
    console.error('Error reading index.html:', error);
    return '<html><body>Error loading page</body></html>';
  }
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

    // Use Twilio Verify API (primary method)
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
      console.error('Twilio Verify not configured. Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID');
      return res.status(500).json({ error: 'SMS verification service not configured' });
    }

    try {
      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({
          to: normalizedPhone,
          channel: 'sms'
        });
      return res.json({ success: true });
    } catch (verifyError) {
      console.error('Error starting Twilio Verify verification:', verifyError);
      const errorMessage = verifyError.message || 'Failed to send verification code';
      return res.status(500).json({ error: errorMessage });
    }
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

    // Use Twilio Verify API (primary method)
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
      console.error('Twilio Verify not configured. Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID');
      return res.status(500).json({ error: 'SMS verification service not configured' });
    }

    let valid = false;
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
      // Twilio returns specific error codes for invalid/expired codes
      if (verifyError.code === 20404 || verifyError.status === 404) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
      return res.status(500).json({ error: 'Failed to verify code' });
    }

    if (!valid) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    // Try to find all users by phone number
    let users = await getUsersByPhone(normalizedPhone);
    
    // If not found, try alternative phone formats (with/without +1, with/without spaces)
    if (users.length === 0) {
      // Try without +1 prefix if it starts with +1
      if (normalizedPhone.startsWith('+1')) {
        const phoneWithoutPlus = normalizedPhone.substring(2).trim();
        users = await getUsersByPhone(phoneWithoutPlus);
      }
      // Try with +1 if it doesn't have it
      if (users.length === 0 && !normalizedPhone.startsWith('+1')) {
        users = await getUsersByPhone('+1' + normalizedPhone);
      }
    }
    
    console.log('Phone lookup:', {
      searchedPhone: normalizedPhone,
      foundUsers: users.length
    });
    
    // Filter users to only those with usernames
    const usersWithUsernames = users.filter(u => u.username && String(u.username).trim().length > 0);
    
    if (usersWithUsernames.length > 0) {
      // Return list of usernames for selection
      return res.json({
        existingUsernames: usersWithUsernames.map(u => ({
          id: u.id,
          username: u.username
        })),
        phone: normalizedPhone
      });
    } else {
      // No users with usernames found, create new user or use existing one without username
      let user;
      if (users.length > 0) {
        // Use first user without username
        user = users[0];
      } else {
        // Create new user
        console.log('Creating new user with phone:', normalizedPhone);
        user = await createUser(normalizedPhone);
      }
      
      const token = jwt.sign(
        { id: user.id },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      setAuthCookie(res, token);
      
      return res.json({
        user: { 
          id: user.id, 
          phone: user.phone, 
          username: null 
        },
        needsUsername: true
      });
    }
  } catch (error) {
    console.error('Error verifying code:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/select-username', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!user.username) {
      return res.status(400).json({ error: 'User does not have a username' });
    }

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    setAuthCookie(res, token);

    return res.json({
      user: { id: user.id, phone: user.phone, username: user.username }
    });
  } catch (error) {
    console.error('Error selecting username:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/create-new-user', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone is required' });
    }

    const normalizedPhone = phone.trim();
    const user = await createUser(normalizedPhone);

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    setAuthCookie(res, token);

    return res.json({
      user: { id: user.id, phone: user.phone, username: null },
      needsUsername: true
    });
  } catch (error) {
    console.error('Error creating new user:', error);
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
    const { id, text, position, parentEntryId, cardData } = req.body;
    
    if (!id || !text || !position) {
      return res.status(400).json({ error: 'id, text, and position are required' });
    }

    console.log(`[SAVE] Saving entry ${id} for user ${req.user.id}, parent: ${parentEntryId}, text: ${text.substring(0, 30)}`);

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      cardData: cardData || null,
      userId: req.user.id
    };

    const savedEntry = await saveEntry(entry);
    console.log(`[SAVE] Successfully saved entry ${id}`);
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
    const { text, position, parentEntryId, cardData } = req.body;
    
    if (!text || !position) {
      return res.status(400).json({ error: 'text and position are required' });
    }

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      cardData: cardData || null,
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
    console.log(`[DELETE] Deleting entry ${id} for user ${req.user.id}`);
    await deleteEntry(id, req.user.id);
    console.log(`[DELETE] Successfully deleted entry ${id}`);
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

// Public API endpoints for user pages
app.get('/api/public/:username/entries', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const entries = await getEntriesByUsername(username);
    
    // Log entry statistics for debugging
    console.log(`[DEBUG] User: ${username}, Total entries: ${entries.length}`);
    const rootEntries = entries.filter(e => !e.parentEntryId);
    const childEntries = entries.filter(e => e.parentEntryId);
    console.log(`[DEBUG] Root entries: ${rootEntries.length}, Child entries: ${childEntries.length}`);
    
    res.json({ user: { username: user.username }, entries });
  } catch (error) {
    console.error('Error fetching public entries:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/public/:username/path/*', async (req, res) => {
  try {
    const { username } = req.params;
    const pathParts = req.params[0] ? req.params[0].split('/').filter(Boolean).map(p => decodeURIComponent(p)) : [];
    
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const allEntries = await getEntriesByUsername(username);
    const entriesMap = new Map(allEntries.map(e => [e.id, e]));
    
    // Build path from root to target entry
    let currentEntry = null;
    const path = [];
    
    // Find root entries (no parent)
    const rootEntries = allEntries.filter(e => !e.parentEntryId);
    
    // Navigate through path
    for (const pathPart of pathParts) {
      // Find entry with matching slug in current level
      const candidates = currentEntry 
        ? allEntries.filter(e => e.parentEntryId === currentEntry.id)
        : rootEntries;
      
      // Create slug from path part (normalize)
      const searchSlug = pathPart.toLowerCase().replace(/-/g, ' ').trim();
      
      const found = candidates.find(e => {
        // Create slug from entry text
        const entrySlug = e.text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
        // Match if slugs are similar (fuzzy matching)
        return entrySlug === searchSlug || 
               entrySlug.startsWith(searchSlug) || 
               searchSlug.startsWith(entrySlug) ||
               entrySlug.includes(searchSlug) ||
               searchSlug.includes(entrySlug);
      });
      
      if (!found) {
        return res.status(404).json({ error: 'Path not found' });
      }
      
      path.push({ id: found.id, text: found.text });
      currentEntry = found;
    }
    
    // Get children of current entry (or root entries if at root)
    const children = currentEntry
      ? allEntries.filter(e => e.parentEntryId === currentEntry.id)
      : rootEntries;
    
    res.json({
      user: { username: user.username },
      path,
      currentEntry: currentEntry || null,
      children: children.map(e => ({ id: e.id, text: e.text }))
    });
  } catch (error) {
    console.error('Error fetching public path:', error);
    res.status(500).json({ error: error.message });
  }
});

// Root route - redirect logged-in users to their page
app.get('/', async (req, res) => {
  try {
    // Check if user is logged in
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const user = await getUserById(payload.id);
          if (user && user.username) {
            // Redirect to user's page
            return res.redirect(`/${user.username}`);
          }
        }
      } catch {
        // Invalid token, serve main app
      }
    }
    
    // Not logged in or no username - serve main app (will show auth)
    try {
      const indexPath = join(__dirname, '../public/index.html');
      const html = readFileSync(indexPath, 'utf8');
      res.send(html);
    } catch (error) {
      console.error('Error reading index.html:', error);
      res.status(500).send('Error loading page');
    }
  } catch (error) {
    console.error('Error handling root route:', error);
    res.status(500).send('Error loading page');
  }
});

// Serve user pages (always canvas view, editable if owner)
// Exclude requests with file extensions (static files)
app.get('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Skip if this looks like a static file request (has extension)
    if (username.includes('.')) {
      return res.status(404).send('Not found');
    }
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Check if logged-in user is the page owner
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    let isOwner = false;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const loggedInUser = await getUserById(payload.id);
          if (loggedInUser && loggedInUser.id === user.id) {
            isOwner = true;
          }
        }
      } catch {
        // Invalid token, treat as public
      }
    }
    
    // Always serve canvas view (editable if owner, read-only if public)
    res.send(generateUserPageHTML(user, isOwner));
  } catch (error) {
    console.error('Error serving user page:', error);
    res.status(500).send('Error loading page');
  }
});

// Handle nested paths for user pages (same as root - just show canvas)
// Exclude requests with file extensions (static files)
app.get('/:username/*', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Skip if this looks like a static file request (has extension)
    if (username.includes('.')) {
      return res.status(404).send('Not found');
    }
    
    const pathParts = req.params[0] ? req.params[0].split('/').filter(Boolean).map(p => decodeURIComponent(p)) : [];
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Check if logged-in user is the page owner
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    let isOwner = false;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const loggedInUser = await getUserById(payload.id);
          if (loggedInUser && loggedInUser.id === user.id) {
            isOwner = true;
          }
        }
      } catch {
        // Invalid token, treat as public
      }
    }
    
    // Always serve canvas view (editable if owner, read-only if public)
    res.send(generateUserPageHTML(user, isOwner, pathParts));
  } catch (error) {
    console.error('Error serving user page:', error);
    res.status(500).send('Error loading page');
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
