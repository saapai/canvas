import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

import { initDatabase } from '../shared/db.js';
import { attachUser } from '../shared/auth.js';
import { isDevelopment } from '../shared/config.js';
import { createRouter } from '../shared/routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ——— Middleware ———

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting (production only for auth)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isDevelopment
});

app.use('/api/', generalLimiter);

// Serve static files (skip /api routes)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return express.static('public')(req, res, next);
});

// Database init middleware
app.use('/api/*', async (req, res, next) => {
  try { await initDatabase(); next(); }
  catch (error) { console.error('Database initialization error:', error); next(); }
});

// Auth middleware
app.use(attachUser);

// ——— Routes ———

app.use(createRouter({ authLimiter }));

// ——— Start ———

export default app;

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
