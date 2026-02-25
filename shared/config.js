import dotenv from 'dotenv';
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
export const isDevelopment = process.env.NODE_ENV !== 'production';
export const DEBUG = process.env.DEBUG === 'true' || isDevelopment;
export const RESERVED_USERNAMES = new Set(['stats', 'privacy', 'terms-and-conditions', 'login', 'home', 'api']);

export const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
