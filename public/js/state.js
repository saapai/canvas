// state.js — DOM references and global state variables
const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const editor = document.getElementById('editor');
const anchor = document.getElementById('anchor');
const breadcrumb = document.getElementById('breadcrumb');
const autocomplete = document.getElementById('autocomplete');
const authOverlay = document.getElementById('auth-overlay');
const authStepPhone = document.getElementById('auth-step-phone');
const authStepCode = document.getElementById('auth-step-code');
const authStepSelectUsername = document.getElementById('auth-step-select-username');
const authStepUsername = document.getElementById('auth-step-username');
const authPhoneInput = document.getElementById('auth-phone-input');
const authCodeInput = document.getElementById('auth-code-input');
const authUsernameSelect = document.getElementById('auth-username-select');
const authUsernameInput = document.getElementById('auth-username-input');
const authSendCodeBtn = document.getElementById('auth-send-code');
const authVerifyCodeBtn = document.getElementById('auth-verify-code');
const authEditPhoneBtn = document.getElementById('auth-edit-phone');
const authContinueUsernameBtn = document.getElementById('auth-continue-username');
const authSaveUsernameBtn = document.getElementById('auth-save-username');
const authError = document.getElementById('auth-error');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authCodeHint = document.getElementById('auth-code-hint');
const authCodeBoxes = document.getElementById('auth-code-boxes');
const authPhoneBoxes = document.getElementById('auth-phone-boxes');

const formatBar = document.getElementById('format-bar');
const formatFontDecrease = document.getElementById('format-font-decrease');
const formatFontIncrease = document.getElementById('format-font-increase');
const formatFontPx = document.getElementById('format-font-px');
const formatBtnBold = document.getElementById('format-bold');
const formatBtnItalic = document.getElementById('format-italic');
const formatBtnUnderline = document.getElementById('format-underline');
const formatBtnStrike = document.getElementById('format-strike');

let verifiedPhone = null;
let existingUsernames = [];

let currentUser = null;
let isReadOnly = false; // Set to true when viewing someone else's page

// Camera state
let cam = { x: 0, y: 0, z: 1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let hasZoomedToFit = false;

const anchorPos = { x: 0, y: 0 };

// Entry storage
const entries = new Map();
let entryIdCounter = 0;

// Generate user-specific entry ID to prevent overwrites
function generateEntryId() {
  if (!currentUser || !currentUser.id) {
    // Fallback to old format if no user (shouldn't happen in normal flow)
    return `entry-${entryIdCounter++}`;
  }
  // Use first 8 chars of user ID + entry counter
  const userPrefix = currentUser.id.substring(0, 8);
  return `${userPrefix}-entry-${entryIdCounter++}`;
}

// Selection state
let selectedEntries = new Set();
let isSelecting = false;
let selectionStart = null;
let selectionBox = null;

// Undo stack
const undoStack = [];
const MAX_UNDO_STACK = 50;
