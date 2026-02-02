/**
 * Global State and DOM References
 * Contains all DOM element references and global state variables
 */

// DOM Elements - Viewport and World
const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const editor = document.getElementById('editor');
const anchor = document.getElementById('anchor');
const breadcrumb = document.getElementById('breadcrumb');
const autocomplete = document.getElementById('autocomplete');

// DOM Elements - Auth
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

// Auth State
let verifiedPhone = null;
let existingUsernames = [];

// User State
let currentUser = null;
let isReadOnly = false;

// Camera State
let cam = { x: 0, y: 0, z: 1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let hasZoomedToFit = false;

// Anchor Position
const anchorPos = { x: 0, y: 0 };

// Entry Storage
const entries = new Map();
let entryIdCounter = 0;

// Selection State
let selectedEntries = new Set();
let isSelecting = false;
let selectionStart = null;
let selectionBox = null;

// Undo Stack
const undoStack = [];
const MAX_UNDO_STACK = 50;

// Navigation State
let currentViewEntryId = null;
let navigationStack = [];
let isNavigating = false;
let navigationJustCompleted = false;

// Mouse/Cursor State
let currentMousePos = { x: 0, y: 0 };
let lastClickPos = null;

// Drag State
let dragging = false;
let draggingEntry = null;
let dragOffset = { x: 0, y: 0 };
let last = { x: 0, y: 0 };
let justFinishedDragging = false;
let dragStartPositions = new Map();

// Editor State
let editorWorldPos = { x: 80, y: 80 };
let editingEntryId = null;
let isCommitting = false;
let pendingEditTimeout = null;
let hasClickedRecently = false;
let cursorPosBeforeEdit = null;
let isProcessingClick = false;

// Debounce State
let saveQueue = new Map();
let saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 500;

// Autocomplete State
let autocompleteResults = [];
let autocompleteSelectedIndex = -1;
let autocompleteSearchTimeout = null;
let autocompleteKeyboardNavigation = false;
let mediaAutocompleteEnabled = false;
let autocompleteIsShowing = false;
let isSelectingAutocomplete = false;

// Spaces State
let editingSpaceId = null;
let isCreatingNewSpace = false;

// URL Regex
const urlRegex = /(https?:\/\/[^\s]+)/gi;
