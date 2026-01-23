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
// BUT exclude /api routes from static file serving
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  return express.static('public')(req, res, next);
});

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
    window.PAGE_OWNER_ID = '${user.id}';
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
    
    console.log('Initial phone lookup:', {
      searchedPhone: normalizedPhone,
      foundUsers: users.length,
      users: users.map(u => ({ id: u.id, phone: u.phone, username: u.username }))
    });
    
    // If not found, try alternative phone formats (with/without +1, with/without spaces)
    if (users.length === 0) {
      // Try without +1 prefix if it starts with +1
      if (normalizedPhone.startsWith('+1')) {
        const phoneWithoutPlus = normalizedPhone.substring(2).trim();
        console.log('Trying without +1 prefix:', phoneWithoutPlus);
        users = await getUsersByPhone(phoneWithoutPlus);
        console.log('Result without +1:', { foundUsers: users.length });
      }
      // Try with +1 if it doesn't have it
      if (users.length === 0 && !normalizedPhone.startsWith('+1')) {
        const phoneWithPlusOne = '+1' + normalizedPhone;
        console.log('Trying with +1 prefix:', phoneWithPlusOne);
        users = await getUsersByPhone(phoneWithPlusOne);
        console.log('Result with +1:', { foundUsers: users.length });
      }
      // Try without any + prefix
      if (users.length === 0 && normalizedPhone.startsWith('+')) {
        const phoneWithoutPlus = normalizedPhone.substring(1);
        console.log('Trying without + prefix:', phoneWithoutPlus);
        users = await getUsersByPhone(phoneWithoutPlus);
        console.log('Result without +:', { foundUsers: users.length });
      }
      // Special handling for +13853687238 format (starts with +13, not +1)
      if (users.length === 0 && normalizedPhone === '+13853687238') {
        console.log('Special handling for +13853687238');
        // Try as +1 3853687238 (assuming it should be +1 3853687238)
        users = await getUsersByPhone('+13853687238');
        console.log('Result for +13853687238:', { foundUsers: users.length });
        // Try without + prefix
        if (users.length === 0) {
          users = await getUsersByPhone('13853687238');
          console.log('Result for 13853687238:', { foundUsers: users.length });
        }
        // Try last 10 digits only
        if (users.length === 0) {
          users = await getUsersByPhone('3853687238');
          console.log('Result for 3853687238:', { foundUsers: users.length });
        }
      }
    }
    
    console.log('Final phone lookup:', {
      searchedPhone: normalizedPhone,
      foundUsers: users.length,
      users: users.map(u => ({ id: u.id, phone: u.phone, username: u.username }))
    });
    
    // Filter users to only those with usernames
    const usersWithUsernames = users.filter(u => u.username && String(u.username).trim().length > 0);
    
    console.log('Users with usernames:', {
      count: usersWithUsernames.length,
      usernames: usersWithUsernames.map(u => ({ id: u.id, username: u.username }))
    });
    
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

// Test endpoint to verify API routes work
app.get('/api/test', (req, res) => {
  console.log('[TEST] API test route hit');
  return res.json({ success: true, message: 'API routes are working' });
});

// Get all spaces/usernames for the current user
// IMPORTANT: This route must be defined BEFORE the /:username catch-all route
// Using POST like verify-code to avoid GET route conflicts
app.post('/api/auth/spaces', requireAuth, async (req, res) => {
  try {
    console.log('[SPACES] ========== ROUTE MATCHED! ==========');
    console.log('[SPACES] Current user:', req.user ? { id: req.user.id, phone: req.user.phone, username: req.user.username } : 'null');
    
    if (!req.user || !req.user.phone) {
      console.log('[SPACES] No user or phone, returning 401');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Use the EXACT same logic as verify-code
    const normalizedPhone = String(req.user.phone).trim();
    console.log('[SPACES] Looking up users for phone:', normalizedPhone);
    
    // Try to find all users by phone number (same as verify-code)
    let users = await getUsersByPhone(normalizedPhone);
    
    console.log('[SPACES] Initial phone lookup:', {
      searchedPhone: normalizedPhone,
      foundUsers: users.length,
      users: users.map(u => ({ id: u.id, phone: u.phone, username: u.username }))
    });
    
    // If not found, try alternative phone formats (same as verify-code)
    if (users.length === 0) {
      // Try without +1 prefix if it starts with +1
      if (normalizedPhone.startsWith('+1')) {
        const phoneWithoutPlus = normalizedPhone.substring(2).trim();
        console.log('[SPACES] Trying without +1 prefix:', phoneWithoutPlus);
        users = await getUsersByPhone(phoneWithoutPlus);
        console.log('[SPACES] Result without +1:', { foundUsers: users.length });
      }
      // Try with +1 if it doesn't have it
      if (users.length === 0 && !normalizedPhone.startsWith('+1')) {
        const phoneWithPlusOne = '+1' + normalizedPhone;
        console.log('[SPACES] Trying with +1 prefix:', phoneWithPlusOne);
        users = await getUsersByPhone(phoneWithPlusOne);
        console.log('[SPACES] Result with +1:', { foundUsers: users.length });
      }
      // Try without any + prefix
      if (users.length === 0 && normalizedPhone.startsWith('+')) {
        const phoneWithoutPlus = normalizedPhone.substring(1);
        console.log('[SPACES] Trying without + prefix:', phoneWithoutPlus);
        users = await getUsersByPhone(phoneWithoutPlus);
        console.log('[SPACES] Result without +:', { foundUsers: users.length });
      }
      // Special handling for +13853687238 format (starts with +13, not +1)
      if (users.length === 0 && normalizedPhone === '+13853687238') {
        console.log('[SPACES] Special handling for +13853687238');
        users = await getUsersByPhone('+13853687238');
        console.log('[SPACES] Result for +13853687238:', { foundUsers: users.length });
        // Try without + prefix
        if (users.length === 0) {
          users = await getUsersByPhone('13853687238');
          console.log('[SPACES] Result for 13853687238:', { foundUsers: users.length });
        }
        // Try last 10 digits only
        if (users.length === 0) {
          users = await getUsersByPhone('3853687238');
          console.log('[SPACES] Result for 3853687238:', { foundUsers: users.length });
        }
      }
    }
    
    console.log('[SPACES] Final phone lookup:', {
      searchedPhone: normalizedPhone,
      foundUsers: users.length,
      users: users.map(u => ({ id: u.id, phone: u.phone, username: u.username }))
    });
    
    // Filter users to only those with usernames (same as verify-code)
    const usersWithUsernames = users.filter(u => u.username && String(u.username).trim().length > 0);
    
    console.log('[SPACES] Users with usernames:', {
      count: usersWithUsernames.length,
      usernames: usersWithUsernames.map(u => ({ id: u.id, username: u.username }))
    });
    
    const spaces = usersWithUsernames.map(u => ({
      id: u.id,
      username: u.username
    }));
    
    console.log('[SPACES] Returning spaces:', spaces);
    
    return res.json({ spaces });
  } catch (error) {
    console.error('[SPACES] Error fetching spaces:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Create a new space/username
app.post('/api/auth/create-space', requireAuth, async (req, res) => {
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
    
    // Create new user with same phone number
    const newUser = await createUser(req.user.phone);
    const updated = await setUsername(newUser.id, trimmed);
    
    const token = jwt.sign(
      { id: updated.id },
      JWT_SECRET,
      { expiresIn: '365d' }
    );
    
    setAuthCookie(res, token);
    
    return res.json({
      user: { id: updated.id, phone: updated.phone, username: updated.username }
    });
  } catch (error) {
    console.error('Error creating space:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Update username
app.put('/api/auth/update-username', requireAuth, async (req, res) => {
  try {
    const { username, userId } = req.body;
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const trimmed = username.trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (trimmed.length > 40) {
      return res.status(400).json({ error: 'Username too long' });
    }
    
    // Check if username is taken (excluding current user)
    const existingUser = await getUserByUsername(trimmed);
    if (existingUser && existingUser.id !== userId) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    const updated = await setUsername(userId, trimmed);
    const token = jwt.sign(
      { id: updated.id },
      JWT_SECRET,
      { expiresIn: '365d' }
    );
    
    setAuthCookie(res, token);
    
    return res.json({
      user: { id: updated.id, phone: updated.phone, username: updated.username }
    });
  } catch (error) {
    console.error('Error updating username:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  // Clear the auth cookie with explicit settings
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: undefined // Don't set domain to ensure it works across all paths
  });
  
  // Also try clearing with different variations to be sure
  res.cookie('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0) // Expire immediately
  });
  
  console.log('[LOGOUT] Cleared auth cookie');
  return res.json({ success: true });
});

// Diagnostic: Log any unmatched API routes
app.use('/api/*', (req, res, next) => {
  console.log('[API] Unmatched API route:', req.method, req.path);
  console.log('[API] Full URL:', req.originalUrl);
  console.log('[API] Headers:', req.headers);
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
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

// Search for movies using TMDB API
app.get('/api/search/movies', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_API_KEY) {
      return res.status(500).json({ error: 'TMDB API key not configured' });
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q.trim())}&page=1`
    );

    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.results || []).slice(0, 5).map(movie => ({
      id: movie.id,
      title: movie.title,
      year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : null,
      overview: movie.overview || '',
      type: 'movie'
    }));

    res.json({ results });
  } catch (error) {
    console.error('Error searching movies:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search for songs using Spotify API (requires client credentials)
app.get('/api/search/songs', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      // Fallback: return empty results if Spotify not configured
      return res.json({ results: [] });
    }

    // Get access token using client credentials
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get Spotify access token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Search for tracks
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.trim())}&type=track&limit=5`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    if (!searchResponse.ok) {
      throw new Error(`Spotify API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const results = (searchData.tracks?.items || []).map(track => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      image: track.album.images && track.album.images.length > 0 ? track.album.images[0].url : null,
      previewUrl: track.preview_url,
      spotifyUrl: track.external_urls.spotify,
      type: 'song'
    }));

    res.json({ results });
  } catch (error) {
    console.error('Error searching songs:', error);
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
    const { id, text, textHtml, position, parentEntryId, linkCardsData, mediaCardData, pageOwnerId } = req.body;
    
    if (!id || !text || !position) {
      return res.status(400).json({ error: 'id, text, and position are required' });
    }

    // Determine which user ID to use for saving
    let targetUserId = req.user.id;
    
    // If pageOwnerId is provided and different from logged-in user, verify permission
    if (pageOwnerId && pageOwnerId !== req.user.id) {
      const pageOwner = await getUserById(pageOwnerId);
      if (!pageOwner) {
        return res.status(403).json({ error: 'Invalid page owner' });
      }
      
      // Verify that logged-in user and page owner have the same phone number
      const loggedInPhone = req.user.phone.replace(/\s/g, '');
      const pageOwnerPhone = pageOwner.phone.replace(/\s/g, '');
      
      if (loggedInPhone !== pageOwnerPhone) {
        console.log('[SAVE] Phone mismatch:', loggedInPhone, pageOwnerPhone);
        return res.status(403).json({ error: 'Not authorized to edit this page' });
      }
      
      // Permission verified - use pageOwnerId
      targetUserId = pageOwnerId;
      console.log('[SAVE] Using pageOwnerId:', targetUserId);
    }

    console.log(`[SAVE] Saving entry ${id} for user ${targetUserId}, parent: ${parentEntryId}, text: ${text.substring(0, 30)}, hasTextHtml: ${!!textHtml}`);

    const entry = {
      id,
      text,
      textHtml: textHtml || null,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      linkCardsData: linkCardsData || null,
      mediaCardData: mediaCardData || null,
      userId: targetUserId
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
    const { text, textHtml, position, parentEntryId, linkCardsData, mediaCardData, pageOwnerId } = req.body;
    
    if (!text || !position) {
      return res.status(400).json({ error: 'text and position are required' });
    }

    // Determine which user ID to use for saving
    let targetUserId = req.user.id;
    
    // If pageOwnerId is provided and different from logged-in user, verify permission
    if (pageOwnerId && pageOwnerId !== req.user.id) {
      const pageOwner = await getUserById(pageOwnerId);
      if (!pageOwner) {
        return res.status(403).json({ error: 'Invalid page owner' });
      }
      
      // Verify that logged-in user and page owner have the same phone number
      const loggedInPhone = req.user.phone.replace(/\s/g, '');
      const pageOwnerPhone = pageOwner.phone.replace(/\s/g, '');
      
      if (loggedInPhone !== pageOwnerPhone) {
        return res.status(403).json({ error: 'Not authorized to edit this page' });
      }
      
      // Permission verified - use pageOwnerId
      targetUserId = pageOwnerId;
    }

    console.log(`[UPDATE] Updating entry ${id} for user ${targetUserId}, text: ${text.substring(0, 30)}`);

    const entry = {
      id,
      text,
      textHtml: textHtml || null,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      linkCardsData: linkCardsData || null,
      mediaCardData: mediaCardData || null,
      userId: targetUserId
    };

    const savedEntry = await saveEntry(entry);
    console.log(`[UPDATE] Successfully updated entry ${id}`);
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
    const { pageOwnerId } = req.query;
    
    // Determine which user ID to use for deletion
    let targetUserId = req.user.id;
    
    // If pageOwnerId is provided and different from logged-in user, verify permission
    if (pageOwnerId && pageOwnerId !== req.user.id) {
      const pageOwner = await getUserById(pageOwnerId);
      if (!pageOwner) {
        return res.status(403).json({ error: 'Invalid page owner' });
      }
      
      // Verify that logged-in user and page owner have the same phone number
      const loggedInPhone = req.user.phone.replace(/\s/g, '');
      const pageOwnerPhone = pageOwner.phone.replace(/\s/g, '');
      
      if (loggedInPhone !== pageOwnerPhone) {
        console.log('[DELETE] Phone mismatch:', loggedInPhone, pageOwnerPhone);
        return res.status(403).json({ error: 'Not authorized to edit this page' });
      }
      
      // Permission verified - use pageOwnerId
      targetUserId = pageOwnerId;
      console.log('[DELETE] Using pageOwnerId:', targetUserId);
    }
    
    console.log(`[DELETE] Deleting entry ${id} for user ${targetUserId}`);
    await deleteEntry(id, targetUserId);
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

// Root route - redirect logged-in users to their PRIMARY (oldest) duttapad
app.get('/', async (req, res) => {
  try {
    // If logout query param is present, don't redirect even if logged in
    const isLogout = req.query.logout === 'true';
    
    if (!isLogout) {
    // Check if user is logged in
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const user = await getUserById(payload.id);
          if (user && user.phone) {
            // Get ALL users with the same phone number
            const normalizedPhone = user.phone.replace(/\s/g, '');
            let users = await getUsersByPhone(normalizedPhone);
            
            // Filter to users with usernames only
            const usersWithUsernames = users.filter(u => u.username && u.username.trim().length > 0);
            
            if (usersWithUsernames.length > 0) {
              // Redirect to the OLDEST (first created) username as the primary duttapad
              // Sort by created_at ascending (oldest first)
              usersWithUsernames.sort((a, b) => {
                const aDate = new Date(a.created_at || 0);
                const bDate = new Date(b.created_at || 0);
                return aDate - bDate;
              });
              
              const primaryUser = usersWithUsernames[0];
              console.log(`[ROOT] Redirecting to primary duttapad: ${primaryUser.username}`);
              return res.redirect(`/${primaryUser.username}`);
            }
          }
        }
      } catch {
        // Invalid token, serve main app
        }
      }
    }
    
    // Not logged in, no username, or logout requested - serve main app (will show auth)
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
// IMPORTANT: This must come AFTER all /api routes to avoid catching API requests
app.get('/:username', async (req, res) => {
  try {
    // CRITICAL: Skip API routes - check path first before processing
    // Use req.originalUrl or req.url to get the full path
    const fullPath = req.originalUrl || req.url || req.path;
    if (fullPath && fullPath.startsWith('/api/')) {
      console.log('[USER ROUTE] Blocked API route, fullPath:', fullPath, 'req.path:', req.path);
      return res.status(404).json({ error: 'API route blocked by username route' });
    }
    
    const { username } = req.params;
    
    // Skip API routes - they should have been handled already
    if (username === 'api' || username.startsWith('api')) {
      console.log('[USER ROUTE] Blocked API route, username:', username, 'fullPath:', fullPath);
      return res.status(404).json({ error: 'API route blocked by username route' });
    }
    
    // Skip if this looks like a static file request (has extension)
    if (username.includes('.')) {
      return res.status(404).send('Not found');
    }
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Check if logged-in user is the page owner (by phone number, not user ID)
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    let isOwner = false;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const loggedInUser = await getUserById(payload.id);
          if (loggedInUser && loggedInUser.phone && user.phone) {
            // Normalize phone numbers by removing spaces and compare
            const loggedInPhone = loggedInUser.phone.replace(/\s/g, '');
            const userPhone = user.phone.replace(/\s/g, '');
            if (loggedInPhone === userPhone) {
              isOwner = true;
            }
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
// IMPORTANT: This must come AFTER all /api routes to avoid catching API requests
app.get('/:username/*', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Skip API routes - they should have been handled already
    // This check must come FIRST before any other processing
    if (username === 'api') {
      console.log('[USER ROUTE] Blocked API route in nested path, username:', username);
      return res.status(404).send('Not found');
    }
    
    // Skip if this looks like a static file request (has extension)
    if (username.includes('.')) {
      return res.status(404).send('Not found');
    }
    
    const pathParts = req.params[0] ? req.params[0].split('/').filter(Boolean).map(p => decodeURIComponent(p)) : [];
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Check if logged-in user is the page owner (by phone number, not user ID)
    const cookies = parseCookies(req);
    const token = cookies.auth_token;
    let isOwner = false;
    
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.id) {
          const loggedInUser = await getUserById(payload.id);
          if (loggedInUser && loggedInUser.phone && user.phone) {
            // Normalize phone numbers by removing spaces and compare
            const loggedInPhone = loggedInUser.phone.replace(/\s/g, '');
            const userPhone = user.phone.replace(/\s/g, '');
            if (loggedInPhone === userPhone) {
              isOwner = true;
            }
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
    console.log('Registered routes:');
    console.log('  GET /api/auth/spaces');
    console.log('  POST /api/auth/create-space');
    console.log('  PUT /api/auth/update-username');
    console.log('  POST /api/auth/logout');
  });
}
