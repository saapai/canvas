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

// Only serve static files in local development
// On Vercel, static files are served automatically
if (process.env.VERCEL !== '1') {
  app.use(express.static('public'));
}

// Helper function to generate public user page HTML
function generatePublicPageHTML(user, initialPath = []) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${user.username} - Duttapad</title>
  <link rel="stylesheet" href="/styles.css">
  <style>
    .public-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .public-header {
      margin-bottom: 40px;
    }
    .public-title {
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .public-breadcrumb {
      font-size: 14px;
      color: rgba(0,0,0,0.5);
      margin-bottom: 20px;
    }
    .public-breadcrumb a {
      color: rgba(0,0,0,0.7);
      text-decoration: none;
    }
    .public-breadcrumb a:hover {
      text-decoration: underline;
    }
    .entry-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .entry-item {
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 8px;
      background: rgba(255,255,255,0.6);
      cursor: pointer;
      transition: all 0.2s;
    }
    .entry-item:hover {
      border-color: rgba(0,0,0,0.2);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .entry-text {
      white-space: pre-wrap;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="public-container">
    <div class="public-header">
      <h1 class="public-title">${user.username}</h1>
      <div class="public-breadcrumb" id="breadcrumb"></div>
    </div>
    <ul class="entry-list" id="entryList"></ul>
  </div>
  <script>
    const username = '${user.username}';
    const path = ${JSON.stringify(initialPath)};
    
    async function loadEntries() {
      const url = path.length === 0 
        ? \`/api/public/\${username}/entries\`
        : \`/api/public/\${username}/path/\${path.map(encodeURIComponent).join('/')}\`;
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (!res.ok) {
        document.getElementById('entryList').innerHTML = '<li>Error loading entries</li>';
        return;
      }
      
      // Update breadcrumb
      const breadcrumb = document.getElementById('breadcrumb');
      const parts = [
        { text: 'Home', href: '/' },
        { text: data.user.username, href: \`/\${data.user.username}\` }
      ];
      
      if (data.path && data.path.length > 0) {
        let currentPath = '';
        data.path.forEach((part, i) => {
          const slug = part.text.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          currentPath += '/' + encodeURIComponent(slug);
          parts.push({
            text: part.text,
            href: \`/\${data.user.username}\${currentPath}\`
          });
        });
      }
      
      breadcrumb.innerHTML = parts.map((p, i) => 
        i === 0 ? \`<a href="\${p.href}">\${p.text}</a>\` :
        i === parts.length - 1 ? \` › \${p.text}\` :
        \` › <a href="\${p.href}">\${p.text}</a>\`
      ).join('');
      
      // Render entries
      const entries = data.children || data.entries || [];
      const list = document.getElementById('entryList');
      
      if (entries.length === 0) {
        list.innerHTML = '<li>No entries here yet</li>';
        return;
      }
      
      list.innerHTML = entries.map(entry => {
        const slug = entry.text.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        return \`<li class="entry-item" onclick="navigateTo('\${entry.id}', '\${slug}')">
          <div class="entry-text">\${escapeHtml(entry.text)}</div>
        </li>\`;
      }).join('');
    }
    
    function navigateTo(entryId, slug) {
      path.push(slug);
      window.history.pushState({}, '', \`/\${username}/\${path.map(encodeURIComponent).join('/')}\`);
      loadEntries();
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      if (pathParts[0] === username) {
        path.length = 0;
        pathParts.slice(1).forEach(p => path.push(decodeURIComponent(p)));
        loadEntries();
      }
    });
    
    loadEntries();
  </script>
</body>
</html>
  `;
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

// Public API endpoints for user pages
app.get('/api/public/:username/entries', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const entries = await getEntriesByUsername(username);
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

// Serve public user pages
app.get('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    res.send(generatePublicPageHTML(user, []));
  } catch (error) {
    console.error('Error serving user page:', error);
    res.status(500).send('Error loading page');
  }
});

// Handle nested paths for user pages
app.get('/:username/*', async (req, res) => {
  try {
    const { username } = req.params;
    const pathParts = req.params[0] ? req.params[0].split('/').filter(Boolean).map(p => decodeURIComponent(p)) : [];
    
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    res.send(generatePublicPageHTML(user, pathParts));
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
