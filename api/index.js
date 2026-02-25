import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { initDatabase } from '../shared/db.js';
import { attachUser } from '../shared/auth.js';
import { createRouter } from '../shared/routes.js';

dotenv.config();

const app = express();

// ——— Middleware ———

app.use(cors());

// Custom body parsing: skip JSON parse for multipart (file uploads)
app.use(function (req, res, next) {
  const ct = (req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) return next();
  express.json()(req, res, next);
});

// Serve static files
app.use(express.static('public'));

// Database init middleware
app.use('/api/*', async (req, res, next) => {
  try { await initDatabase(); next(); }
  catch (error) { console.error('Database initialization error:', error); next(); }
});

// Auth middleware
app.use(attachUser);

// ——— Routes (no rate limiting on Vercel) ———

app.use(createRouter());

export default app;
