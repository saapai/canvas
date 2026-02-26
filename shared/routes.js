import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import twilio from 'twilio';

import {
  initDatabase,
  getAllEntries,
  getEntriesCount,
  saveEntry,
  deleteEntry,
  restoreDeletedEntries,
  saveAllEntries,
  getUserById,
  getUserByPhone,
  getUsersByPhone,
  getUserByUsername,
  getEntriesByUsername,
  getEntriesCountByUsername,
  getEntryPath,
  createUser,
  isUsernameTaken,
  setUsername,
  getPool,
  setUserBackground,
  getGoogleTokens,
  saveGoogleTokens,
  deleteGoogleTokens,
  saveGoogleCalendarSettings
} from './db.js';

import { processTextWithLLM, fetchLinkMetadata, generateLinkCard, extractDeadlinesFromFile, convertTextToLatex, generateResearchEntries, planResearch } from './llm.js';
import { chatWithCanvas, organizeDroppedContent } from './chat.js';
import { requireAuth, validatePhone, validateUsername, setAuthCookie, parseCookies } from './auth.js';
import { JWT_SECRET, RESERVED_USERNAMES, debugLog } from './config.js';
import { upload, supabase, supabaseBucket } from './upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createRouter(options = {}) {
  const { authLimiter } = options;
  const authLimiterMiddleware = authLimiter || ((req, res, next) => next());

  const router = Router();

  // Optional Twilio client for SMS / Verify (used for sending verification codes)
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
  const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
  const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

  const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

  // ——— Google OAuth + Calendar/Sheets/Docs ———

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://duttapad.com/api/oauth/google/callback';
  const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
  ];

  function createOAuth2Client() {
    return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  }

  async function getAuthenticatedClient(userId) {
    const tokens = await getGoogleTokens(userId);
    if (!tokens) return null;
    const oauth2 = createOAuth2Client();
    oauth2.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.token_expiry ? new Date(tokens.token_expiry).getTime() : null
    });
    // Auto-refresh: listen for new tokens
    oauth2.on('tokens', async (newTokens) => {
      try {
        await saveGoogleTokens(userId, { ...newTokens, refresh_token: newTokens.refresh_token || tokens.refresh_token });
      } catch (e) { console.error('Failed to save refreshed Google tokens:', e); }
    });
    return oauth2;
  }

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

      // Add script to set page context before modules load
      const contextScript = `
  <script>
    window.PAGE_USERNAME = '${user.username}';
    window.PAGE_IS_OWNER = ${isOwner};
    window.PAGE_OWNER_ID = '${user.id}';
    window.PAGE_PATH = ${JSON.stringify(pathParts)};
  </script>`;
      html = html.replace('<script src="js/state.js"></script>', `${contextScript}\n  <script src="js/state.js"></script>`);

      return html;
    } catch (error) {
      console.error('Error reading index.html:', error);
      return '<html><body>Error loading page</body></html>';
    }
  }

  // Health check endpoint (before rate limiting)
  router.get('/api/health', async (req, res) => {
    try {
      const db = getPool();
      // Quick database connectivity check
      await db.query('SELECT 1');
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected'
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error.message
      });
    }
  });

  router.post('/api/auth/send-code', authLimiterMiddleware, async (req, res) => {
    try {
      const { phone } = req.body;
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        return res.status(400).json({ error: phoneValidation.error });
      }
      const normalizedPhone = phoneValidation.normalized;

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

  router.post('/api/auth/verify-code', authLimiterMiddleware, async (req, res) => {
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

      // Single normalized lookup (phone normalization happens in getUsersByPhone)
      const users = await getUsersByPhone(normalizedPhone);

      // Filter users to only those with usernames
      const usersWithUsernames = users.filter(u => u.username && String(u.username).trim().length > 0);

      debugLog('Users with usernames:', {
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
          debugLog('Creating new user with phone:', normalizedPhone);
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

  router.post('/api/auth/select-username', async (req, res) => {
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

  router.post('/api/auth/create-new-user', async (req, res) => {
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

  router.post('/api/auth/set-username', requireAuth, async (req, res) => {
    try {
      const { username } = req.body;
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return res.status(400).json({ error: usernameValidation.error });
      }
      const trimmed = usernameValidation.trimmed;

      if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
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

  router.get('/api/auth/me', async (req, res) => {
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
  router.get('/api/test', (req, res) => {
    debugLog('[TEST] API test route hit');
    return res.json({ success: true, message: 'API routes are working' });
  });

  // Background settings endpoints
  router.get('/api/user/background', requireAuth, async (req, res) => {
    try {
      const user = await getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ bgUrl: user.bg_url || null, bgUploads: user.bg_uploads || [] });
    } catch (error) {
      console.error('Error fetching background:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/api/user/background', requireAuth, async (req, res) => {
    try {
      const { bgUrl, bgUploads } = req.body;
      if (bgUploads !== undefined) {
        if (!Array.isArray(bgUploads) || bgUploads.length > 20 || !bgUploads.every(u => typeof u === 'string')) {
          return res.status(400).json({ error: 'bgUploads must be an array of up to 20 strings' });
        }
      }
      await setUserBackground(req.user.id, bgUrl || null, bgUploads || []);
      res.json({ ok: true });
    } catch (error) {
      console.error('Error saving background:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all spaces/usernames for the current user
  // IMPORTANT: This route must be defined BEFORE the /:username catch-all route
  // Using POST like verify-code to avoid GET route conflicts
  router.post('/api/auth/spaces', requireAuth, async (req, res) => {
    try {
      debugLog('[SPACES] Current user:', req.user ? { id: req.user.id, phone: req.user.phone, username: req.user.username } : 'null');

      if (!req.user || !req.user.phone) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Single normalized lookup (phone normalization happens in getUsersByPhone)
      const normalizedPhone = String(req.user.phone).trim();
      const users = await getUsersByPhone(normalizedPhone);

      // Filter users to only those with usernames (same as verify-code)
      const usersWithUsernames = users.filter(u => u.username && String(u.username).trim().length > 0);

      debugLog('[SPACES] Users with usernames:', {
        count: usersWithUsernames.length,
        usernames: usersWithUsernames.map(u => ({ id: u.id, username: u.username }))
      });

      const spaces = usersWithUsernames.map(u => ({
        id: u.id,
        username: u.username
      }));

      debugLog('[SPACES] Returning spaces:', spaces);

      return res.json({ spaces });
    } catch (error) {
      console.error('[SPACES] Error fetching spaces:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  // Create a new space/username
  router.post('/api/auth/create-space', requireAuth, async (req, res) => {
    try {
      const { username } = req.body;
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return res.status(400).json({ error: usernameValidation.error });
      }
      const trimmed = usernameValidation.trimmed;

      if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
        return res.status(400).json({ error: 'Username is reserved' });
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
  router.put('/api/auth/update-username', requireAuth, async (req, res) => {
    try {
      const { username, userId } = req.body;
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return res.status(400).json({ error: usernameValidation.error });
      }
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'User ID is required' });
      }
      const trimmed = usernameValidation.trimmed;

      if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
        return res.status(400).json({ error: 'Username is reserved' });
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
  router.post('/api/auth/logout', (req, res) => {
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

    debugLog('[LOGOUT] Cleared auth cookie');
    return res.json({ success: true });
  });

  // Initiate Google OAuth flow
  router.get('/api/oauth/google/auth', requireAuth, (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }
    const oauth2 = createOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: req.user.id // pass user ID via state param
    });
    res.json({ url });
  });

  // Google OAuth callback
  router.get('/api/oauth/google/callback', async (req, res) => {
    try {
      const { code, state: userId } = req.query;
      if (!code || !userId) return res.status(400).send('Missing code or state');

      const oauth2 = createOAuth2Client();
      const { tokens } = await oauth2.getToken(code);
      await saveGoogleTokens(userId, tokens);

      // Redirect back to the user's page
      const user = await getUserById(userId);
      const username = user?.username || '';
      res.redirect(`/${username}?google=connected`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.status(500).send('Failed to connect Google account. Please try again.');
    }
  });

  // Check Google connection status
  router.get('/api/oauth/google/status', requireAuth, async (req, res) => {
    try {
      const tokens = await getGoogleTokens(req.user.id);
      res.json({ connected: !!tokens, calendarSettings: tokens?.calendar_settings || {} });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check status' });
    }
  });

  // Disconnect Google account
  router.delete('/api/oauth/google/disconnect', requireAuth, async (req, res) => {
    try {
      const oauth2 = await getAuthenticatedClient(req.user.id);
      if (oauth2) {
        try { await oauth2.revokeCredentials(); } catch (e) { /* ignore revoke errors */ }
      }
      await deleteGoogleTokens(req.user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to disconnect' });
    }
  });

  // List Google Calendars
  router.get('/api/google/calendars', requireAuth, async (req, res) => {
    try {
      const oauth2 = await getAuthenticatedClient(req.user.id);
      if (!oauth2) return res.status(401).json({ error: 'Google not connected' });
      const calendar = google.calendar({ version: 'v3', auth: oauth2 });
      const { data } = await calendar.calendarList.list();
      const tokenData = await getGoogleTokens(req.user.id);
      const settings = tokenData?.calendar_settings || {};
      const calendars = (data.items || []).map(c => ({
        id: c.id,
        summary: c.summary,
        backgroundColor: c.backgroundColor,
        foregroundColor: c.foregroundColor,
        primary: c.primary || false,
        visible: settings[c.id] !== false // default visible
      }));
      res.json({ calendars });
    } catch (error) {
      console.error('Google calendars error:', error);
      if (error.code === 401 || error.message?.includes('invalid_grant')) {
        await deleteGoogleTokens(req.user.id);
        return res.status(401).json({ error: 'Google session expired. Please reconnect.' });
      }
      res.status(500).json({ error: 'Failed to list calendars' });
    }
  });

  // Get Google Calendar events
  router.get('/api/google/calendar/events', requireAuth, async (req, res) => {
    try {
      const oauth2 = await getAuthenticatedClient(req.user.id);
      if (!oauth2) return res.status(401).json({ error: 'Google not connected' });
      const { timeMin, timeMax, calendarIds } = req.query;
      const calendar = google.calendar({ version: 'v3', auth: oauth2 });
      const tokenData = await getGoogleTokens(req.user.id);
      const settings = tokenData?.calendar_settings || {};

      // Get visible calendar IDs
      let ids = calendarIds ? calendarIds.split(',') : null;
      if (!ids) {
        const { data } = await calendar.calendarList.list();
        ids = (data.items || []).filter(c => settings[c.id] !== false).map(c => c.id);
      }

      const allEvents = [];
      for (const calId of ids) {
        if (settings[calId] === false) continue;
        try {
          const { data } = await calendar.events.list({
            calendarId: calId,
            timeMin: timeMin || new Date().toISOString(),
            timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250
          });
          (data.items || []).forEach(e => {
            allEvents.push({
              id: e.id,
              calendarId: calId,
              summary: e.summary || '(No title)',
              description: e.description || '',
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
              allDay: !e.start?.dateTime,
              location: e.location || '',
              htmlLink: e.htmlLink,
              color: e.colorId || null
            });
          });
        } catch (e) {
          console.error(`Failed to fetch events for calendar ${calId}:`, e.message);
        }
      }

      allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
      res.json({ events: allEvents });
    } catch (error) {
      console.error('Google events error:', error);
      if (error.code === 401 || error.message?.includes('invalid_grant')) {
        await deleteGoogleTokens(req.user.id);
        return res.status(401).json({ error: 'Google session expired. Please reconnect.' });
      }
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Save calendar visibility settings
  router.put('/api/google/calendar/settings', requireAuth, async (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Invalid settings' });
      await saveGoogleCalendarSettings(req.user.id, settings);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  router.post('/api/process-text', async (req, res) => {
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

  router.post('/api/generate-link-card', async (req, res) => {
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

      // YouTube metadata from oEmbed is already accurate — skip LLM rewrite
      if (metadata.isVideo) {
        return res.json(metadata);
      }

      const card = await generateLinkCard(metadata);

      res.json(card);
    } catch (error) {
      console.error('Error generating link card:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/upload-image', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Use JPEG, PNG, GIF, WebP, or HEIC.' });
      }
      if (!supabase) {
        return res.status(503).json({ error: 'Image storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
      }
      let buffer = req.file.buffer;
      let mime = req.file.mimetype;
      let ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase();

      const isHeic = mime === 'image/heic' || mime === 'image/heif' || ext === 'heic' || ext === 'heif';
      if (isHeic) {
        try {
          console.log('[upload-image] Converting HEIC to JPEG...');
          buffer = await heicConvert({
            buffer: req.file.buffer,
            format: 'JPEG',
            quality: 0.9
          });
          mime = 'image/jpeg';
          ext = 'jpg';
          console.log('[upload-image] HEIC conversion successful');
        } catch (err) {
          console.error('[upload-image] HEIC conversion failed:', err.message, err.stack);
          return res.status(500).json({
            error: `Failed to convert HEIC image: ${err.message || 'HEIC conversion not supported'}. Please convert to JPEG or PNG first.`
          });
        }
      }

      const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'png';
      const path = `${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
      const { data, error } = await supabase.storage.from(supabaseBucket).upload(path, buffer, {
        contentType: mime,
        upsert: false
      });
      if (error) {
        console.error('Supabase upload error:', error);
        return res.status(500).json({ error: error.message || 'Upload failed' });
      }
      const { data: publicData } = supabase.storage.from(supabaseBucket).getPublicUrl(data.path);
      res.json({ url: publicData.publicUrl });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/upload-background-image', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Use JPEG, PNG, GIF, WebP, or HEIC.' });
      }
      if (!supabase) {
        return res.status(503).json({ error: 'Image storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
      }
      let buffer = req.file.buffer;
      let mime = req.file.mimetype;
      let ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase();

      const isHeic = mime === 'image/heic' || mime === 'image/heif' || ext === 'heic' || ext === 'heif';
      if (isHeic) {
        try {
          console.log('[upload-background-image] Converting HEIC to JPEG...');
          buffer = await heicConvert({
            buffer: req.file.buffer,
            format: 'JPEG',
            quality: 0.9
          });
          mime = 'image/jpeg';
          ext = 'jpg';
          console.log('[upload-background-image] HEIC conversion successful');
        } catch (err) {
          console.error('[upload-background-image] HEIC conversion failed:', err.message, err.stack);
          return res.status(500).json({
            error: `Failed to convert HEIC image: ${err.message || 'HEIC conversion not supported'}. Please convert to JPEG or PNG first.`
          });
        }
      }

      const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'png';
      const path = `${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
      const { data, error } = await supabase.storage.from(supabaseBucket).upload(path, buffer, {
        contentType: mime,
        upsert: false
      });
      if (error) {
        console.error('Supabase upload error:', error);
        return res.status(500).json({ error: error.message || 'Upload failed' });
      }
      const { data: publicData } = supabase.storage.from(supabaseBucket).getPublicUrl(data.path);
      res.json({ url: publicData.publicUrl });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/upload-file', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      if (!supabase) {
        return res.status(503).json({ error: 'File storage not configured.' });
      }
      const ext = req.file.originalname.split('.').pop() || 'bin';
      const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'bin';
      const path = `${req.user.id}/files/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
      const { data, error } = await supabase.storage.from(supabaseBucket).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
      if (error) {
        console.error('Supabase file upload error:', error);
        return res.status(500).json({ error: error.message || 'Upload failed' });
      }
      const { data: publicData } = supabase.storage.from(supabaseBucket).getPublicUrl(data.path);
      res.json({
        url: publicData.publicUrl,
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/extract-deadlines', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const allowed = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'text/csv', 'text/html', 'text/markdown', 'text/rtf',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
      ];
      if (!allowed.includes(req.file.mimetype) && !req.file.mimetype.startsWith('text/')) {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, text files, or images.' });
      }
      const result = await extractDeadlinesFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      res.json(result);
    } catch (error) {
      console.error('Error extracting deadlines:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/convert-latex', requireAuth, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }
      const result = await convertTextToLatex(text);
      res.json(result);
    } catch (error) {
      console.error('Error converting to LaTeX:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/research-suggestions', requireAuth, async (req, res) => {
    try {
      const { thoughtChain, canvasContext } = req.body;
      if (!Array.isArray(thoughtChain) || thoughtChain.length === 0) {
        return res.status(400).json({ error: 'thoughtChain must be a non-empty array' });
      }
      const chain = thoughtChain.filter(t => typeof t === 'string' && t.trim().length > 0).slice(0, 15);
      if (chain.length === 0) return res.status(400).json({ error: 'thoughtChain must contain valid strings' });
      const context = Array.isArray(canvasContext) ? canvasContext.slice(0, 20) : [];
      const result = await generateResearchEntries(chain, context);
      res.json(result);
    } catch (error) {
      console.error('Error generating research entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/research', requireAuth, async (req, res) => {
    try {
      const { thoughtChain, canvasContext, existingFacts } = req.body;
      if (!Array.isArray(thoughtChain) || thoughtChain.length === 0) {
        return res.status(400).json({ error: 'thoughtChain must be a non-empty array' });
      }
      const chain = thoughtChain.filter(t => typeof t === 'string' && t.trim().length > 0).slice(0, 15);
      if (chain.length === 0) return res.status(400).json({ error: 'thoughtChain must contain valid strings' });
      const context = Array.isArray(canvasContext) ? canvasContext.slice(0, 20) : [];
      const facts = Array.isArray(existingFacts) ? existingFacts.filter(f => typeof f === 'string').slice(0, 30) : [];
      const result = await planResearch(chain, context, facts);
      res.json(result);
    } catch (error) {
      console.error('Error in research:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Search for movies using TMDB API
  router.get('/api/search/movies', async (req, res) => {
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
  router.get('/api/search/songs', async (req, res) => {
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

  router.get('/api/entries', async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Parse pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 1000; // Default to 1000 for backward compatibility
      const offset = (page - 1) * limit;

      // Validate pagination
      if (limit > 5000) {
        return res.status(400).json({ error: 'Limit cannot exceed 5000' });
      }
      if (limit < 1) {
        return res.status(400).json({ error: 'Limit must be at least 1' });
      }

      const [entries, totalCount] = await Promise.all([
        getAllEntries(req.user.id, { limit, offset }),
        getEntriesCount(req.user.id)
      ]);

      res.json({
        entries,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasMore: offset + entries.length < totalCount
        }
      });
    } catch (error) {
      console.error('Error fetching entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/entries', async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id, text, textHtml, position, parentEntryId, linkCardsData, mediaCardData, latexData, pageOwnerId } = req.body;

      debugLog(`[SAVE] Received request for entry ${id}`);

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
          debugLog('[SAVE] Phone mismatch:', loggedInPhone, pageOwnerPhone);
          return res.status(403).json({ error: 'Not authorized to edit this page' });
        }

        // Permission verified - use pageOwnerId
        targetUserId = pageOwnerId;
        debugLog('[SAVE] Using pageOwnerId:', targetUserId);
      }

      debugLog(`[SAVE] Saving entry ${id} for user ${targetUserId}`);

      const entry = {
        id,
        text,
        textHtml: textHtml || null,
        position: { x: position.x, y: position.y },
        parentEntryId: parentEntryId || null,
        linkCardsData: linkCardsData || null,
        mediaCardData: mediaCardData || null,
        latexData: latexData || null,
        userId: targetUserId
      };

      const savedEntry = await saveEntry(entry);
      debugLog(`[SAVE] Successfully saved entry ${id}`);
      res.json(savedEntry);
    } catch (error) {
      console.error('Error saving entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/api/entries/:id', async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params;
      const { text, textHtml, position, parentEntryId, linkCardsData, mediaCardData, latexData, pageOwnerId } = req.body;

      debugLog(`[UPDATE] Received request for entry ${id}`);

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

      debugLog(`[UPDATE] Updating entry ${id} for user ${targetUserId}`);

      const entry = {
        id,
        text,
        textHtml: textHtml || null,
        position: { x: position.x, y: position.y },
        parentEntryId: parentEntryId || null,
        linkCardsData: linkCardsData || null,
        mediaCardData: mediaCardData || null,
        latexData: latexData || null,
        userId: targetUserId
      };

      const savedEntry = await saveEntry(entry);
      debugLog(`[UPDATE] Successfully updated entry ${id}`);
      res.json(savedEntry);
    } catch (error) {
      console.error('Error updating entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/api/entries/:id', async (req, res) => {
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
          debugLog('[DELETE] Phone mismatch:', loggedInPhone, pageOwnerPhone);
          return res.status(403).json({ error: 'Not authorized to edit this page' });
        }

        // Permission verified - use pageOwnerId
        targetUserId = pageOwnerId;
        debugLog('[DELETE] Using pageOwnerId:', targetUserId);
      }

      debugLog(`[DELETE] Deleting entry ${id} for user ${targetUserId}`);
      await deleteEntry(id, targetUserId);
      debugLog(`[DELETE] Successfully deleted entry ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/entries/restore', async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { pageOwnerId } = req.body;
      let targetUserId = req.user.id;
      if (pageOwnerId && pageOwnerId !== req.user.id) {
        const pageOwner = await getUserById(pageOwnerId);
        if (!pageOwner) return res.status(403).json({ error: 'Invalid page owner' });
        const loggedInUser = await getUserById(req.user.id);
        if (!loggedInUser || loggedInUser.phone !== pageOwner.phone) {
          return res.status(403).json({ error: 'No permission' });
        }
        targetUserId = pageOwnerId;
      }
      const restored = await restoreDeletedEntries(targetUserId);
      debugLog(`[RESTORE] Restored ${restored.length} entries for user ${targetUserId}`);
      res.json({ success: true, restored: restored.length, entries: restored });
    } catch (error) {
      console.error('Error restoring entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/entries/batch', async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { entries, pageOwnerId } = req.body;

      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: 'entries must be an array' });
      }

      // Limit batch size to prevent abuse
      if (entries.length > 1000) {
        return res.status(400).json({ error: 'Batch size cannot exceed 1000 entries' });
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

      const savedEntries = await saveAllEntries(entries, targetUserId);
      res.json(savedEntries);
    } catch (error) {
      console.error('Error saving entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/chat', requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { trenches, currentViewEntryId, userMessage, focusedTrench } = req.body || {};
      const payload = {
        trenches: Array.isArray(trenches) ? trenches : [],
        currentViewEntryId: typeof currentViewEntryId === 'string' ? currentViewEntryId : null,
        userMessage: typeof userMessage === 'string' ? userMessage.trim() || null : null,
        focusedTrench: focusedTrench && typeof focusedTrench === 'object' ? focusedTrench : null
      };
      console.log('[CHAT] /api/chat request', {
        userId: req.user?.id,
        trenchesCount: payload.trenches.length,
        hasFocusedTrench: !!payload.focusedTrench,
        currentViewEntryId: payload.currentViewEntryId,
        hasUserMessage: !!payload.userMessage
      });
      const result = await chatWithCanvas(payload);
      if (!result.ok) {
        console.error('[CHAT] chatWithCanvas failed:', result.error);
        return res.status(500).json({ error: result.error || 'Chat failed' });
      }
      console.log('[CHAT] /api/chat success, response length:', result.message?.length);
      res.json({ message: result.message });
    } catch (error) {
      console.error('[CHAT] /api/chat error:', error);
      res.status(500).json({ error: error.message || 'Chat failed' });
    }
  });

  router.post('/api/drop-organize', requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { content, trenches, currentViewEntryId, focusedTrench, userReply, previousPlacements } = req.body || {};
      if (!content || !content.type || !Array.isArray(content.items) || content.items.length === 0) {
        return res.status(400).json({ error: 'content.type and content.items[] are required' });
      }
      if (content.items.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 items per drop' });
      }
      const payload = {
        content,
        trenches: Array.isArray(trenches) ? trenches : [],
        currentViewEntryId: typeof currentViewEntryId === 'string' ? currentViewEntryId : null,
        focusedTrench: focusedTrench && typeof focusedTrench === 'object' ? focusedTrench : null,
        userReply: typeof userReply === 'string' ? userReply.trim() || null : null,
        previousPlacements: Array.isArray(previousPlacements) ? previousPlacements : null
      };
      const result = await organizeDroppedContent(payload);
      if (!result.ok) {
        return res.status(500).json({ error: result.error || 'Organization failed' });
      }
      res.json({ action: result.action, placements: result.placements, trenchName: result.trenchName, message: result.message });
    } catch (error) {
      console.error('[DROP] /api/drop-organize error:', error);
      res.status(500).json({ error: error.message || 'Organization failed' });
    }
  });

  // Public API endpoints for user pages
  router.get('/api/public/:username/entries', async (req, res) => {
    try {
      const { username } = req.params;
      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Parse pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 1000; // Default to 1000 for backward compatibility
      const offset = (page - 1) * limit;

      // Validate pagination
      if (limit > 5000) {
        return res.status(400).json({ error: 'Limit cannot exceed 5000' });
      }
      if (limit < 1) {
        return res.status(400).json({ error: 'Limit must be at least 1' });
      }

      const [entries, totalCount] = await Promise.all([
        getEntriesByUsername(username, { limit, offset }),
        getEntriesCountByUsername(username)
      ]);

      debugLog(`[DEBUG] User: ${username}, Total entries: ${totalCount}, Loaded: ${entries.length}`);

      res.json({
        user: { username: user.username },
        entries,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasMore: offset + entries.length < totalCount
        }
      });
    } catch (error) {
      console.error('Error fetching public entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/public/:username/path/*', async (req, res) => {
    try {
      const { username } = req.params;
      const pathParts = req.params[0] ? req.params[0].split('/').filter(Boolean).map(p => decodeURIComponent(p)) : [];

      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Load all entries (path navigation needs full tree)
      // For very large datasets, consider optimizing this endpoint separately
      const allEntries = await getEntriesByUsername(username);

      // Use Maps for O(1) lookups instead of O(n) filters
      const entriesMap = new Map(allEntries.map(e => [e.id, e]));
      const entriesByParent = new Map();

      // Build parent->children map for efficient lookups
      allEntries.forEach(entry => {
        const parentId = entry.parentEntryId || 'root';
        if (!entriesByParent.has(parentId)) {
          entriesByParent.set(parentId, []);
        }
        entriesByParent.get(parentId).push(entry);
      });

      // Build path from root to target entry
      let currentEntry = null;
      const path = [];

      // Get root entries (no parent)
      const rootEntries = entriesByParent.get('root') || [];

      // Navigate through path
      for (const pathPart of pathParts) {
        // Find entry with matching slug in current level
        const candidates = currentEntry
          ? (entriesByParent.get(currentEntry.id) || [])
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

      // Get children of current entry (or root entries if at root) - use Map for O(1) lookup
      const children = currentEntry
        ? (entriesByParent.get(currentEntry.id) || [])
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

  // Privacy Policy page
  router.get('/privacy', (_req, res) => {
    try {
      const privacyPath = join(__dirname, '../public/privacy.html');
      const html = readFileSync(privacyPath, 'utf8');
      res.send(html);
    } catch (error) {
      console.error('Error serving privacy page:', error);
      res.status(500).send('Error loading privacy page');
    }
  });

  // Terms and Conditions page
  router.get('/terms-and-conditions', (_req, res) => {
    try {
      const termsPath = join(__dirname, '../public/terms-and-conditions.html');
      const html = readFileSync(termsPath, 'utf8');
      res.send(html);
    } catch (error) {
      console.error('Error serving terms page:', error);
      res.status(500).send('Error loading terms page');
    }
  });

  // Root route - redirect logged-in users to their PRIMARY (oldest) duttapad
  router.get('/', async (req, res) => {
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
                debugLog(`[ROOT] Redirecting to primary duttapad: ${primaryUser.username}`);
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
  router.get('/:username', async (req, res) => {
    try {
      // CRITICAL: Skip API routes - check path first before processing
      // Use req.originalUrl or req.url to get the full path
      const fullPath = req.originalUrl || req.url || req.path;
      if (fullPath && fullPath.startsWith('/api/')) {
        debugLog('[USER ROUTE] Blocked API route, fullPath:', fullPath);
        return res.status(404).json({ error: 'API route blocked by username route' });
      }

      const { username } = req.params;

      // Skip API routes - they should have been handled already
      if (username === 'api' || username.startsWith('api')) {
        debugLog('[USER ROUTE] Blocked API route, username:', username);
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
  router.get('/:username/*', async (req, res) => {
    try {
      const { username } = req.params;

      // Skip API routes - they should have been handled already
      // This check must come FIRST before any other processing
      if (username === 'api') {
        debugLog('[USER ROUTE] Blocked API route in nested path, username:', username);
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

  // Debug endpoint to check text_html column status
  router.get('/api/debug/text-html', async (req, res) => {
    try {
      const db = getPool();

      // Check if column exists
      const columnCheck = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'entries' AND column_name = 'text_html';
      `);

      const columnExists = columnCheck.rows.length > 0;

      // Check entries with text_html
      let entriesWithHtml = [];
      if (columnExists) {
        const result = await db.query(`
          SELECT id, text, text_html, LENGTH(text_html) as html_length
          FROM entries
          WHERE text_html IS NOT NULL AND text_html != ''
          LIMIT 10
        `);
        entriesWithHtml = result.rows.map(row => ({
          id: row.id,
          text: row.text.substring(0, 30),
          textHtml: row.text_html ? row.text_html.substring(0, 50) : null,
          htmlLength: row.html_length
        }));
      }

      res.json({
        columnExists,
        entriesWithHtmlCount: entriesWithHtml.length,
        sampleEntries: entriesWithHtml
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Diagnostic: unmatched API routes (must be last among /api handlers)
  router.use('/api/*', (req, res) => {
    debugLog('[API] Unmatched API route:', req.method, req.path);
    res.status(404).json({ error: 'API endpoint not found', path: req.path });
  });

  return router;
}
