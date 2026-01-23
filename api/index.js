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
  setUsername,
  getStats
} from './db.js';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const RESERVED_USERNAMES = new Set(['stats']);

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
    console.log('[AUTH] getUserById result:', user ? { id: user.id, username: user.username, phone: user.phone } : 'null');
    
    if (!user) {
      req.user = null;
      return next();
    }
    
    // IMPORTANT: If there's a username, verify the user ID matches the database record
    // This handles cases where JWT has a stale/incorrect user ID
    if (user.username) {
      console.log('[AUTH] User has username:', user.username, '- checking for correct user ID');
      const correctUser = await getUserByUsername(user.username);
      console.log('[AUTH] getUserByUsername result:', correctUser ? { id: correctUser.id, username: correctUser.username } : 'null');
      
      if (correctUser && correctUser.id !== user.id) {
        console.warn('[AUTH] USER ID MISMATCH DETECTED for username:', user.username);
        console.warn('[AUTH] JWT user ID:', user.id);
        console.warn('[AUTH] DB user ID:', correctUser.id);
        console.warn('[AUTH] Using correct DB user record');
        req.user = correctUser;
        return next();
      }
    } else {
      console.log('[AUTH] User has NO username - cannot verify correct user ID');
    }
    
    req.user = user;
    return next();
  } catch (error) {
    console.error('[AUTH] Error in attachUser:', error);
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
    if (RESERVED_USERNAMES.has(trimmed)) {
      return res.status(400).json({ error: 'Username is reserved' });
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

// Stats API - aggregate metrics for dashboard
app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// Stats page (served from API due to Vercel rewrites)
app.get('/stats', (_req, res) => {
  try {
    const statsPath = join(__dirname, '../public/stats.html');
    const html = readFileSync(statsPath, 'utf8');
    res.send(html);
  } catch (error) {
    console.error('Error serving stats page:', error);
    res.status(500).send('Error loading stats page');
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

// Get all spaces/usernames for the current user
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

// Diagnostic endpoint to debug user ID issues
app.get('/api/debug/user-info', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get all users with the same phone number
    const usersWithSamePhone = await getUsersByPhone(req.user.phone);
    
    // Get user by username if they have one
    let userByUsername = null;
    if (req.user.username) {
      userByUsername = await getUserByUsername(req.user.username);
    }
    
    return res.json({
      currentUser: {
        id: req.user.id,
        phone: req.user.phone,
        username: req.user.username
      },
      usersWithSamePhone: usersWithSamePhone.map(u => ({
        id: u.id,
        phone: u.phone,
        username: u.username
      })),
      userByUsername: userByUsername ? {
        id: userByUsername.id,
        phone: userByUsername.phone,
        username: userByUsername.username
      } : null
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
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
    console.log('[API] POST /api/entries - User:', req.user ? req.user.id : 'none');
    
    if (!req.user) {
      console.log('[API] POST /api/entries - No user, returning 401');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { id, text, position, parentEntryId, linkCardsData, mediaCardData } = req.body;
    console.log('[API] POST /api/entries - Entry data:', {
      id,
      text: text?.substring(0, 50),
      hasPosition: !!position,
      hasMedia: !!mediaCardData,
      hasLink: !!linkCardsData,
      userId: req.user.id
    });
    
    if (!id || text === undefined || !position) {
      console.log('[API] POST /api/entries - Missing required fields');
      return res.status(400).json({ error: 'id, text, and position are required' });
    }

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      linkCardsData: linkCardsData || null,
      mediaCardData: mediaCardData || null,
      userId: req.user.id
    };

    console.log('[API] POST /api/entries - Calling saveEntry for:', entry.id);
    const savedEntry = await saveEntry(entry);
    console.log('[API] POST /api/entries - Save successful:', savedEntry.id);
    res.json(savedEntry);
  } catch (error) {
    console.error('[API] POST /api/entries - Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    const { text, position, parentEntryId, linkCardsData, mediaCardData } = req.body;
    
    if (text === undefined || !position) {
      return res.status(400).json({ error: 'text and position are required' });
    }

    const entry = {
      id,
      text,
      position: { x: position.x, y: position.y },
      parentEntryId: parentEntryId || null,
      linkCardsData: linkCardsData || null,
      mediaCardData: mediaCardData || null,
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

// Login and Home routes - always available so root can redirect appropriately
const enableLoginRoutes = true;

if (enableLoginRoutes) {
  // Login route - show login page (or redirect if already logged in)
  app.get('/login', async (req, res) => {
    try {
      // Check if user is already logged in
      const cookies = parseCookies(req);
      const token = cookies.auth_token;
      
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          if (payload && payload.id) {
            const user = await getUserById(payload.id);
            if (user && user.username) {
              // Already logged in, redirect to their page
              return res.redirect(`/${user.username}`);
            }
          }
        } catch {
          // Invalid token, continue to show login
        }
      }
      
      // Not logged in - serve app with login page flag
      try {
        const indexPath = join(__dirname, '../public/index.html');
        let html = readFileSync(indexPath, 'utf8');
        
        // Add script to automatically show login overlay
        const loginScript = `
  <script>
    window.SHOW_LOGIN_PAGE = true;
  </script>`;
        html = html.replace('<script src="app.js"></script>', `${loginScript}\n  <script src="app.js"></script>`);
        
        res.send(html);
      } catch (error) {
        console.error('Error reading index.html:', error);
        res.status(500).send('Error loading page');
      }
    } catch (error) {
      console.error('Error handling login route:', error);
      res.status(500).send('Error loading page');
    }
  });

  // Home route - redirect to user's page (requires auth)
  app.get('/home', async (req, res) => {
    try {
      // Check if user is logged in
      const cookies = parseCookies(req);
      const token = cookies.auth_token;
      
      if (!token) {
        return res.redirect('/login');
      }
      
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
        // Invalid token, redirect to login
        return res.redirect('/login');
      }
      
      // No username set, redirect to root (will show username setup)
      return res.redirect('/');
    } catch (error) {
      console.error('Error handling home route:', error);
      res.status(500).send('Error loading page');
    }
  });
  
  console.log('Login and /home routes enabled');
}

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
    
    // Not logged in or no username - send to login page
    return res.redirect('/login');
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
