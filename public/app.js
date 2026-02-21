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

function setAnchorGreeting() {
  const pageUsername = window.PAGE_USERNAME;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const usernameFromPath = pathParts.length > 0 && pathParts[0] !== 'index.html' ? pathParts[0] : null;
  const displayUsername = pageUsername || usernameFromPath || (currentUser && currentUser.username);

  if (displayUsername) {
    anchor.textContent = `Hello, ${displayUsername}`;
  } else {
    anchor.textContent = 'Hello';
  }

  const userMenuLabel = document.getElementById('user-menu-label');
  if (userMenuLabel) {
    userMenuLabel.textContent = displayUsername || '';
  }
}

function showAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.remove('hidden');
  authError.classList.add('hidden');
  authError.textContent = '';
  if (authTitle) {
    authTitle.textContent = 'What\u2019s your phone number?';
  }
  if (authSubtitle) {
    authSubtitle.textContent = 'We\u2019ll text you a code to sign in.';
  }
  authStepPhone.classList.remove('hidden');
  authStepCode.classList.add('hidden');
  authStepSelectUsername.classList.add('hidden');
  authStepUsername.classList.add('hidden');
  // Clear phone input
  authPhoneInput.value = '';
  updatePhoneBoxes();
  authCodeInput.value = '';
  authUsernameInput.value = '';
  verifiedPhone = null;
  existingUsernames = [];
  // Focus phone input after a short delay to ensure DOM is ready
  setTimeout(() => {
    authPhoneInput.focus();
  }, 100);
}

function hideAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.add('hidden');
}

function setAuthError(message) {
  if (!authError) return;
  if (!message) {
    authError.classList.add('hidden');
    authError.textContent = '';
    return;
  }
  authError.textContent = message;
  authError.classList.remove('hidden');
}

async function handleSendCode() {
  const phoneDigits = authPhoneInput.value.replace(/\D/g, '');
  if (phoneDigits.length !== 10) {
    setAuthError('Enter a complete phone number.');
    return;
  }
  const phone = '+1' + phoneDigits;
  setAuthError('');
  authSendCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send code');
    }
    if (authTitle) {
      authTitle.textContent = 'Enter your verification code';
    }
    if (authSubtitle) {
      authSubtitle.textContent = '';
    }
    if (authCodeHint) {
      authCodeHint.textContent = `Sent SMS to ${phone}`;
    }
    authStepPhone.classList.add('hidden');
    authStepCode.classList.remove('hidden');
    authCodeInput.focus();
    updateCodeBoxes();
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authSendCodeBtn.disabled = false;
  }
}

async function handleVerifyCode() {
  const phoneDigits = authPhoneInput.value.replace(/\D/g, '');
  const phone = '+1' + phoneDigits;
  const code = authCodeInput.value.trim();
  if (phoneDigits.length !== 10 || !code) {
    setAuthError('Enter your phone and the code.');
    return;
  }
  setAuthError('');
  authVerifyCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify code');
    }
    
    // Check if there are existing usernames to select from
    if (data.existingUsernames && data.existingUsernames.length > 0) {
      verifiedPhone = data.phone;
      existingUsernames = data.existingUsernames;
      showUsernameSelection();
    } else if (data.needsUsername) {
      // No existing usernames, create new one
      currentUser = data.user;
      setAnchorGreeting();
      authStepCode.classList.add('hidden');
      authStepUsername.classList.remove('hidden');
      if (authTitle) {
        authTitle.textContent = 'Choose a name';
      }
      if (authSubtitle) {
        authSubtitle.textContent = '';
      }
      authUsernameInput.focus();
    } else {
      // User already has a username, redirect to their page
      currentUser = data.user;
      setAnchorGreeting();
      if (currentUser && currentUser.username) {
        window.location.href = `/${currentUser.username}`;
      } else {
        hideAuthOverlay();
        await loadEntriesFromServer();
      }
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authVerifyCodeBtn.disabled = false;
  }
}

function updateCodeBoxes() {
  if (!authCodeBoxes) return;
  const value = authCodeInput.value.slice(0, 6);
  const chars = value.split('');
  const boxes = authCodeBoxes.querySelectorAll('.auth-code-box');
  boxes.forEach((box, index) => {
    box.textContent = chars[index] || '';
  });
}

function updatePhoneBoxes() {
  if (!authPhoneBoxes) return;
  const value = authPhoneInput.value.replace(/\D/g, '').slice(0, 10);
  const chars = value.split('');
  const boxes = authPhoneBoxes.querySelectorAll('.auth-phone-box');
  boxes.forEach((box, index) => {
    box.textContent = chars[index] || '';
  });
}

function showUsernameSelection() {
  authStepCode.classList.add('hidden');
  authStepSelectUsername.classList.remove('hidden');
  if (authTitle) {
    authTitle.textContent = 'Select your account';
  }
  if (authSubtitle) {
    authSubtitle.textContent = '';
  }
  
  // Populate the select dropdown
  authUsernameSelect.innerHTML = '';
  existingUsernames.forEach(user => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.username;
    authUsernameSelect.appendChild(option);
  });
  
  // Add "Add new" option at the end
  const addNewOption = document.createElement('option');
  addNewOption.value = '__add_new__';
  addNewOption.textContent = '+ Add new';
  authUsernameSelect.appendChild(addNewOption);
  
  authUsernameSelect.focus();
}

async function handleContinueUsername() {
  const selectedValue = authUsernameSelect.value;
  if (!selectedValue) {
    setAuthError('Please select an account.');
    return;
  }
  
  setAuthError('');
  authContinueUsernameBtn.disabled = true;
  
  try {
    if (selectedValue === '__add_new__') {
      // User wants to create a new username
      const res = await fetch('/api/auth/create-new-user', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: verifiedPhone })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create new user');
      }
      
      currentUser = data.user;
      setAnchorGreeting();
      authStepSelectUsername.classList.add('hidden');
      authStepUsername.classList.remove('hidden');
      if (authTitle) {
        authTitle.textContent = 'Choose a name';
      }
      if (authSubtitle) {
        authSubtitle.textContent = '';
      }
      authUsernameInput.focus();
    } else {
      // User selected an existing username
      const res = await fetch('/api/auth/select-username', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedValue })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to select username');
      }
      
      currentUser = data.user;
      setAnchorGreeting();
      // Redirect to the user's page
      if (currentUser && currentUser.username) {
        window.location.href = `/${currentUser.username}`;
      } else {
        window.location.href = '/';
      }
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authContinueUsernameBtn.disabled = false;
  }
}

async function handleSaveUsername() {
  const username = authUsernameInput.value.trim();
  if (!username) {
    setAuthError('Enter a name.');
    return;
  }
  setAuthError('');
  authSaveUsernameBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/set-username', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save username');
    }
    currentUser = data.user;
    
    // Redirect to user's page (just like existing users do when they log in)
    if (currentUser && currentUser.username) {
      window.location.href = `/${currentUser.username}`;
      return;
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authSaveUsernameBtn.disabled = false;
  }
}

function initAuthUI() {
  if (!authOverlay) return;
  authSendCodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleSendCode();
  });
  authVerifyCodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleVerifyCode();
  });
  authSaveUsernameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleSaveUsername();
  });
  authContinueUsernameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleContinueUsername();
  });
  authEditPhoneBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthError('');
    authStepCode.classList.add('hidden');
    authStepPhone.classList.remove('hidden');
    authCodeInput.value = '';
    updateCodeBoxes();
    authPhoneInput.focus();
  });
  authCodeBoxes.addEventListener('click', () => {
    authCodeInput.focus();
  });
  authCodeInput.addEventListener('input', (e) => {
    const currentVal = e.target.value;
    // Extract only digits
    const digits = currentVal.replace(/\D/g, '');
    // Limit to max length
    const maxLen = 6;
    const newVal = digits.slice(0, maxLen);
    
    if (currentVal !== newVal) {
      e.target.value = newVal;
    }
    
    // Always place cursor at end
    e.target.setSelectionRange(newVal.length, newVal.length);
    
    // Update visual boxes
    updateCodeBoxes();
  });
  authCodeInput.addEventListener('keydown', (e) => {
    // Backspace/Delete: remove last character
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const currentVal = e.target.value;
      if (currentVal.length > 0) {
        e.target.value = currentVal.slice(0, -1);
        updateCodeBoxes();
      }
      return;
    }
    // Prevent arrow keys, Home, End, Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
      e.preventDefault();
      return;
    }
  });
  authPhoneBoxes.addEventListener('click', () => {
    authPhoneInput.focus();
  });
  authPhoneInput.addEventListener('input', (e) => {
    const currentVal = e.target.value;
    // Extract only digits
    const digits = currentVal.replace(/\D/g, '');
    // Limit to max length
    const maxLen = 10;
    const newVal = digits.slice(0, maxLen);
    
    if (currentVal !== newVal) {
      e.target.value = newVal;
    }
    
    // Always place cursor at end
    e.target.setSelectionRange(newVal.length, newVal.length);
    
    // Update visual boxes
    updatePhoneBoxes();
  });
  authPhoneInput.addEventListener('keydown', (e) => {
    // Backspace/Delete: remove last character
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const currentVal = e.target.value;
      if (currentVal.length > 0) {
        e.target.value = currentVal.slice(0, -1);
        updatePhoneBoxes();
      }
      return;
    }
    // Prevent arrow keys, Home, End, Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
      e.preventDefault();
      return;
    }
  });
  authPhoneInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    // Remove all non-digits and limit to 10
    const digits = paste.replace(/\D/g, '').slice(0, 10);
    authPhoneInput.value = digits;
    updatePhoneBoxes();
    // Move cursor to end after paste
    authPhoneInput.setSelectionRange(digits.length, digits.length);
  });
}

async function bootstrap() {
  // Check if we're on a user page FIRST, before anything else runs
  const pageUsername = window.PAGE_USERNAME;
  const isOwner = window.PAGE_IS_OWNER === true;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const isUserPage = !!pageUsername || (pathParts.length > 0 && pathParts[0] !== 'index.html' && pathParts[0] !== '');
  const isLoginPage = window.SHOW_LOGIN_PAGE === true;
  
  // CRITICAL: Hide auth overlay IMMEDIATELY if on a user page - do this BEFORE initAuthUI
  if (isUserPage && authOverlay) {
    authOverlay.classList.add('hidden');
    authOverlay.style.display = 'none'; // Force hide with inline style
  }
  
  // Only initialize auth UI if NOT on a user page
  if (!isUserPage) {
    initAuthUI();
  }
  
  // If on login page, show auth overlay immediately
  if (isLoginPage && !isUserPage) {
    showAuthOverlay();
  }
  
  setAnchorGreeting();
  
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    let isLoggedIn = false;
    
    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      setAnchorGreeting();
      isLoggedIn = true;
      
      // If on root and logged in, redirect to their page
      if (!isUserPage && user.username) {
        window.location.href = `/${user.username}`;
        return;
      }
    }
    
    // If on a user page, load entries (editable if owner, read-only otherwise)
    if (isUserPage) {
      const targetUsername = pageUsername || pathParts[0];
      // Only editable if logged in AND is the owner
      const editable = isLoggedIn && isOwner;
      await loadUserEntries(targetUsername, editable);
      // Ensure auth overlay stays hidden
      hideAuthOverlay();
      // Load saved background image
      if (window._loadBgAfterAuth) window._loadBgAfterAuth();
    } else {
      // On root page only - show auth if needed
      if (!isLoggedIn) {
        // Not logged in - show auth to log in
        showAuthOverlay();
      } else if (isLoggedIn && !currentUser?.username) {
        // Logged in but no username yet - show auth to set username
        showAuthOverlay();
      } else {
        // Logged in with username - should have redirected, but hide auth just in case
        hideAuthOverlay();
      }
    }
  } catch (error) {
    console.error('Error checking auth:', error);
    if (isUserPage) {
      // On user page - load public entries (read-only) even if auth check fails
      const targetUsername = pageUsername || pathParts[0];
      await loadUserEntries(targetUsername, false);
      // Ensure auth overlay stays hidden
      hideAuthOverlay();
    } else {
      // On root - show auth
      showAuthOverlay();
    }
  }
}

async function loadUserEntries(username, editable) {
  try {
    // Load entries with pagination - start with first 1000, then load more if needed
    let allEntries = [];
    let page = 1;
    const limit = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const response = await fetch(`/api/public/${username}/entries?page=${page}&limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to load entries');
      }
      
      const data = await response.json();
      
      // Handle both old format (entries array) and new format (object with pagination)
      let pageEntries = [];
      if (Array.isArray(data)) {
        // Backward compatibility: old format returns array directly
        pageEntries = data;
        hasMore = false;
      } else if (data.entries && Array.isArray(data.entries)) {
        // New format with pagination
        pageEntries = data.entries;
        hasMore = data.pagination?.hasMore || false;
        page++;
        
        // Safety limit: don't load more than 10,000 entries at once
        if (allEntries.length + pageEntries.length >= 10000) {
          console.warn('[LOAD] Reached safety limit of 10,000 entries');
          hasMore = false;
        }
      } else {
        // Fallback: try to extract entries from response
        pageEntries = data.entries || [];
        hasMore = false;
      }
      
      allEntries = allEntries.concat(pageEntries);
    }
    
    const entriesData = allEntries;
    
    console.log(`[LOAD] Fetched ${entriesData.length} entries for ${username}`);
    
    // Log entry hierarchy for debugging
    const rootEntries = entriesData.filter(e => !e.parentEntryId);
    const childEntries = entriesData.filter(e => e.parentEntryId);
    console.log(`[LOAD] Root entries: ${rootEntries.length}, Child entries: ${childEntries.length}`);
    
    // Check for entries with textHtml
    const entriesWithHtml = entriesData.filter(e => e.textHtml);
    console.log(`[LOAD] Entries with textHtml: ${entriesWithHtml.length}`);
    if (entriesWithHtml.length > 0) {
      console.log('[LOAD] Sample entry with textHtml:', {
        id: entriesWithHtml[0].id,
        textHtmlLength: entriesWithHtml[0].textHtml?.length,
        textHtmlSample: entriesWithHtml[0].textHtml?.substring(0, 100)
      });
    }
    
    console.log('[LOAD] Root entries:', rootEntries.map(e => ({ id: e.id, text: e.text.substring(0, 30) })));
    console.log('[LOAD] Child entries:', childEntries.map(e => ({ id: e.id, parent: e.parentEntryId, text: e.text.substring(0, 30) })));
    
    // Find the highest entry ID counter
    let maxCounter = 0;
    entriesData.forEach(entry => {
      // Match both formats: "entry-N" and "xxxxxxxx-entry-N"
      const match = entry.id.match(/entry-(\d+)$/);
      if (match) {
        const counter = parseInt(match[1], 10);
        if (counter > maxCounter) {
          maxCounter = counter;
        }
      }
    });
    entryIdCounter = maxCounter + 1;
    
    // Clear existing entries
    entries.clear();
    const existingEntries = world.querySelectorAll('.entry');
    existingEntries.forEach(entry => entry.remove());
    
    // Create entry elements and add to map
    const fragment = document.createDocumentFragment();
    const entriesToMeasure = [];
    entriesData.forEach(entryData => {
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.id = entryData.id;

      entry.style.left = `${entryData.position.x}px`;
      entry.style.top = `${entryData.position.y}px`;

      // Initially hide all entries - visibility will be set after navigation state is determined
      entry.style.display = 'none';

      // Process text with links (skip for image-only, file, and research entries)
      const isResearchCard = entryData.mediaCardData && entryData.mediaCardData.researchCardType;
      const isImageOnly = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
      const isFileEntry = entryData.mediaCardData && entryData.mediaCardData.type === 'file';
      if (isResearchCard) {
        // Research card entry: render with appropriate card renderer
        const tempData = { ...entryData, element: entry };
        renderResearchCard(entry, tempData);
      } else if (isImageOnly) {
        entry.classList.add('canvas-image');
        entry.innerHTML = '';
        const img = document.createElement('img');
        const fullUrl = entryData.mediaCardData.url;
        img.src = getThumbUrl(fullUrl);
        img.dataset.fullSrc = fullUrl;
        img.alt = 'Canvas image';
        img.draggable = false;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function() { if (this.src !== fullUrl) this.src = fullUrl; };
        entry.appendChild(img);
      } else if (isFileEntry) {
        entry.classList.add('canvas-file');
        entry.innerHTML = '';
        entry.appendChild(createFileCard(entryData.mediaCardData));
      } else if (entryData.latexData && entryData.latexData.enabled) {
        // LaTeX entries: render via KaTeX
        renderLatex(entryData.latexData.source, entry);
      } else {
        const { processedText, urls } = processTextWithLinks(entryData.text);
        if (entryData.textHtml && entryData.textHtml.includes('deadline-table')) {
          entry.innerHTML = entryData.textHtml;
          const dt = entry.querySelector('.deadline-table');
          if (dt) setupDeadlineTableHandlers(dt);
        } else if (entryData.textHtml && entryData.textHtml.includes('gcal-card')) {
          entry.innerHTML = entryData.textHtml;
          const card = entry.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        } else if (processedText) {
          if (entryData.textHtml && /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(entryData.textHtml)) {
            entry.innerHTML = meltifyHtml(entryData.textHtml);
            applyEntryFontSize(entry, entryData.textHtml);
          } else {
            entry.innerHTML = meltify(processedText);
          }
        } else {
          entry.innerHTML = '';
        }
        if (urls.length > 0) {
          const cachedLinkCardsData = entryData.linkCardsData || [];
          urls.forEach((url, index) => {
            const cachedCardData = cachedLinkCardsData[index];
            if (cachedCardData) {
              // Show cached card immediately — no loading state
              const card = createLinkCard(cachedCardData);
              entry.appendChild(card);
              updateEntryWidthForLinkCard(entry, card);
              // Quietly refresh in the background; only update DOM + server if something changed
              generateLinkCard(url).then(freshCardData => {
                if (!freshCardData) return;
                const changed = freshCardData.title !== cachedCardData.title ||
                                freshCardData.image !== cachedCardData.image ||
                                freshCardData.description !== cachedCardData.description;
                if (changed) {
                  const freshCard = createLinkCard(freshCardData);
                  card.replaceWith(freshCard);
                  updateEntryWidthForLinkCard(entry, freshCard);
                  storedEntryData.linkCardsData[index] = freshCardData;
                  updateEntryOnServer(storedEntryData);
                }
              });
            } else {
              // No cached data — fetch silently, no placeholder shown
              generateLinkCard(url).then(cardData => {
                if (!cardData) return;
                const card = createLinkCard(cardData);
                entry.appendChild(card);
                updateEntryWidthForLinkCard(entry, card);
                if (!storedEntryData.linkCardsData) storedEntryData.linkCardsData = [];
                storedEntryData.linkCardsData[index] = cardData;
                updateEntryOnServer(storedEntryData);
                setTimeout(() => updateEntryDimensions(entry), 100);
              });
            }
          });
        }
      }
      
      if (!editable) {
        entry.style.cursor = 'pointer';
      }

      fragment.appendChild(entry);
      entriesToMeasure.push(entry);

      const storedEntryData = {
        id: entryData.id,
        element: entry,
        text: entryData.text,
        textHtml: entryData.textHtml,
        latexData: entryData.latexData || null,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId,
        linkCardsData: entryData.linkCardsData || [],
        mediaCardData: entryData.mediaCardData || null
      };
      entries.set(entryData.id, storedEntryData);
      
      if (!isImageOnly && !isFileEntry && !isResearchCard && entryData.mediaCardData && entryData.mediaCardData.type !== 'image') {
        const card = createMediaCard(entryData.mediaCardData);
        entry.appendChild(card);
        setTimeout(() => updateEntryDimensions(entry), 100);
      }
    });
    // Batch-insert all entries in one DOM operation, then measure dimensions
    world.appendChild(fragment);
    for (const entry of entriesToMeasure) updateEntryDimensions(entry);

    // Refresh deadline display dates (relative labels like "Today" / "Tomorrow")
    refreshAllDeadlineDates();

    // Set read-only mode
    isReadOnly = !editable;
    const dz = document.getElementById('drop-zone');
    if (dz) dz.style.display = isReadOnly ? 'none' : '';
    const orgBtn = document.getElementById('organize-button');
    if (orgBtn) orgBtn.style.display = isReadOnly ? 'none' : '';

    // Search button removed - using autocomplete instead
    
    // Check if we need to navigate to a specific path based on URL
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length > 1 && pathParts[0] === username) {
      // We have a path to navigate to
      const slugPath = pathParts.slice(1); // Remove username
      let currentParent = null;
      navigationStack = [];
      
      // Walk through the path to find the target entry
      for (const slug of slugPath) {
        const children = Array.from(entries.values()).filter(e => e.parentEntryId === currentParent);
        const targetEntry = children.find(e => {
          // Pass full entry data to generateEntrySlug to handle media cards
          const entrySlug = generateEntrySlug(e.text, e);
          return entrySlug === slug;
        });
        
        if (targetEntry) {
          navigationStack.push(targetEntry.id);
          currentParent = targetEntry.id;
        } else {
          // Entry not found in path - could be an empty subdirectory
          // Keep the navigation stack as is (may be empty)
          break;
        }
      }
      
      if (navigationStack.length > 0) {
        currentViewEntryId = navigationStack[navigationStack.length - 1];
      } else {
        currentViewEntryId = null;
      }
    } else {
      // Start at root
      currentViewEntryId = null;
      navigationStack = [];
    }
    
    // Always update breadcrumb (will show even for empty subdirectories)
    updateBreadcrumb();
    updateEntryVisibility();
    
    // Recalculate dimensions for all existing entries to fix old fixed-width entries
    setTimeout(() => {
      entriesData.forEach(entryData => {
        const entry = document.getElementById(entryData.id);
        if (entry) {
          updateEntryDimensions(entry);
        }
      });
    }, 100);
    
    // Zoom to fit all entries on initial load only
    if (!hasZoomedToFit) {
      hasZoomedToFit = true;
      // Wait for link cards to load and dimension recalculation, then fit
      setTimeout(() => {
        requestAnimationFrame(() => {
          zoomToFitEntries();
        });
      }, 600);
    }
    
    if (isReadOnly) {
      hideCursor();
      // Keep pan/zoom but disable editing
      viewport.style.cursor = 'grab';
      
      // Disable all entry interactions except navigation
      entriesData.forEach(entryData => {
        const entry = document.getElementById(entryData.id);
        if (entry) {
          entry.style.pointerEvents = 'auto'; // Allow clicks for navigation
          entry.style.cursor = 'pointer'; // Show pointer for clickable entries
          // Remove any hover effects by preventing CSS hover states
          entry.classList.add('read-only');
        }
      });
    }
  } catch (error) {
    console.error('Error loading user entries:', error);
  }
}

// Persistence functions
function handleAuthFailure(response) {
  if (response.status === 401) {
    console.error('[Auth] Authentication required - edits will not persist.');
    isReadOnly = true;
    if (typeof showAuthOverlay === 'function') {
      showAuthOverlay();
    }
  }
}

// Debounce queue for entry saves
let saveQueue = new Map();
let saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 500;

function flushSaveQueue() {
  if (saveQueue.size === 0) return;
  
  const entriesToSave = Array.from(saveQueue.values());
  saveQueue.clear();
  
  // Use batch endpoint for multiple entries, individual for single
  if (entriesToSave.length === 1) {
    saveEntryImmediate(entriesToSave[0]);
  } else {
    saveEntriesBatch(entriesToSave);
  }
}

async function saveEntriesBatch(entriesToSave) {
  if (isReadOnly) {
    console.warn('[SAVE] Cannot save entries: read-only mode');
    return null;
  }
  
  try {
    const response = await fetch('/api/entries/batch', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        entries: entriesToSave
          .filter(entryData => entryData.position && entryData.position.x != null && entryData.position.y != null)
          .map(entryData => ({
            id: entryData.id,
            text: entryData.text,
            textHtml: entryData.textHtml || null,
            position: entryData.position,
            parentEntryId: entryData.parentEntryId,
            linkCardsData: entryData.linkCardsData || null,
            mediaCardData: entryData.mediaCardData || null,
            latexData: entryData.latexData || null
          })),
        pageOwnerId: window.PAGE_OWNER_ID
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[SAVE] Batch save failed:', response.status, errorData);
      handleAuthFailure(response);
      throw new Error(errorData.error || 'Failed to save entries');
    }
    
    return await response.json();
  } catch (error) {
    console.error('[SAVE] Error saving entries batch:', error);
    return null;
  }
}

async function saveEntryImmediate(entryData) {
  if (isReadOnly) {
    console.warn('[SAVE] Cannot save entry: read-only mode');
    return null;
  }
  
  const payload = {
    id: entryData.id,
    text: entryData.text,
    textHtml: entryData.textHtml || null,
    position: entryData.position,
    parentEntryId: entryData.parentEntryId,
    linkCardsData: entryData.linkCardsData || null,
    mediaCardData: entryData.mediaCardData || null,
    latexData: entryData.latexData || null,
    pageOwnerId: window.PAGE_OWNER_ID
  };

  try {
    const response = await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[SAVE] Save failed:', response.status, errorData);
      handleAuthFailure(response);
      throw new Error(errorData.error || 'Failed to save entry');
    }
    
    return await response.json();
  } catch (error) {
    console.error('[SAVE] Error saving entry to server:', error);
    return null;
  }
}

async function saveEntryToServer(entryData) {
  // Add to debounce queue
  saveQueue.set(entryData.id, entryData);
  
  // Clear existing timer
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  
  // Set new timer
  saveDebounceTimer = setTimeout(() => {
    flushSaveQueue();
    saveDebounceTimer = null;
  }, SAVE_DEBOUNCE_MS);
  
  // Return immediately (optimistic update)
  return { id: entryData.id };
}

async function updateEntryOnServer(entryData) {
  if (isReadOnly) {
    console.warn('Cannot update entry: read-only mode');
    return null;
  }
  
  const payload = {
    text: entryData.text,
    textHtml: entryData.textHtml || null, // Include HTML formatting
    position: entryData.position,
    parentEntryId: entryData.parentEntryId,
    linkCardsData: entryData.linkCardsData || null,
    mediaCardData: entryData.mediaCardData || null,
    latexData: entryData.latexData || null,
    pageOwnerId: window.PAGE_OWNER_ID // Include page owner's user ID
  };

  console.log('[UPDATE] updateEntryOnServer called for:', entryData.id, 'textHtml:', payload.textHtml ? payload.textHtml.substring(0, 100) : 'null');
  
  try {
    const response = await fetch(`/api/entries/${entryData.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Failed to update entry:', response.status, errorText);
      handleAuthFailure(response);
      throw new Error('Failed to update entry');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error updating entry on server:', error);
    return null;
  }
}

function countChildEntries(entryId) {
  return Array.from(entries.values()).filter(e => e.parentEntryId === entryId).length;
}

function showDeleteConfirmation(entryId, childCount) {
  return new Promise((resolve) => {
    const modal = document.getElementById('delete-confirm-modal');
    const message = document.getElementById('delete-confirm-message');
    const childCountEl = document.getElementById('delete-child-count');
    const cancelBtn = document.getElementById('delete-confirm-cancel');
    const deleteBtn = document.getElementById('delete-confirm-delete');

    if (childCount === 0) {
      message.textContent = entryId ? 'Are you sure you want to delete this entry?' : 'Are you sure you want to delete the selected entries?';
      childCountEl.textContent = '';
    } else {
      if (entryId) {
      message.innerHTML = `This entry has <strong id="delete-child-count">${childCount}</strong> child ${childCount === 1 ? 'entry' : 'entries'} that will also be deleted.`;
      } else {
        message.innerHTML = `The selected entries have <strong id="delete-child-count">${childCount}</strong> child ${childCount === 1 ? 'entry' : 'entries'} that will also be deleted.`;
      }
      childCountEl.textContent = childCount;
    }

    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      deleteBtn.removeEventListener('click', onDelete);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onDelete = () => {
      cleanup();
      resolve(true);
    };

    cancelBtn.addEventListener('click', onCancel);
    deleteBtn.addEventListener('click', onDelete);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        onCancel();
      }
    });
  });
}

async function deleteEntryFromServer(entryId) {
  if (isReadOnly) {
    console.warn('Cannot delete entry: read-only mode');
    return false;
  }
  
  try {
    const pageOwnerId = window.PAGE_OWNER_ID;
    const url = pageOwnerId ? `/api/entries/${entryId}?pageOwnerId=${encodeURIComponent(pageOwnerId)}` : `/api/entries/${entryId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Failed to delete entry:', response.status, errorText);
      handleAuthFailure(response);
      throw new Error('Failed to delete entry');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting entry from server:', error);
    return false;
  }
}

async function deleteEntryWithConfirmation(entryId, skipConfirmation = false, skipUndo = false) {
  const entryData = entries.get(entryId);
  if (!entryData) return false;

  // Count ALL descendants (not just direct children)
  function collectAllDescendants(parentId) {
    const result = [];
    const children = Array.from(entries.values()).filter(e => e.parentEntryId === parentId);
    for (const child of children) {
      result.push(child);
      result.push(...collectAllDescendants(child.id));
    }
    return result;
  }

  const allDescendants = collectAllDescendants(entryId);

  // If has descendants and not skipping confirmation, ask user
  if (allDescendants.length > 0 && !skipConfirmation) {
    const confirmed = await showDeleteConfirmation(entryId, allDescendants.length);
    if (!confirmed) return false;
  }

  // Collect all entries for undo (parent + descendants)
  if (!skipUndo) {
    const entriesToDelete = [entryData, ...allDescendants].map(e => ({
      id: e.id,
      text: e.text,
      position: e.position,
      parentEntryId: e.parentEntryId,
      mediaCardData: e.mediaCardData,
      linkCardsData: e.linkCardsData
    }));
    saveUndoState('delete', { entries: entriesToDelete });
  }

  // Delete all descendants first (from DOM, Map, and server)
  for (const desc of allDescendants) {
    desc.element.classList.remove('editing', 'deadline-editing');
    desc.element.remove();
    entries.delete(desc.id);
    await deleteEntryFromServer(desc.id);
  }

  // Delete the parent entry
  entryData.element.classList.remove('editing', 'deadline-editing');
  entryData.element.remove();
  entries.delete(entryId);
  await deleteEntryFromServer(entryId);
  return true;
}

async function loadEntriesFromServer() {
  try {
    // Load entries with pagination - start with first 1000, then load more if needed
    let allEntries = [];
    let page = 1;
    const limit = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const response = await fetch(`/api/entries?page=${page}&limit=${limit}`, { 
        credentials: 'include' 
      });
      
      if (!response.ok) {
        throw new Error('Failed to load entries');
      }
      
      const data = await response.json();
      
      // Handle both old format (array) and new format (object with pagination)
      if (Array.isArray(data)) {
        // Backward compatibility: old format returns array directly
        allEntries = data;
        hasMore = false;
      } else if (data.entries && Array.isArray(data.entries)) {
        // New format with pagination
        allEntries = allEntries.concat(data.entries);
        hasMore = data.pagination?.hasMore || false;
        page++;
        
        // Safety limit: don't load more than 10,000 entries at once
        if (allEntries.length >= 10000) {
          console.warn('[LOAD] Reached safety limit of 10,000 entries');
          hasMore = false;
        }
      } else {
        throw new Error('Unexpected response format');
      }
    }
    
    const entriesData = allEntries;
    
    // Find the highest entry ID counter
    let maxCounter = 0;
    entriesData.forEach(entry => {
      // Match both formats: "entry-N" and "xxxxxxxx-entry-N"
      const match = entry.id.match(/entry-(\d+)$/);
      if (match) {
        const counter = parseInt(match[1], 10);
        if (counter > maxCounter) {
          maxCounter = counter;
        }
      }
    });
    entryIdCounter = maxCounter + 1;
    
    // Clear existing entries
    entries.clear();
    const existingEntries = world.querySelectorAll('.entry');
    existingEntries.forEach(entry => entry.remove());
    
    // Create entry elements and add to map
    entriesData.forEach(entryData => {
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.id = entryData.id;
      
      entry.style.left = `${entryData.position.x}px`;
      entry.style.top = `${entryData.position.y}px`;
      
      // Process text with links
      const { processedText, urls } = processTextWithLinks(entryData.text);

      // Research card entries: render with appropriate card renderer
      if (entryData.mediaCardData && entryData.mediaCardData.researchCardType) {
        const tempData = { ...entryData, element: entry };
        renderResearchCard(entry, tempData);
      // LaTeX entries: render via KaTeX
      } else if (entryData.latexData && entryData.latexData.enabled) {
        renderLatex(entryData.latexData.source, entry);
      } else if (entryData.textHtml && entryData.textHtml.includes('deadline-table')) {
        entry.innerHTML = entryData.textHtml;
        const dt = entry.querySelector('.deadline-table');
        if (dt) setupDeadlineTableHandlers(dt);
      } else if (entryData.textHtml && entryData.textHtml.includes('gcal-card')) {
        entry.innerHTML = entryData.textHtml;
        const card = entry.querySelector('.gcal-card');
        if (card) setupCalendarCardHandlers(card);
      } else if (processedText) {
        if (entryData.textHtml && /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(entryData.textHtml)) {
          // Has formatting, use HTML version
          entry.innerHTML = meltifyHtml(entryData.textHtml);
          applyEntryFontSize(entry, entryData.textHtml);
        } else {
          // No formatting, use regular meltify
          entry.innerHTML = meltify(processedText);
        }
      } else {
        entry.innerHTML = '';
      }

      world.appendChild(entry);

      // Update entry dimensions based on actual content after rendering
      updateEntryDimensions(entry);

      // Store entry data
      const storedEntryData = {
        id: entryData.id,
        element: entry,
        text: entryData.text,
        textHtml: entryData.textHtml, // Preserve HTML formatting
        latexData: entryData.latexData || null,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId,
        mediaCardData: entryData.mediaCardData || null
      };
      entries.set(entryData.id, storedEntryData);

      // Generate link cards if URLs exist
      if (urls.length > 0) {
        urls.forEach(async (url) => {
          const cardData = await generateLinkCard(url);
          if (cardData) {
            const card = createLinkCard(cardData);
            entry.appendChild(card);
            updateEntryWidthForLinkCard(entry, card);
          }
        });
      }
    });

    // Refresh deadline display dates (relative labels like "Today" / "Tomorrow")
    refreshAllDeadlineDates();

    // Update visibility after loading
    updateEntryVisibility();

    // Zoom to fit all entries on initial load only
    if (!hasZoomedToFit) {
      hasZoomedToFit = true;
      // Wait for link cards to load and then fit
      setTimeout(() => {
        requestAnimationFrame(() => {
          zoomToFitEntries();
        });
      }, 500);
    }
    
    return entriesData;
  } catch (error) {
    console.error('Error loading entries from server:', error);
    return [];
  }
}

// Navigation state
let currentViewEntryId = null;
let navigationStack = [];
let isNavigating = false;
let navigationJustCompleted = false;

// Track mouse position for typing without clicking
let currentMousePos = { x: 0, y: 0 };
let lastClickPos = null; // Track last click position for typing

// Drag-to-pan
let dragging = false;
let draggingEntry = null;
let dragOffset = { x: 0, y: 0 };
let last = { x: 0, y: 0 };
let justFinishedDragging = false;
let dragStartPositions = new Map(); // Track initial positions for undo

// Where the editor is placed in WORLD coordinates
let editorWorldPos = { x: 80, y: 80 };
let editingEntryId = null;
let isCommitting = false;
let pendingEditTimeout = null; // Track pending edit to allow double-click detection
let hasClickedRecently = false; // Track if user clicked somewhere (so we don't use hover position)
let cursorPosBeforeEdit = null; // Store cursor position before entering edit mode
let isProcessingClick = false; // Flag to prevent cursor updates during click handling

function applyTransform(){
  world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.z})`;
  world.style.transformOrigin = '0 0';
}
applyTransform();

function screenToWorld(sx, sy){
  return {
    x: (sx - cam.x) / cam.z,
    y: (sy - cam.y) / cam.z
  };
}

function worldToScreen(wx, wy){
  return {
    x: wx * cam.z + cam.x,
    y: wy * cam.z + cam.y
  };
}

function centerAnchor(){
  const viewportRect = viewport.getBoundingClientRect();
  const centerX = viewportRect.width / 2;
  const centerY = viewportRect.height / 2;
  
  const worldCenter = screenToWorld(centerX, centerY);
  
  const textRect = anchor.getBoundingClientRect();
  const worldTextRect = {
    width: textRect.width / cam.z,
    height: textRect.height / cam.z
  };
  
  anchorPos.x = worldCenter.x - worldTextRect.width / 2;
  anchorPos.y = worldCenter.y - worldTextRect.height / 2;
  
  anchor.style.left = `${anchorPos.x}px`;
  anchor.style.top = `${anchorPos.y}px`;
}

function zoomToFitEntries() {
  const visibleEntries = Array.from(entries.values()).filter(entryData => {
    const element = entryData.element;
    if (!element) return false;
    // Only include root entries (those without parent or those visible in current view)
    if (currentViewEntryId === null) {
      // Root view - include only root entries
      return !entryData.parentEntryId && element.style.display !== 'none';
    } else {
      // Subdirectory view - include entries visible in current navigation
      return element.style.display !== 'none';
    }
  });

  if (visibleEntries.length === 0) {
    // No entries to fit - center anchor and show cursor
    centerAnchor();
    
    // Always show cursor after navigation or initial load when there are no entries
    if (!isReadOnly) {
      setTimeout(() => {
        if (navigationJustCompleted) {
          navigationJustCompleted = false;
        }
        showCursorInDefaultPosition();
      }, 100);
    }
    return;
  }

  // Calculate bounding box of all visible entries in world coordinates
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  visibleEntries.forEach(entryData => {
    const element = entryData.element;
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    const worldWidth = rect.width / cam.z;
    const worldHeight = rect.height / cam.z;

    minX = Math.min(minX, worldX);
    minY = Math.min(minY, worldY);
    maxX = Math.max(maxX, worldX + worldWidth);
    maxY = Math.max(maxY, worldY + worldHeight);
  });
  
  // On home page, include anchor in bounding box
  // Use stored anchorPos instead of recalculating from style to prevent drift
  if (currentViewEntryId === null && anchor) {
    const anchorWorldX = anchorPos.x;
    const anchorWorldY = anchorPos.y;
    // Get dimensions in world coordinates (accounting for current zoom)
    const anchorRect = anchor.getBoundingClientRect();
    const anchorWorldWidth = anchorRect.width / cam.z;
    const anchorWorldHeight = anchorRect.height / cam.z;
    
    minX = Math.min(minX, anchorWorldX);
    minY = Math.min(minY, anchorWorldY);
    maxX = Math.max(maxX, anchorWorldX + anchorWorldWidth);
    maxY = Math.max(maxY, anchorWorldY + anchorWorldHeight);
  }

  // Add padding around entries
  const padding = 80;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  // Get viewport dimensions
  const viewportRect = viewport.getBoundingClientRect();
  const viewportWidth = viewportRect.width;
  const viewportHeight = viewportRect.height;

  // Calculate zoom to fit content
  const scaleX = viewportWidth / contentWidth;
  const scaleY = viewportHeight / contentHeight;
  const newZoom = Math.min(scaleX, scaleY, 2.0); // Cap zoom at 2x to avoid too much zoom in
  // Zoom out to add breathing room - 1.25x for spacing (0.8x of previous 1.56x)
  const zoomWithPadding = newZoom / 1.25;
  const clampedZoom = clamp(zoomWithPadding, 0.12, 2.0);
  
  // Never zoom in - only zoom out or stay at current zoom
  const finalZoom = Math.min(clampedZoom, cam.z);
  
  // Calculate target camera position
  const screenCenterX = viewportWidth / 2;
  const screenCenterY = viewportHeight / 2;
  
  // If there's only one entry, add slight offset to keep it off-center
  // Otherwise, center normally
  let offsetX = 0;
  let offsetY = 0;
  if (visibleEntries.length === 1) {
    // Offset by 10% of viewport size for single entry
    offsetX = viewportWidth * 0.1;
    offsetY = viewportHeight * 0.1;
  }
  
  const targetX = screenCenterX - contentCenterX * finalZoom + offsetX;
  const targetY = screenCenterY - contentCenterY * finalZoom + offsetY;
  
  // If zoom doesn't change and position is already correct, still show cursor after traversal
  const zoomChanged = Math.abs(finalZoom - cam.z) > 0.001;
  const positionChanged = Math.abs(targetX - cam.x) > 1 || Math.abs(targetY - cam.y) > 1;
  const needsAnimation = zoomChanged || positionChanged;
  
  console.log('[ZOOM] needsAnimation:', needsAnimation, 'zoomChanged:', zoomChanged, 'positionChanged:', positionChanged, 'navigationJustCompleted:', navigationJustCompleted);

  // Store starting values for animation
  const startX = cam.x;
  const startY = cam.y;
  const startZ = cam.z;
  
  // Target values
  const targetZ = finalZoom;
  
  // Animation parameters
  const duration = 800; // milliseconds
  const startTime = performance.now();
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Use ease-out easing for smooth deceleration
    const easeOut = 1 - Math.pow(1 - progress, 3);
    
    // Interpolate camera values
    cam.x = startX + (targetX - startX) * easeOut;
    cam.y = startY + (targetY - startY) * easeOut;
    cam.z = startZ + (targetZ - startZ) * easeOut;
    
    applyTransform();
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation completed - clear navigation flags to allow clicking
      // This happens after ~800ms, allowing immediate interaction after zoom
      const wasNavigating = navigationJustCompleted;
      if (navigationJustCompleted) {
        navigationJustCompleted = false;
      }
      // Clear isNavigating flag immediately so user can interact
      isNavigating = false;
      
      // Always show cursor after animation completes (whether from navigation or initial load)
      if (!isReadOnly) {
        // Show cursor immediately and also with delay as fallback
        console.log('[ZOOM] Animation completed, showing cursor immediately. wasNavigating:', wasNavigating);
        // Immediate attempt
        requestAnimationFrame(() => {
          showCursorInDefaultPosition();
        });
        // Delayed attempt to ensure entries are dimensioned
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              console.log('[ZOOM] Fallback cursor display after delay');
              showCursorInDefaultPosition();
            });
          });
        }, 200); // Fallback delay
      }
    }
  }
  
  if (needsAnimation) {
    console.log('[ZOOM] Starting animation');
    requestAnimationFrame(animate);
  } else {
    // No animation needed, but still show cursor after traversal
    console.log('[ZOOM] No animation needed, showing cursor immediately');
    if (navigationJustCompleted) {
      navigationJustCompleted = false;
    }
    // Clear isNavigating flag immediately so user can interact
    isNavigating = false;
    
    if (!isReadOnly) {
      // Show cursor immediately and with delay as fallback
      console.log('[ZOOM] Showing cursor (no animation path)');
      // Immediate attempt
      requestAnimationFrame(() => {
        showCursorInDefaultPosition();
      });
      // Delayed attempt to ensure entries are dimensioned
      setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            console.log('[ZOOM] Fallback cursor display (no animation path)');
            showCursorInDefaultPosition();
          });
        });
      }, 300); // Fallback delay
    }
  }
}

// Check if a duplicate entry exists at the current directory level
function findDuplicateEntry(text, parentEntryId, excludeEntryId = null) {
  const normalizedText = text.trim().toLowerCase();
  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;
    if (entryId === excludeEntryId) continue; // Exclude the entry being edited
    if (!entryData || !entryData.text) continue;
    
    // Check if same parent directory level
    const entryParent = entryData.parentEntryId ?? null;
    if (entryParent !== parentEntryId) continue;
    
    // Check if text matches (case-insensitive)
    if (entryData.text.trim().toLowerCase() === normalizedText) {
      return entryId;
    }
  }
  return null;
}

function updateEntryVisibility() {
  let visibleCount = 0;
  let hiddenCount = 0;
  
  // Show anchor only on home page (when currentViewEntryId is null)
  if (anchor) {
    if (currentViewEntryId === null) {
      anchor.style.display = '';
    } else {
      anchor.style.display = 'none';
    }
  }
  
  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return; // Skip anchor in entries loop
    
    // Ensure entryData and element exist
    if (!entryData || !entryData.element) {
      console.warn(`Missing entry data or element for: ${entryId}`);
      return;
    }
    
    // Ensure entry is in the DOM (restore if missing)
    if (!entryData.element.parentElement) {
      world.appendChild(entryData.element);
    }
    
    // Show entry if its parent matches current view
    // parentEntryId === null or undefined means root level
    const entryParent = entryData.parentEntryId ?? null;
    const shouldShow = entryParent === currentViewEntryId;
    entryData.element.style.display = shouldShow ? '' : 'none';
    
    if (shouldShow) {
      visibleCount++;
    } else {
      hiddenCount++;
    }
    
    // Don't regenerate cards - they should already be in the entry
    // Cards are created when entries are first created or edited
  });
  
  console.log(`[VISIBILITY] Current context: ${currentViewEntryId}, Visible: ${visibleCount}, Hidden: ${hiddenCount}, Total: ${entries.size}`);
}

function navigateToEntry(entryId) {
  const entryData = entries.get(entryId);
  if (!entryData) return;
  
  isNavigating = true;
  
  // Get current username from page context or current user
  const pageUsername = window.PAGE_USERNAME;
  const username = pageUsername || (currentUser && currentUser.username);
  
  // Navigate locally with URL path update
  navigationStack.push(entryId);
  currentViewEntryId = entryId;
  updateBreadcrumb();
  updateEntryVisibility();
  
  // Hide and blur editor to prevent paste behavior
  if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
    hideCursor();
    editor.blur();
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing', 'deadline-editing');
    }
    editingEntryId = null;
  }
  
  // Recalculate dimensions for all visible entries after navigation
  setTimeout(() => {
    entries.forEach((entryData, entryId) => {
      if (entryId === 'anchor') return;
      const entry = entryData.element;
      if (entry && entry.style.display !== 'none') {
        updateEntryDimensions(entry);
      }
    });
    
    // Zoom to fit all visible entries
    requestAnimationFrame(() => {
      zoomToFitEntries();
    });
  }, 100);
  
  // Reset navigation flag - will be cleared by zoomToFitEntries animation completion
  navigationJustCompleted = true;
  console.log('[NAV] Set navigationJustCompleted = true for navigateToEntry');
  
  // Note: isNavigating will be cleared by zoomToFitEntries animation completion
  // This timeout is just a safety fallback
  setTimeout(() => {
    console.log('[NAV] Fallback timeout (1000ms) - isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    isNavigating = false;
    // Only hide editor if user hasn't explicitly placed it (clicked during navigation)
    // If editor is visible and has content or is focused, user wants to keep it
    if (editor.classList.contains('idle-cursor') || 
        (document.activeElement === editor && editor.textContent.trim().length > 0)) {
      // User has placed cursor/editor - keep it visible
      // navigationJustCompleted will be cleared by zoom animation or user click
    } else if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
      // Editor was active but empty - hide it
      hideCursor();
      editor.blur();
      editingEntryId = null;
    }
    // Fallback: clear the flag if zoom animation didn't clear it
    setTimeout(() => {
      // Only clear if user hasn't clicked (which would have cleared it already)
      console.log('[NAV] Final fallback timeout (900ms) - navigationJustCompleted:', navigationJustCompleted);
      if (navigationJustCompleted) {
        navigationJustCompleted = false;
        // Show cursor in default position after navigation completes (fallback)
        if (!isReadOnly) {
          console.log('[NAV] Showing cursor from final fallback');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              showCursorInDefaultPosition();
            });
          });
        }
      }
    }, 1200); // Wait longer to be a true fallback (after animation delay of 150ms + animation 800ms)
  }, 1000);
  
  // Update URL if we're on a user page
  if (username && pageUsername) {
    // Build path from navigation stack with unique slugs (same as navigateBack)
    const pathParts = [pageUsername];
    let currentParentId = null;
    
    navigationStack.forEach(stackEntryId => {
      const stackEntryData = entries.get(stackEntryId);
      if (stackEntryData) {
        let slug = generateEntrySlug(stackEntryData.text, stackEntryData);
        
        // Check for duplicate slugs at this level
        const siblings = Array.from(entries.values()).filter(e => 
          e.parentEntryId === currentParentId && e.id !== stackEntryId
        );
        
        const existingSlugs = siblings.map(e => generateEntrySlug(e.text, e));
        let counter = 1;
        let uniqueSlug = slug;
        
        while (existingSlugs.includes(uniqueSlug)) {
          counter++;
          uniqueSlug = `${slug}-${counter}`;
        }
        
        pathParts.push(uniqueSlug);
        currentParentId = stackEntryId;
      }
    });
    
    // Update URL without reloading
    window.history.pushState({ entryId, navigationStack: [...navigationStack] }, '', `/${pathParts.join('/')}`);
  }
}

function navigateBack(level = 1) {
  isNavigating = true;
  
  // Hide and blur editor to prevent paste behavior
  if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
    hideCursor();
    editor.blur();
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing', 'deadline-editing');
    }
    editingEntryId = null;
  }
  
  for (let i = 0; i < level && navigationStack.length > 0; i++) {
    navigationStack.pop();
  }
  
  if (navigationStack.length > 0) {
    currentViewEntryId = navigationStack[navigationStack.length - 1];
  } else {
    currentViewEntryId = null;
  }
  updateBreadcrumb();
  updateEntryVisibility();
  
  // Recalculate dimensions for all visible entries after navigation
  setTimeout(() => {
    entries.forEach((entryData, entryId) => {
      if (entryId === 'anchor') return;
      const entry = entryData.element;
      if (entry && entry.style.display !== 'none') {
        updateEntryDimensions(entry);
      }
    });
    
    // Zoom to fit all visible entries
    requestAnimationFrame(() => {
      zoomToFitEntries();
    });
  }, 100);
  
  // Reset navigation flag - will be cleared by zoomToFitEntries animation completion
  navigationJustCompleted = true;
  
  // Update URL to reflect navigation state
  const pageUsername = window.PAGE_USERNAME;
  if (pageUsername) {
    if (navigationStack.length === 0) {
      window.history.pushState({ navigationStack: [] }, '', `/${pageUsername}`);
    } else {
      // Build path from navigation stack with unique slugs
      const pathParts = [pageUsername];
      let currentParentId = null;
      
      navigationStack.forEach(entryId => {
        const entryData = entries.get(entryId);
        if (entryData) {
          let slug = generateEntrySlug(entryData.text, entryData);
          
          // Check for duplicate slugs at this level
          const siblings = Array.from(entries.values()).filter(e => 
            e.parentEntryId === currentParentId && e.id !== entryId
          );
          
          const existingSlugs = siblings.map(e => generateEntrySlug(e.text, e));
          let counter = 1;
          let uniqueSlug = slug;
          
          while (existingSlugs.includes(uniqueSlug)) {
            counter++;
            uniqueSlug = `${slug}-${counter}`;
          }
          
          pathParts.push(uniqueSlug);
          currentParentId = entryId;
        }
      });
      window.history.pushState({ navigationStack: [...navigationStack] }, '', `/${pathParts.join('/')}`);
    }
  }
  
  // Reset navigation flag - will be cleared by zoomToFitEntries animation completion
  navigationJustCompleted = true;
  setTimeout(() => {
    isNavigating = false;
    // Only hide editor if user hasn't explicitly placed it (clicked during navigation)
    // If editor is visible and has content or is focused, user wants to keep it
    if (editor.classList.contains('idle-cursor') || 
        (document.activeElement === editor && editor.textContent.trim().length > 0)) {
      // User has placed cursor/editor - keep it visible
      // navigationJustCompleted will be cleared by zoom animation or user click
    } else if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
      // Editor was active but empty - hide it
      hideCursor();
      editor.blur();
      editingEntryId = null;
    }
    // Fallback: clear the flag if zoom animation didn't clear it
    setTimeout(() => {
      // Only clear if user hasn't clicked (which would have cleared it already)
      if (navigationJustCompleted) {
        navigationJustCompleted = false;
        // Show cursor in default position after navigation completes
        if (!isReadOnly) {
          showCursorInDefaultPosition();
        }
      }
    }, 500);
  }, 1000);
}

function navigateToRoot() {
  isNavigating = true;
  
  // Hide and blur editor to prevent paste behavior
  if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
    hideCursor();
    editor.blur();
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing', 'deadline-editing');
    }
    editingEntryId = null;
  }
  
  navigationStack = [];
  currentViewEntryId = null;
  updateBreadcrumb();
  updateEntryVisibility();
  
  // Ensure anchor position is set correctly (use stored position, don't recalculate)
  if (anchor) {
    anchor.style.left = `${anchorPos.x}px`;
    anchor.style.top = `${anchorPos.y}px`;
  }
  
  // Recalculate dimensions for all visible entries after navigation
  setTimeout(() => {
    entries.forEach((entryData, entryId) => {
      if (entryId === 'anchor') return;
      const entry = entryData.element;
      if (entry && entry.style.display !== 'none') {
        updateEntryDimensions(entry);
      }
    });
    
    // Zoom to fit all visible entries (same as initial load)
    requestAnimationFrame(() => {
      zoomToFitEntries();
    });
  }, 100);
  
  // Update URL to root user page
  const pageUsername = window.PAGE_USERNAME;
  if (pageUsername) {
    window.history.pushState({ navigationStack: [] }, '', `/${pageUsername}`);
  }
  
  // Reset navigation flag after a delay to prevent paste events
  // Also prevent editor from being shown for a bit longer
  navigationJustCompleted = true;
  isNavigating = false;
  // Note: navigationJustCompleted will be cleared by zoomToFitEntries animation completion
  // But we also set a timeout as a fallback in case zoom doesn't happen
  setTimeout(() => {
    // Ensure editor is still hidden after navigation completes
    if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
      hideCursor();
      editor.blur();
      editingEntryId = null;
    }
    // Fallback: clear the flag if zoom animation didn't clear it
    // (This handles cases where zoomToFitEntries doesn't run)
    setTimeout(() => {
      navigationJustCompleted = false;
    }, 500);
  }, 1000);
}

function updateBreadcrumb() {
  breadcrumb.innerHTML = '';
  
  // Always show breadcrumb on user pages (even at root for context)
  const pageUsername = window.PAGE_USERNAME;
  const isOwner = window.PAGE_IS_OWNER === true;
  
  // Always show breadcrumb when we're in a subdirectory (navigationStack.length > 0)
  // OR when on a user page (even at root for context)
  if (navigationStack.length === 0) {
    // On user pages, show a minimal breadcrumb at root too
    if (pageUsername) {
      breadcrumb.style.display = 'flex';
      const homeItem = document.createElement('span');
      homeItem.className = 'breadcrumb-item';
      homeItem.textContent = pageUsername;
      homeItem.style.cursor = 'default';
      homeItem.style.opacity = '0.7';
      breadcrumb.appendChild(homeItem);
    } else {
      breadcrumb.style.display = 'none';
    }
    return;
  }
  
  // In subdirectories: ALWAYS show breadcrumb (both view and edit mode)
  breadcrumb.style.display = 'flex';
  
  const homeItem = document.createElement('span');
  homeItem.className = 'breadcrumb-item';
  // Show "all" if owner/logged in, show username if just viewing
  homeItem.textContent = isOwner ? 'all' : pageUsername;
  homeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Prevent text selection
    window.getSelection().removeAllRanges();
    // Blur editor to prevent paste behavior
    if (document.activeElement === editor) {
      editor.blur();
    }
      // Clear editor content and show cursor
      hideCursor();
      navigateToRoot();
  });
  breadcrumb.appendChild(homeItem);
  
  navigationStack.forEach((entryId, index) => {
    const entryData = entries.get(entryId);
    if (!entryData) return;
    
    const separator = document.createElement('span');
    separator.className = 'breadcrumb-separator';
    separator.textContent = ' › ';
    breadcrumb.appendChild(separator);
    
    const item = document.createElement('span');
    item.className = 'breadcrumb-item';
    // Use media card title if available, otherwise use entry text
    const displayText = entryData.mediaCardData && entryData.mediaCardData.title
      ? entryData.mediaCardData.title.substring(0, 50)
      : (entryData.text.split('\n')[0].trim().substring(0, 50) || 'Untitled');
    item.textContent = displayText;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Prevent text selection
      window.getSelection().removeAllRanges();
      // Blur editor to prevent paste behavior
      if (document.activeElement === editor) {
        editor.blur();
      }
      // Clear editor content and show cursor
      hideCursor();
      const level = navigationStack.length - index - 1;
      if (level > 0) {
        navigateBack(level);
      }
    });
    breadcrumb.appendChild(item);
  });
}


// Check if a position overlaps with any entry (requires 5px empty space in all directions)
function positionOverlapsEntry(wx, wy) {
  const requiredClearance = 5; // Required empty space in all directions (in world coordinates)
  const cursorWidth = 4; // Approximate cursor width in world coordinates
  const cursorHeight = 20; // Approximate cursor height in world coordinates (line height)
  
  // Calculate the bounding box of the cursor area (with required clearance)
  // Account for editor padding offset (4px) - cursor appears 4px to the right of editor.left
  const cursorX = wx + 4; // Actual cursor X position (accounting for editor padding)
  const cursorLeft = cursorX - requiredClearance;
  const cursorRight = cursorX + cursorWidth + requiredClearance;
  const cursorTop = wy - requiredClearance;
  const cursorBottom = wy + cursorHeight + requiredClearance;
  
  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;
    const element = entryData.element;
    if (!element || element.style.display === 'none') continue;
    
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    
    // Use getBoundingClientRect for accurate dimensions, but ensure it's valid
    const rect = element.getBoundingClientRect();
    // Only check if element has valid dimensions (not collapsed)
    if (rect.width === 0 || rect.height === 0) continue;
    
    // Get world dimensions accounting for zoom
    // Use Math.max to ensure we have at least some minimum dimensions
    const worldWidth = Math.max(rect.width / cam.z, 50); // Minimum 50px world width
    const worldHeight = Math.max(rect.height / cam.z, 20); // Minimum 20px world height
    
    // Check if cursor area (with clearance) overlaps with entry
    // Check for any overlap between cursor area and entry using bounding box intersection
    if (!(cursorRight < worldX || cursorLeft > worldX + worldWidth || 
          cursorBottom < worldY || cursorTop > worldY + worldHeight)) {
      return true; // Overlaps
    }
  }
  
  // Also check anchor if on home page
  if (anchor && currentViewEntryId === null) {
    const anchorX = anchorPos.x;
    const anchorY = anchorPos.y;
    const anchorRect = anchor.getBoundingClientRect();
    // Only check if anchor has valid dimensions
    if (anchorRect.width > 0 && anchorRect.height > 0) {
      const anchorWorldWidth = anchorRect.width / cam.z;
      const anchorWorldHeight = anchorRect.height / cam.z;
      
      // Check if cursor area overlaps with anchor
      if (!(cursorRight < anchorX || cursorLeft > anchorX + anchorWorldWidth || 
            cursorBottom < anchorY || cursorTop > anchorY + anchorWorldHeight)) {
        return true; // Overlaps
      }
    }
  }
  
  return false;
}

// Check if a position is within the viewport (at 0.75x zoom level)
function isPositionInViewport(wx, wy) {
  const viewportRect = viewport.getBoundingClientRect();
  // Calculate viewport bounds in world coordinates at 0.75x zoom
  const viewportWorldWidth = viewportRect.width / 0.75;
  const viewportWorldHeight = viewportRect.height / 0.75;
  const viewportCenter = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
  
  const viewportLeft = viewportCenter.x - viewportWorldWidth / 2;
  const viewportRight = viewportCenter.x + viewportWorldWidth / 2;
  const viewportTop = viewportCenter.y - viewportWorldHeight / 2;
  const viewportBottom = viewportCenter.y + viewportWorldHeight / 2;
  
  return wx >= viewportLeft && wx <= viewportRight && 
         wy >= viewportTop && wy <= viewportBottom;
}

// Find a random empty space next to an entry that doesn't overlap with entries
// Prefers positions within viewport (0.75x zoom)
function findRandomEmptySpaceNextToEntry() {
  const visibleEntries = Array.from(entries.values()).filter(entryData => {
    const element = entryData.element;
    if (!element) return false;
    if (currentViewEntryId === null) {
      return !entryData.parentEntryId && element.style.display !== 'none';
    } else {
      return element.style.display !== 'none';
    }
  });

  if (visibleEntries.length === 0) {
    // No entries - place cursor in center of viewport for empty pages
    const viewportRect = viewport.getBoundingClientRect();
    const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
    
    // For empty pages, always use center so it's clear where user is typing
    console.log('[CURSOR] Empty page - placing cursor in center:', center);
    return { x: center.x, y: center.y };
  }

  // Try multiple positions until we find one that doesn't overlap and is in viewport
  const maxAttempts = 50; // Increased attempts to find viewport position
  let bestPosition = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Pick a random entry
    const randomEntry = visibleEntries[Math.floor(Math.random() * visibleEntries.length)];
    const element = randomEntry.element;
    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    // Convert screen dimensions to world dimensions (accounting for zoom)
    const worldWidth = rect.width / cam.z;
    const worldHeight = rect.height / cam.z;

    // Choose a random side (right, bottom, left, top)
    const side = Math.floor(Math.random() * 4);
    const padding = (40 + 5) / cam.z; // Space between entry and cursor (40px + 5px clearance in world coordinates)

    let x, y;
    switch (side) {
      case 0: // Right
        x = worldX + worldWidth + padding;
        y = worldY + Math.random() * worldHeight;
        break;
      case 1: // Bottom
        x = worldX + Math.random() * worldWidth;
        y = worldY + worldHeight + padding;
        break;
      case 2: // Left
        x = worldX - padding;
        y = worldY + Math.random() * worldHeight;
        break;
      case 3: // Top
        x = worldX + Math.random() * worldWidth;
        y = worldY - padding;
        break;
    }

    // Check if this position overlaps with any entry
    if (!positionOverlapsEntry(x, y)) {
      // Prefer positions within viewport
      if (isPositionInViewport(x, y)) {
        return { x, y };
      }
      // Store as fallback if we don't have one yet
      if (!bestPosition) {
        bestPosition = { x, y };
      }
    }
  }
  
  // If we found a non-overlapping position (even if outside viewport), use it
  if (bestPosition) {
    return bestPosition;
  }
  
  // If we couldn't find a non-overlapping position after maxAttempts, try systematic search
  // Try positions in a grid pattern around the viewport center (preferring viewport)
  const viewportRect = viewport.getBoundingClientRect();
  const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
  const step = 50 / cam.z; // Smaller step for finer search
  const maxRadius = (viewportRect.width / 0.75) / 2; // Limit to viewport at 0.75x zoom
  
  // First, try positions within viewport
  for (let radius = step; radius <= maxRadius; radius += step) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const testX = center.x + Math.cos(rad) * radius;
      const testY = center.y + Math.sin(rad) * radius;
      if (!positionOverlapsEntry(testX, testY) && isPositionInViewport(testX, testY)) {
        return { x: testX, y: testY };
      }
    }
  }
  
  // If nothing in viewport, try outside viewport
  for (let radius = step; radius <= maxRadius * 2; radius += step) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const testX = center.x + Math.cos(rad) * radius;
      const testY = center.y + Math.sin(rad) * radius;
      if (!positionOverlapsEntry(testX, testY)) {
        return { x: testX, y: testY };
      }
    }
  }
  
  // Last resort: return center position (should be visible)
  return { x: center.x, y: center.y };
}

// Show cursor at a position (idle mode - not actively editing)
function showCursorAtWorld(wx, wy, force = false) {
  if (isReadOnly) {
    return;
  }
  if (isFocusInDropDialog()) {
    return;
  }
  
  // Don't show cursor if there are selected entries (user might want to delete them)
  if (selectedEntries.size > 0 && !force) {
    return;
  }
  
  // Don't update cursor if we're processing a click - wait for click handler to set position
  if (isProcessingClick && !force) {
    return;
  }
  
  console.log('[CURSOR] showCursorAtWorld at', wx, wy);
  
  editorWorldPos = { x: wx, y: wy };
  // Account for editor's left padding (4px) so cursor appears exactly where clicked
  editor.style.left = `${wx - 4}px`;
  editor.style.top = `${wy}px`;
  
  // CRITICAL: Clear editor content completely to prevent stale content
  editor.textContent = '';
  editor.innerHTML = '';
  editor.value = ''; // Also clear value just in case
  
  editor.style.width = '4px';
  // Reset font size to default for new entries
  editor.style.fontSize = '16px';
  // Ensure editor is visible
  editor.style.display = 'block';
  if (formatBar) formatBar.classList.remove('hidden');
  // Focus the editor so user can type immediately
  // The focus event will remove idle-cursor class and show native caret
  editor.classList.add('idle-cursor');
  editor.classList.remove('has-content');
  // Focus editor so typing works immediately
  requestAnimationFrame(() => {
    editor.focus();
    // Set cursor position at the start
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// Get bottom-right position of an entry (or where it was)
function getEntryBottomRightPosition(entryId) {
  if (!entryId) return null;
  
  const entryData = entries.get(entryId);
  if (entryData && entryData.element) {
    const element = entryData.element;
    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    const worldWidth = rect.width;
    const worldHeight = rect.height;
    
    // Position cursor at bottom-right with some padding
    const padding = 40;
    return {
      x: worldX + worldWidth + padding,
      y: worldY + worldHeight + padding
    };
  }
  
  // If entry doesn't exist anymore (was deleted), use stored position if available
  // Otherwise return null to fall back to random position
  return null;
}

// Show cursor in a good default position
// RULE: Cursor should ALWAYS be visible unless something is in edit mode (typing)
function showCursorInDefaultPosition(entryId = null) {
  console.log('[CURSOR] showCursorInDefaultPosition called. isReadOnly:', isReadOnly, 'entryId:', entryId, 'hasClickedRecently:', hasClickedRecently);
  
  if (isReadOnly) {
    return;
  }
  if (isFocusInDropDialog()) {
    return;
  }
  
  // Don't show cursor if there are selected entries (user might want to delete them)
  if (selectedEntries.size > 0) {
    console.log('[CURSOR] Entries are selected, hiding cursor');
    hideCursor();
    return;
  }
  
  // Don't show idle cursor if user is actively editing (typing in editor)
  if (editingEntryId && document.activeElement === editor && editor.textContent.trim().length > 0) {
    console.log('[CURSOR] User is actively editing, not showing idle cursor');
    return;
  }
  
  // PRIORITY 1: If user just clicked, use that click position (superceding rule)
  // Check lastClickPos first - if user clicked, always use that position
  // Note: We don't check for overlaps here because user explicitly clicked there
  if (lastClickPos && hasClickedRecently) {
    console.log('[CURSOR] Using last click position:', lastClickPos);
    showCursorAtWorld(lastClickPos.x, lastClickPos.y, true); // force = true to override isProcessingClick
    return;
  }
  
  // PRIORITY 2: If we have an entry ID, place cursor at bottom-right of that entry
  if (entryId) {
    const pos = getEntryBottomRightPosition(entryId);
    if (pos) {
      // Check if position overlaps with any entry, if so find a new empty space
      if (positionOverlapsEntry(pos.x, pos.y)) {
        // Position overlaps, find a new empty space
        const newPos = findRandomEmptySpaceNextToEntry();
        console.log('[CURSOR] Position overlaps, using new position:', newPos);
        showCursorAtWorld(newPos.x, newPos.y);
      } else {
        console.log('[CURSOR] Using entry bottom-right position:', pos);
        showCursorAtWorld(pos.x, pos.y);
      }
      return;
    }
  }
  
  // PRIORITY 3: If we have a stored position from before edit mode, use it
  // BUT: Only if user didn't click (hasClickedRecently would be true if they did)
  if (cursorPosBeforeEdit && !hasClickedRecently) {
    // Check if stored position overlaps with any entry
    if (positionOverlapsEntry(cursorPosBeforeEdit.x, cursorPosBeforeEdit.y)) {
      // Position overlaps, find a new empty space
      const newPos = findRandomEmptySpaceNextToEntry();
      console.log('[CURSOR] Stored position overlaps, using new position:', newPos);
      showCursorAtWorld(newPos.x, newPos.y);
    } else {
      console.log('[CURSOR] Using stored cursor position:', cursorPosBeforeEdit);
      showCursorAtWorld(cursorPosBeforeEdit.x, cursorPosBeforeEdit.y);
    }
    cursorPosBeforeEdit = null; // Clear after using
    return;
  }
  
  // PRIORITY 4: Otherwise, find a random empty space (or center for empty pages)
  // Keep trying until we find a position that doesn't overlap
  let attempts = 0;
  const maxAttempts = 10;
  let pos = null;
  let foundNonOverlapping = false;
  
  while (attempts < maxAttempts && !foundNonOverlapping) {
    pos = findRandomEmptySpaceNextToEntry();
    // Verify the position doesn't overlap with any entry
    if (!positionOverlapsEntry(pos.x, pos.y)) {
      foundNonOverlapping = true;
    } else {
      attempts++;
    }
  }
  
  if (foundNonOverlapping && pos) {
    console.log('[CURSOR] Using random empty space:', pos);
    showCursorAtWorld(pos.x, pos.y);
  } else {
    // If we still couldn't find a non-overlapping position, try systematic search
    // Try positions around the viewport center
    const viewportRect = viewport.getBoundingClientRect();
    const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
    let found = false;
    // Adjust offsets for zoom level
    const baseOffset = 100 / cam.z;
    const offsets = [0, baseOffset, -baseOffset, baseOffset * 2, -baseOffset * 2, baseOffset * 1.5, -baseOffset * 1.5];
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const testX = center.x + offsetX;
        const testY = center.y + offsetY;
        if (!positionOverlapsEntry(testX, testY)) {
          console.log('[CURSOR] Using systematic search position:', { x: testX, y: testY });
          showCursorAtWorld(testX, testY);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      // Last resort: use center position (should be visible even if it overlaps slightly)
      console.log('[CURSOR] Using center position (last resort):', center);
      showCursorAtWorld(center.x, center.y);
    }
  }
}

function placeEditorAtWorld(wx, wy, text = '', entryId = null, force = false){
  // Allow placing editor during navigation if user explicitly clicked (force = true)
  if (!force && (isNavigating || navigationJustCompleted)) {
    return;
  }
  
  console.log('[EDITOR] placeEditorAtWorld called with entryId:', entryId, 'type:', typeof entryId, 'force:', force);
  
  // Store cursor position before entering edit mode (if not already editing and we have a valid position)
  // BUT: Don't store if user just clicked (hasClickedRecently) - clicking should override stored position
  if (!editingEntryId && !text && !hasClickedRecently && editorWorldPos && (editorWorldPos.x !== 0 || editorWorldPos.y !== 0)) {
    // Only store if we have a meaningful position (not default 0,0) and user didn't just click
    cursorPosBeforeEdit = { x: editorWorldPos.x, y: editorWorldPos.y };
  }
  
  editorWorldPos = { x: wx, y: wy };
  editingEntryId = entryId;
  
  const previousEditing = document.querySelector('.entry.editing, .entry.deadline-editing');
  if (previousEditing) {
    previousEditing.classList.remove('editing', 'deadline-editing');
  }
  
  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    if(entryData && entryData.element){
      const isDeadline = entryData.textHtml && entryData.textHtml.includes('deadline-table');
      entryData.element.classList.add(isDeadline ? 'deadline-editing' : 'editing');
      if (!isDeadline) {
        setTimeout(() => updateEditingBorderDimensions(entryData.element), 0);
      }
    }
  }
  
  // Account for editor's left padding (4px) so cursor appears exactly where clicked
  editor.style.left = `${wx - 4}px`;
  editor.style.top  = `${wy}px`;
  
  // Restore HTML formatting if available, otherwise use plain text
  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    // LaTeX entries: load original plain text for editing, enable latex toggle
    if(entryData && entryData.latexData && entryData.latexData.enabled){
      editor.textContent = entryData.latexData.originalText || entryData.text;
      latexModeEnabled = true;
      const latexBtn = document.getElementById('latex-toggle-button');
      if (latexBtn) latexBtn.classList.add('active');
    } else if(entryData && entryData.textHtml){
      editor.innerHTML = entryData.textHtml;
      // Re-attach deadline table handlers when editing existing table
      if (entryData.textHtml.includes('deadline-table')) {
        editor.removeEventListener('keydown', handleDeadlineTableKeydown);
        editor.addEventListener('keydown', handleDeadlineTableKeydown);
        const table = editor.querySelector('.deadline-table');
        if (table) setupDeadlineTableHandlers(table);
      }
      if (entryData.textHtml.includes('gcal-card')) {
        const card = editor.querySelector('.gcal-card');
        if (card) setupCalendarCardHandlers(card);
      }
    } else {
      editor.textContent = text;
    }
    
    // Detect font size from the editor's actual content after loading HTML
    // Walk through the editor's child nodes to find the first text node with styling
    let detectedFontSize = 16;
    const detectFontSizeFromContent = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const parent = node.parentNode;
        if (parent && parent !== editor) {
          const fontSize = parseFloat(window.getComputedStyle(parent).fontSize);
          if (!isNaN(fontSize)) {
            return fontSize;
          }
        }
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        for (let child of node.childNodes) {
          const size = detectFontSizeFromContent(child);
          if (size) return size;
        }
      }
      return null;
    };
    
    const contentFontSize = detectFontSizeFromContent(editor);
    if (contentFontSize) {
      detectedFontSize = contentFontSize;
    } else if (entryData && entryData.element) {
      // Fallback to entry element's computed style
      const entryStyles = window.getComputedStyle(entryData.element);
      const fontSize = parseFloat(entryStyles.fontSize);
      if (!isNaN(fontSize)) {
        detectedFontSize = fontSize;
      }
    }
    
    editor.style.fontSize = detectedFontSize + 'px';
  } else {
    editor.textContent = text;
    editor.style.fontSize = '16px';
  }
  // Always remove idle-cursor when placing editor (will be focused, so native caret shows)
  editor.classList.remove('idle-cursor');
  // Ensure editor is visible (in case it was hidden during navigation)
  editor.style.display = 'block';
  if (formatBar) formatBar.classList.remove('hidden');
  
  // Set editor width based on actual content, not fixed entry width
  // This allows the editor to expand/contract based on text content
  editor.style.width = 'auto';
  
  if (text) {
    editor.classList.add('has-content');
  } else {
    editor.classList.remove('has-content');
  }
  
  const isDeadlineTable = entryId && (() => {
    const ed = entries.get(entryId);
    return ed && ed.textHtml && ed.textHtml.includes('deadline-table');
  })();
  const isCalendarCard = entryId && (() => {
    const ed = entries.get(entryId);
    return ed && ed.textHtml && ed.textHtml.includes('gcal-card');
  })();

  if (isDeadlineTable) {
    const firstCell = editor.querySelector('.deadline-table [contenteditable="true"]');
    if (firstCell) {
      firstCell.focus();
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.focus();
    }
  } else if (isCalendarCard) {
    const card = editor.querySelector('.gcal-card');
    if (card) setupCalendarCardHandlers(card);
    editor.focus();
  } else {
    editor.focus();
  }

  requestAnimationFrame(() => {
    const contentWidth = getWidestLineWidth(editor);
    editor.style.width = `${contentWidth}px`;
  });

  if (!isDeadlineTable && !isCalendarCard) {
    const range = document.createRange();
    const sel = window.getSelection();
    if (text) {
      range.selectNodeContents(editor);
      range.collapse(false);
    } else {
      range.setStart(editor, 0);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// Hide cursor (but keep editor visible for smooth transitions)
function hideCursor() {
  editor.classList.remove('idle-cursor', 'has-content');
  editor.textContent = '';
  editor.style.display = 'none'; // Hide editor when hiding cursor
  editor.blur();
  if (formatBar) formatBar.classList.add('hidden');
}

async function commitEditor(){
  // Prevent commits during or right after navigation
  if (isNavigating || navigationJustCompleted) {
    console.log('[COMMIT] Blocked - isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    return;
  }
  
  // Prevent double commits
  if (isCommitting) {
    console.log('[COMMIT] Already committing, skipping duplicate commit');
    return;
  }
  
  isCommitting = true;
  console.log('[COMMIT] Processing entry, editingEntryId:', editingEntryId);
  
  // Get HTML content to preserve formatting (bold, etc.)
  const htmlContent = editor.innerHTML;
  // Get plain text for URL extraction and storage
  const raw = editor.innerText;
  const trimmedRight = raw.replace(/\s+$/g,'');
  
  // Check if content is a deadline table, calendar card, or has formatting tags
  const isDeadlineTable = htmlContent.includes('deadline-table');
  const isCalendarCard = htmlContent.includes('gcal-card');
  const hasFormatting = isDeadlineTable || isCalendarCard || /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(htmlContent);
  const trimmedHtml = hasFormatting ? htmlContent : null;
  
  console.log('[COMMIT] HTML content length:', htmlContent.length, 'hasFormatting:', hasFormatting);
  if (hasFormatting) {
    console.log('[COMMIT] HTML sample:', htmlContent.substring(0, 200));
  }

  // If editing an existing entry
  if(editingEntryId && editingEntryId !== 'anchor'){
    console.log('[COMMIT] Editing existing entry:', editingEntryId);
    console.log('[COMMIT] Available entry IDs in Map:', Array.from(entries.keys()));
    const entryData = entries.get(editingEntryId);
    if(!entryData){
      console.warn('[COMMIT] Missing entry data for edit. Aborting edit to avoid duplicate:', editingEntryId);
      console.warn('[COMMIT] Entry not found in Map. Available entries:', Array.from(entries.keys()).filter(id => id.includes('83')));
      // After committing, show cursor in default position (restore previous or find empty space)
      showCursorInDefaultPosition();
      editingEntryId = null;
      isCommitting = false;
      return;
    }
    if(entryData){
      // If editor text is empty, delete the entry
      if(!trimmedRight){
        const deletedEntryId = editingEntryId; // Store before deletion
        const deletedEntryData = entries.get(deletedEntryId);
        let deletedEntryPos = null;
        if (deletedEntryData && deletedEntryData.element) {
          // Store position before deletion - use beginning (top-left) of entry
          const element = deletedEntryData.element;
          const worldX = parseFloat(element.style.left) || 0;
          const worldY = parseFloat(element.style.top) || 0;
          deletedEntryPos = {
            x: worldX,
            y: worldY
          };
        }
        const deleted = await deleteEntryWithConfirmation(editingEntryId);
        if (deleted) {
          // Show cursor at beginning (top-left) of where deleted entry was
          if (deletedEntryPos) {
            showCursorAtWorld(deletedEntryPos.x, deletedEntryPos.y);
          } else {
            showCursorInDefaultPosition();
          }
          editingEntryId = null;
        }
        isCommitting = false;
        return;
      }

      // Save undo state for edit (save old text before changing)
      const oldText = entryData.text;
      const oldMediaCardData = entryData.mediaCardData;
      const oldLinkCardsData = entryData.linkCardsData;
      
      // Only save undo if text actually changed
      if (oldText !== trimmedRight || oldMediaCardData !== null) {
        saveUndoState('edit', {
          entryId: editingEntryId,
          oldText: oldText,
          oldMediaCardData: oldMediaCardData,
          oldLinkCardsData: oldLinkCardsData
        });
      }

      // Extract URLs and process text
      const { processedText, urls } = processTextWithLinks(trimmedRight);

      // Preserve existing media/link card data - don't clear it
      // Only remove cards from DOM temporarily, we'll restore them after text update
      const existingCards = entryData.element.querySelectorAll('.link-card, .link-card-placeholder, .media-card');
      existingCards.forEach(card => card.remove());
      
      // Don't clear mediaCardData or linkCardsData - preserve them

      // Update entry text FIRST before any DOM changes
      entryData.text = trimmedRight;
      // Store HTML content to preserve formatting (only if it has formatting)
      entryData.textHtml = trimmedHtml;
      console.log('[COMMIT] Saving entryData.textHtml:', trimmedHtml ? trimmedHtml.substring(0, 200) : 'null');
      console.log('[COMMIT] entryData.textHtml length:', trimmedHtml ? trimmedHtml.length : 0);

      // Remove editing class first so content is visible for melt animation
      entryData.element.classList.remove('editing', 'deadline-editing');

      // LaTeX mode: convert and render
      if (latexModeEnabled) {
        entryData.element.innerHTML = '';
        entryData.element.classList.add('latex-converting');
        const latexResult = await convertToLatex(trimmedRight);
        entryData.element.classList.remove('latex-converting');
        if (latexResult && latexResult.latex) {
          entryData.latexData = {
            enabled: true,
            source: latexResult.latex,
            originalText: trimmedRight
          };
          renderLatex(latexResult.latex, entryData.element);
        } else {
          // Fallback: render as normal text
          entryData.latexData = null;
          entryData.element.innerHTML = meltify(processedText || '');
        }
      } else {
        // Clear latex data when latex mode is off
        entryData.latexData = null;

      if (isDeadlineTable || isCalendarCard) {
        // Deadline tables / calendar cards: use raw HTML directly, no melt animation
        entryData.element.innerHTML = trimmedHtml;
        if (isCalendarCard) {
          const card = entryData.element.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        }
      } else {
        // Add melt class for animation
        entryData.element.classList.add('melt');

        // Update entry content with melt animation, preserving HTML formatting
        if(processedText){
          if (trimmedHtml) {
            // Has formatting, process HTML with formatting preserved
            entryData.element.innerHTML = meltifyHtml(trimmedHtml);
          } else {
            // No formatting, use regular meltify
            entryData.element.innerHTML = meltify(processedText);
          }
        } else {
          entryData.element.innerHTML = '';
        }
        applyEntryFontSize(entryData.element, trimmedHtml);
      }
      } // end else (non-latex)

      // Restore media card if it exists
      if (entryData.mediaCardData) {
        const card = createMediaCard(entryData.mediaCardData);
        entryData.element.appendChild(card);
      }

      // Restore existing link cards from linkCardsData
      if (entryData.linkCardsData && Array.isArray(entryData.linkCardsData)) {
        for (const cardData of entryData.linkCardsData) {
          if (cardData && cardData.url) {
            const card = createLinkCard(cardData);
            entryData.element.appendChild(card);
            updateEntryWidthForLinkCard(entryData.element, card);
          }
        }
      }

      // Generate and add cards for NEW URLs found in text (that aren't already in linkCardsData)
      const existingUrls = entryData.linkCardsData ? entryData.linkCardsData.map(c => c.url).filter(Boolean) : [];
      const newUrls = urls.filter(url => !existingUrls.includes(url));
      if(newUrls.length > 0){
        const placeholders = [];
        for(const url of newUrls){
          const placeholder = createLinkCardPlaceholder(url);
          entryData.element.appendChild(placeholder);
          updateEntryWidthForLinkCard(entryData.element, placeholder);
          placeholders.push({ placeholder, url });
        }
        
        // Replace placeholders with actual cards as they're generated
        const newLinkCardsData = [];
        for(const { placeholder, url } of placeholders){
          const cardData = await generateLinkCard(url);
          if(cardData){
            const card = createLinkCard(cardData);
            placeholder.replaceWith(card);
            updateEntryWidthForLinkCard(entryData.element, card);
            newLinkCardsData.push(cardData);
          } else {
            placeholder.remove();
          }
        }
        // Update linkCardsData with new cards
        if (!entryData.linkCardsData) entryData.linkCardsData = [];
        entryData.linkCardsData.push(...newLinkCardsData);
      }
      
      // Update entry dimensions based on actual content
      // Force immediate recalculation, then update again after rendering
      updateEntryDimensions(entryData.element);
      
      // Also recalculate after a delay to ensure DOM is fully updated
      setTimeout(() => {
        updateEntryDimensions(entryData.element);
        if (urls.length > 0) {
          // Has link cards - update again after cards are loaded
          setTimeout(() => {
            updateEntryDimensions(entryData.element);
          }, 300);
        }
      }, 150);
      
      // Save to server - ensure update completes before clearing editing state
      // This prevents duplicates if page reloads before update completes
      try {
        console.log('[COMMIT] About to updateEntryOnServer, entryData.textHtml:', entryData.textHtml ? entryData.textHtml.substring(0, 100) : 'null');
        await updateEntryOnServer(entryData);
        console.log('[COMMIT] Entry updated successfully:', entryData.id);
        // Research mode: generate related entries if text changed
        if (researchModeEnabled && oldText !== trimmedRight) {
          researchedEntries.delete(entryData.id);
          spawnResearchEntries(entryData.id);
        }
      } catch (error) {
        console.error('[COMMIT] Failed to update entry:', error);
        // Don't clear editing state on error - let user retry
        isCommitting = false;
        return;
      }

      // Remove melt class after animation completes and reset styles
      const maxDuration = 1500; // Maximum animation duration
      setTimeout(() => {
        entryData.element.classList.remove('melt');
        // Reset any inline styles from animation
        const spans = entryData.element.querySelectorAll('span');
        spans.forEach(span => {
          span.style.animation = 'none';
          span.style.transform = '';
          span.style.filter = '';
          span.style.opacity = '';
        });
      }, maxDuration);
      
      // Clear editor content BEFORE showing cursor to prevent stale content
      // from being committed as a new entry if commitEditor is triggered again
      const committedEntryId = editingEntryId;
      editingEntryId = null;
      editor.removeEventListener('keydown', handleDeadlineTableKeydown);
      editor.textContent = '';
      editor.innerHTML = '';

      // After committing, show cursor at bottom-right of edited entry
      showCursorInDefaultPosition(committedEntryId);
      isCommitting = false;
      return;
    }
  }

  // Create new entry
  // Safety check: if we somehow got here while editing, abort
  if (editingEntryId && editingEntryId !== 'anchor') {
    console.error('[COMMIT] ERROR: Attempted to create new entry while editingEntryId is set:', editingEntryId);
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }
  
  // Extract URLs and process text
  const { processedText, urls } = processTextWithLinks(trimmedRight);

  // Allow entry if there's text OR URLs
  if(!processedText && urls.length === 0){
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }

  // Check for duplicate entry at the same directory level
  // BUT: If we're editing an existing entry, exclude it from duplicate check
  const duplicateId = findDuplicateEntry(trimmedRight, currentViewEntryId, editingEntryId);
  if (duplicateId) {
    // Don't create duplicate - just clear editor
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }

  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = (isDeadlineTable || isCalendarCard) ? 'entry' : 'entry melt';
  entry.id = entryId;

  entry.style.left = `${editorWorldPos.x}px`;
  entry.style.top  = `${editorWorldPos.y}px`;

  let newEntryLatexData = null;

  // LaTeX mode for new entries
  if (latexModeEnabled && !isDeadlineTable && !isCalendarCard) {
    entry.classList.remove('melt');
    entry.classList.add('latex-converting');
    world.appendChild(entry);
    const latexResult = await convertToLatex(trimmedRight);
    entry.classList.remove('latex-converting');
    if (latexResult && latexResult.latex) {
      newEntryLatexData = {
        enabled: true,
        source: latexResult.latex,
        originalText: trimmedRight
      };
      renderLatex(latexResult.latex, entry);
    } else {
      entry.innerHTML = meltify(processedText || '');
    }
  } else {
  // Only render text if there is any
  if (isDeadlineTable) {
    entry.innerHTML = trimmedHtml;
  } else if (isCalendarCard) {
    entry.innerHTML = trimmedHtml;
    world.appendChild(entry);
    const card = entry.querySelector('.gcal-card');
    if (card) setupCalendarCardHandlers(card);
  } else if(processedText){
    if (trimmedHtml) {
      // Has formatting, process HTML with formatting preserved
      entry.innerHTML = meltifyHtml(trimmedHtml);
    } else {
      // No formatting, use regular meltify
      entry.innerHTML = meltify(processedText);
    }
  } else {
    entry.innerHTML = '';
  }
  applyEntryFontSize(entry, trimmedHtml);
  if (!isCalendarCard) world.appendChild(entry);
  }

  // Update entry dimensions based on actual content after rendering
  // Wait a bit for DOM to update
  setTimeout(() => {
    updateEntryDimensions(entry);
  }, 50);

  // Store entry data
  const entryData = {
    id: entryId,
    element: entry,
    text: trimmedRight,
    textHtml: trimmedHtml || null, // Store HTML to preserve formatting (null if no formatting)
    latexData: newEntryLatexData,
    position: { x: editorWorldPos.x, y: editorWorldPos.y },
    parentEntryId: currentViewEntryId
  };
  entries.set(entryId, entryData);
  
  // Ensure entry is in the DOM (defensive check)
  if (!entry.parentElement) {
    world.appendChild(entry);
  }
  
  // Update visibility - new entry should be visible in current view
  updateEntryVisibility();
  
  // Save to server (await to ensure it completes)
  console.log('[COMMIT] Saving new text entry:', entryData.id, entryData.text.substring(0, 50));
  await saveEntryToServer(entryData);

  // Research mode: generate related entries from the new entry
  if (researchModeEnabled) {
    spawnResearchEntries(entryId);
  }

  // Generate and add cards for URLs (async, after text is rendered)
  if(urls.length > 0){
    const placeholders = [];
    for(const url of urls){
      const placeholder = createLinkCardPlaceholder(url);
      entry.appendChild(placeholder);
      updateEntryWidthForLinkCard(entry, placeholder);
      placeholders.push({ placeholder, url });
    }
    
    // Replace placeholders with actual cards as they're generated
    const allCardData = [];
    for(const { placeholder, url } of placeholders){
      const cardData = await generateLinkCard(url);
      if(cardData){
        const card = createLinkCard(cardData);
        placeholder.replaceWith(card);
        updateEntryWidthForLinkCard(entry, card);
        allCardData.push(cardData);
      } else {
        placeholder.remove();
      }
    }
    
    // Save card data to entry for future loads
    if (allCardData.length > 0 && !editingEntryId) {
      const entryData = entries.get(entry.id);
      if (entryData) {
        entryData.cardData = allCardData[0]; // Store first card data
        await updateEntryOnServer(entryData);
      }
    } else if (allCardData.length > 0 && editingEntryId && editingEntryId !== 'anchor') {
      const entryData = entries.get(editingEntryId);
      if (entryData) {
        entryData.cardData = allCardData[0]; // Store first card data
        await updateEntryOnServer(entryData);
      }
    }
  }

  // Remove melt class after animation completes
  const maxDuration = 1500; // Maximum animation duration
  setTimeout(() => {
    entry.classList.remove('melt');
    // Reset any inline styles from animation
    const spans = entry.querySelectorAll('span');
    spans.forEach(span => {
      span.style.animation = 'none';
      span.style.transform = '';
      span.style.filter = '';
      span.style.opacity = '';
    });
  }, maxDuration);

  // Remove editing class if any
  if(editingEntryId && editingEntryId !== 'anchor'){
    const entryData = entries.get(editingEntryId);
    if(entryData && entryData.element){
      entryData.element.classList.remove('editing', 'deadline-editing');
    }
  }
  
  // After committing, show cursor at bottom-right of created/edited entry
  // Use the newly created entryId (entry was just created above)
  showCursorInDefaultPosition(entryId);
  editingEntryId = null;
  isCommitting = false;
}

function updateEntryDimensions(entry) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Research cards: use auto dimensions based on card content
      if (entry.classList.contains('research-entry')) {
        const card = entry.firstElementChild;
        if (card) {
          const w = Math.max(card.scrollWidth, card.offsetWidth);
          const h = Math.max(card.scrollHeight, card.offsetHeight);
          entry.style.setProperty('width', `${w}px`, 'important');
          entry.style.setProperty('height', `${h}px`, 'important');
          entry.style.setProperty('min-height', 'auto', 'important');
          entry.style.setProperty('min-width', 'auto', 'important');
        }
        return;
      }
      // Deadline tables: use actual DOM dimensions
      const deadlineTable = entry.querySelector('.deadline-table');
      if (deadlineTable) {
        const tableWidth = Math.max(deadlineTable.scrollWidth, deadlineTable.offsetWidth);
        const tableHeight = Math.max(deadlineTable.scrollHeight, deadlineTable.offsetHeight);
        entry.style.setProperty('width', `${tableWidth}px`, 'important');
        entry.style.setProperty('height', `${tableHeight}px`, 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        entry.style.setProperty('min-width', 'auto', 'important');
        return;
      }
      const gcalCard = entry.querySelector('.gcal-card');
      if (gcalCard) {
        const w = Math.max(gcalCard.scrollWidth, gcalCard.offsetWidth);
        const h = Math.max(gcalCard.scrollHeight, gcalCard.offsetHeight);
        entry.style.setProperty('width', `${w}px`, 'important');
        entry.style.setProperty('height', `${h}px`, 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        entry.style.setProperty('min-width', 'auto', 'important');
        return;
      }
      if (entry.classList.contains('canvas-file')) {
        // Use fixed dimensions — DOM measurement is unreliable when entry is hidden
        entry.style.setProperty('width', 'auto', 'important');
        entry.style.setProperty('height', 'auto', 'important');
        entry.style.setProperty('min-width', '200px', 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        return;
      }
      if (entry.classList.contains('canvas-image')) {
        const img = entry.querySelector('img');
        if (img) {
          // Check for persisted custom size
          const entryData = entries.get(entry.id);
          const cw = entryData && entryData.mediaCardData && entryData.mediaCardData.customWidth;
          const ch = entryData && entryData.mediaCardData && entryData.mediaCardData.customHeight;
          if (cw && ch) {
            img.style.width = `${cw}px`;
            img.style.height = `${ch}px`;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            entry.style.setProperty('width', `${cw}px`, 'important');
            entry.style.setProperty('height', `${ch}px`, 'important');
            entry.style.setProperty('min-width', 'auto', 'important');
            entry.style.setProperty('min-height', 'auto', 'important');
            return;
          }
          const maxW = 320;
          const maxH = 240;
          let w = img.naturalWidth || img.offsetWidth || 0;
          let h = img.naturalHeight || img.offsetHeight || 0;
          if (w <= 0 || h <= 0) {
            w = w || 200;
            h = h || 150;
          }
          const scale = Math.min(1, maxW / w, maxH / h);
          const contentWidth = Math.round(Math.min(w * scale, maxW));
          const contentHeight = Math.round(Math.min(h * scale, maxH));
          entry.style.setProperty('width', `${contentWidth}px`, 'important');
          entry.style.setProperty('height', `${contentHeight}px`, 'important');
          entry.style.setProperty('min-width', 'auto', 'important');
          entry.style.setProperty('min-height', 'auto', 'important');
          return;
        }
      }
      let contentWidth = 0;
      const linkCards = entry.querySelectorAll('.link-card, .link-card-placeholder');
      const mediaCards = entry.querySelectorAll('.media-card');
    // Handle media cards first (they have different padding)
    if (mediaCards.length > 0) {
      const desiredPadding = 2; // Minimal padding for media cards
      
      mediaCards.forEach(card => {
        // Don't reset styles for media cards - they have fixed dimensions from CSS
        // Just measure their natural width including any existing margins
        const cardStyles = window.getComputedStyle(card);
        const cardWidth = card.offsetWidth;
        const currentMarginLeft = parseFloat(cardStyles.marginLeft) || 0;
        const currentMarginRight = parseFloat(cardStyles.marginRight) || 0;
        
        // Set consistent margins
        card.style.marginTop = `${desiredPadding}px`;
        card.style.marginBottom = `${desiredPadding}px`;
        card.style.marginLeft = `${desiredPadding}px`;
        card.style.marginRight = `${desiredPadding}px`;
        
        // Calculate entry width based on card width plus padding
        const entryWidth = cardWidth + (desiredPadding * 2);
        contentWidth = Math.max(contentWidth, entryWidth);
      });
      
      const minCardWidth = 280;
      const minWidthWithPadding = minCardWidth + (desiredPadding * 2);
      contentWidth = Math.max(contentWidth, minWidthWithPadding);
    } else if (linkCards.length > 0) {
      // If there are link cards, calculate width with symmetric padding
      // Use consistent padding for all link cards (same as height calculation)
      const desiredPadding = 12; // Fixed 12px padding for symmetry
      
      linkCards.forEach(card => {
        // Reset margins to get natural dimensions
        card.style.marginTop = '0';
        card.style.marginBottom = '0';
        card.style.marginLeft = '0';
        card.style.marginRight = '0';
        card.style.width = 'auto';
        card.style.maxWidth = 'none';
        
        // Force a layout recalculation
        void card.offsetWidth;
        
        const cardStyles = window.getComputedStyle(card);
        const cardMinWidth = parseFloat(cardStyles.minWidth) || 360;
        const cardNaturalWidth = Math.max(card.offsetWidth, cardMinWidth);
        
        // Set equal margins on all sides
        card.style.marginTop = `${desiredPadding}px`;
        card.style.marginBottom = `${desiredPadding}px`;
        card.style.marginLeft = `${desiredPadding}px`;
        card.style.marginRight = `${desiredPadding}px`;
        
        // Set the card's width explicitly to its natural width
        card.style.width = `${cardNaturalWidth}px`;
        
        // Entry width = card natural width + left padding + right padding
        const entryWidth = cardNaturalWidth + (desiredPadding * 2);
        contentWidth = Math.max(contentWidth, entryWidth);
      });
      
      // Ensure minimum width with padding (min card 360px + padding)
      const minCardWidth = 360;
      const minWidthWithPadding = minCardWidth + (desiredPadding * 2);
      contentWidth = Math.max(contentWidth, minWidthWithPadding);
    } else {
      // For text-only entries, calculate width from text content
      // Always use the stored entry text if available, as it's the source of truth
      let textContent = '';
      const entryId = entry.id;
      const entryData = entries.get(entryId);
      if (entryData && entryData.text) {
        // Use the stored raw text - this is always up-to-date
        textContent = entryData.text;
      } else {
        // Fall back to reading from DOM (strips HTML tags), but prefer entry text
        // Note: DOM reading might not be accurate if text has been melted/animated
        textContent = entry.innerText || entry.textContent || '';
      }
      
      // Calculate one character width as the minimum
      const entryStyles = window.getComputedStyle(entry);
      const tempChar = document.createElement('div');
      tempChar.style.position = 'absolute';
      tempChar.style.visibility = 'hidden';
      tempChar.style.whiteSpace = 'pre';
      tempChar.style.font = entryStyles.font;
      tempChar.style.fontSize = entryStyles.fontSize;
      tempChar.style.fontFamily = entryStyles.fontFamily;
      tempChar.textContent = 'M'; // Use 'M' as a typical wide character
      document.body.appendChild(tempChar);
      const oneCharWidth = tempChar.offsetWidth;
      document.body.removeChild(tempChar);
      
      if (textContent && textContent.trim()) {
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre';
        temp.style.font = entryStyles.font;
        temp.style.fontSize = entryStyles.fontSize;
        temp.style.fontFamily = entryStyles.fontFamily;
        temp.style.lineHeight = entryStyles.lineHeight;
        temp.textContent = textContent;
        document.body.appendChild(temp);
        
        // Force layout calculation
        void temp.offsetWidth;
        
        contentWidth = getWidestLineWidth(temp);
        document.body.removeChild(temp);
        
        // Use one character width as minimum, or actual width if larger
        contentWidth = Math.max(oneCharWidth, contentWidth);
      } else {
        contentWidth = oneCharWidth; // Default to one character width
      }
    }
    
    // Height: calculate based on actual rendered content
    // Don't set width yet - we'll set it at the end after all calculations
    entry.style.height = 'auto';
    entry.style.minHeight = 'auto';
    
    // Force a layout recalculation
    void entry.offsetHeight;
    
    // Use the entry's natural scrollHeight which includes all content and margins
    let contentHeight = entry.scrollHeight;
    
    // But we need to measure more accurately to ensure it includes all children properly
    // Get the actual bounding box of all content including margins
    if (entry.children.length > 0) {
      // Get the first and last child positions relative to entry
      const firstChild = entry.children[0];
      const lastChild = entry.children[entry.children.length - 1];
      
      if (firstChild && lastChild) {
        const firstRect = firstChild.getBoundingClientRect();
        const lastRect = lastChild.getBoundingClientRect();
        const entryRect = entry.getBoundingClientRect();
        const firstStyles = window.getComputedStyle(firstChild);
        const lastStyles = window.getComputedStyle(lastChild);
        
        // Calculate from first child's top margin to last child's bottom margin
        const firstMarginTop = parseFloat(firstStyles.marginTop) || 0;
        const lastMarginBottom = parseFloat(lastStyles.marginBottom) || 0;
        
        const relativeFirstTop = firstRect.top - entryRect.top - firstMarginTop;
        const relativeLastBottom = lastRect.bottom - entryRect.top + lastMarginBottom;
        
        const calculatedHeight = relativeLastBottom - relativeFirstTop;
        
        // For media cards or link cards, ensure symmetric visual padding
        // If we have only a card, adjust entry height to provide equal padding
        const mediaCard = entry.querySelector('.media-card');
        const linkCard = entry.querySelector('.link-card, .link-card-placeholder');
        
        if (mediaCard && entry.children.length === 1) {
          // Single media card - calculate height with equal top/bottom margins
          mediaCard.style.marginTop = '0';
          mediaCard.style.marginBottom = '0';
          mediaCard.style.marginLeft = '0';
          mediaCard.style.marginRight = '0';
          
          void mediaCard.offsetHeight;
          
          const cardNaturalHeight = mediaCard.offsetHeight;
          const desiredPadding = 2; // Minimal padding for media cards
          
          mediaCard.style.marginTop = `${desiredPadding}px`;
          mediaCard.style.marginBottom = `${desiredPadding}px`;
          mediaCard.style.marginLeft = `${desiredPadding}px`;
          mediaCard.style.marginRight = `${desiredPadding}px`;
          
          contentHeight = cardNaturalHeight + (desiredPadding * 2);
        } else if (linkCard && entry.children.length === 1) {
          // Single link card - calculate height with equal top/bottom margins
          // First, reset any existing margins to get the card's natural height
          linkCard.style.marginTop = '0';
          linkCard.style.marginBottom = '0';
          linkCard.style.marginLeft = '0';
          linkCard.style.marginRight = '0';
          
          // Force a reflow to get accurate measurements
          void linkCard.offsetHeight;
          
          // Get the card's natural height (without margins)
          const cardNaturalHeight = linkCard.offsetHeight;
          
          // Calculate desired padding - use a consistent padding value
          // This ensures equal top and bottom padding
          const desiredPadding = 12; // Fixed 12px padding for symmetry
          
          // Set equal margins on all sides to create symmetric padding
          linkCard.style.marginTop = `${desiredPadding}px`;
          linkCard.style.marginBottom = `${desiredPadding}px`;
          linkCard.style.marginLeft = `${desiredPadding}px`;
          linkCard.style.marginRight = `${desiredPadding}px`;
          
          // Entry height = card natural height + top margin + bottom margin
          // This ensures the card is perfectly centered vertically
          contentHeight = cardNaturalHeight + (desiredPadding * 2);
        } else {
          contentHeight = Math.max(contentHeight, calculatedHeight);
        }
      }
    }
    
    // Reset width first to allow contraction, then set new width
    entry.style.width = 'auto';
    entry.style.minWidth = 'auto';
    entry.style.maxWidth = 'none';
    
    // Force a reflow to ensure reset is applied
    void entry.offsetWidth;
    
    // Now set the calculated width - this allows both expansion and contraction
    entry.style.setProperty('width', `${contentWidth}px`, 'important');
    entry.style.setProperty('height', `${Math.max(contentHeight, 0)}px`, 'important');
    entry.style.setProperty('min-height', 'auto', 'important');
    entry.style.setProperty('max-width', 'none', 'important');
    entry.style.setProperty('min-width', 'auto', 'important');
    
    // Force a reflow to ensure width is applied
    void entry.offsetWidth;
    });
  });
}

function updateEntryWidthForLinkCard(entry, card) {
  // Update entry dimensions to account for link card
  updateEntryDimensions(entry);
}

function meltify(text){
  const chars = [...text];
  let out = '';
  let idx = 0;

  for(const ch of chars){
    if(ch === '\n'){
      out += '<br>';
      idx++;
      continue;
    }
    if(ch === ' '){
      out += '&nbsp;';
      idx++;
      continue;
    }

    const animateThis = Math.random() > 0.18;
    const baseDelay = idx * 8;
    const jitter = (Math.random() * 140) | 0;
    const delay = animateThis ? (baseDelay + jitter) : (baseDelay + 20);
    const dur = 720 + ((Math.random() * 520) | 0);
    const safe = escapeHtml(ch);

    const dripThis = animateThis && Math.random() < 0.10;
    if(animateThis){
      out += `<span ${dripThis ? 'class="drip"' : ''} data-ch="${safe}" style="animation-delay:${delay}ms;animation-duration:${dur}ms">${safe}</span>`;
    }else{
      out += `<span data-ch="${safe}" style="animation:none;opacity:1">${safe}</span>`;
    }
    idx++;
  }
  return out;
}

// LaTeX conversion helper: POST text to server, return { latex, isFullMath }
async function convertToLatex(text) {
  try {
    const response = await fetch('/api/convert-latex', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error('LaTeX conversion failed');
    return await response.json();
  } catch (error) {
    console.error('[LATEX] Conversion error:', error);
    return null;
  }
}

// Render LaTeX source into an element using KaTeX
// Common KaTeX options shared across all render calls
const katexOptions = {
  throwOnError: false,
  trust: true,
  strict: false,
  macros: {
    '\\R': '\\mathbb{R}',
    '\\Z': '\\mathbb{Z}',
    '\\N': '\\mathbb{N}',
    '\\Q': '\\mathbb{Q}',
    '\\C': '\\mathbb{C}',
    '\\F': '\\mathbb{F}',
    '\\dx': '\\,dx',
    '\\dy': '\\,dy',
    '\\dz': '\\,dz',
    '\\dt': '\\,dt',
    '\\du': '\\,du',
    '\\dv': '\\,dv',
    '\\dtheta': '\\,d\\theta',
    '\\dphi': '\\,d\\phi',
    '\\abs': '\\left|#1\\right|',
    '\\norm': '\\left\\|#1\\right\\|',
    '\\inner': '\\left\\langle #1, #2 \\right\\rangle',
    '\\floor': '\\left\\lfloor #1 \\right\\rfloor',
    '\\ceil': '\\left\\lceil #1 \\right\\rceil',
    '\\eval': '\\left.#1\\right|'
  }
};

function renderLatex(latexSource, element) {
  // Wrap in a latex-content container
  const container = document.createElement('div');
  container.className = 'latex-content';

  element.innerHTML = '';
  element.appendChild(container);

  // Check if source has math delimiters ($...$, $$...$$, \[...\], \(...\), or \begin{env})
  const hasDelimiters = /\$\$[\s\S]+?\$\$|\$[^$]+?\$|\\[\[\]]|\\[()]|\\begin\{/.test(latexSource);

  // Guard: wait for KaTeX to be loaded
  function doRender() {
    if (typeof katex !== 'undefined') {
      try {
        if (hasDelimiters && typeof renderMathInElement === 'function') {
          // Has delimiters - use renderMathInElement to parse mixed content
          container.textContent = latexSource;
          renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
              { left: '$', right: '$', display: false },
              { left: '\\begin{equation}', right: '\\end{equation}', display: true },
              { left: '\\begin{align}', right: '\\end{align}', display: true },
              { left: '\\begin{aligned}', right: '\\end{aligned}', display: true },
              { left: '\\begin{gather}', right: '\\end{gather}', display: true },
              { left: '\\begin{cases}', right: '\\end{cases}', display: true },
              { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
              { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true },
              { left: '\\begin{vmatrix}', right: '\\end{vmatrix}', display: true }
            ],
            ...katexOptions
          });
        } else {
          // No delimiters - render directly as a single math expression
          katex.render(latexSource, container, {
            displayMode: true,
            ...katexOptions
          });
        }
      } catch (e) {
        console.error('[LATEX] KaTeX render error:', e);
        // Fallback: show raw source
        container.textContent = latexSource;
      }
    } else {
      // Retry after a short delay if KaTeX hasn't loaded yet
      setTimeout(doRender, 200);
    }
  }
  doRender();
}

// Detect the primary font-size from an entry's textHtml and set it on the element.
// This ensures text outside explicit font-size spans still renders at the correct size
// (the entry CSS defaults to 16px, so entries with larger fonts would shrink on reload).
function applyEntryFontSize(entry, textHtml) {
  if (!textHtml) {
    entry.style.fontSize = '';
    return;
  }
  const match = textHtml.match(/style="[^"]*font-size:\s*(\d+(?:\.\d+)?)px/);
  if (match) {
    const size = parseFloat(match[1]);
    if (size && size !== 16) {
      entry.style.fontSize = size + 'px';
    } else {
      entry.style.fontSize = '';
    }
  } else {
    entry.style.fontSize = '';
  }
}

function escapeHtml(s){
  if (!s) return '';
  return s
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

// Meltify HTML while preserving formatting tags (like <strong>, <b>)
function meltifyHtml(html){
  if (!html) return '';
  
  // Create a temporary container to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Process each text node recursively, preserving formatting elements
  function processNode(node, idxRef) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text) return;
      
      const chars = [...text];
      let out = '';
      
      for(const ch of chars){
        if(ch === '\n'){
          out += '<br>';
          idxRef.idx++;
          continue;
        }
        if(ch === ' '){
          out += '&nbsp;';
          idxRef.idx++;
          continue;
        }

        const animateThis = Math.random() > 0.18;
        const baseDelay = idxRef.idx * 8;
        const jitter = (Math.random() * 140) | 0;
        const delay = animateThis ? (baseDelay + jitter) : (baseDelay + 20);
        const dur = 720 + ((Math.random() * 520) | 0);
        const safe = escapeHtml(ch);

        const dripThis = animateThis && Math.random() < 0.10;
        if(animateThis){
          out += `<span ${dripThis ? 'class="drip"' : ''} data-ch="${safe}" style="animation-delay:${delay}ms;animation-duration:${dur}ms">${safe}</span>`;
        }else{
          out += `<span data-ch="${safe}" style="animation:none;opacity:1">${safe}</span>`;
        }
        idxRef.idx++;
      }
      
      // Replace text node with a document fragment containing the HTML
      const fragment = document.createRange().createContextualFragment(out);
      if (node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recursively process child nodes, preserving formatting elements (strong, b, em, i, u)
      const children = Array.from(node.childNodes);
      children.forEach(child => processNode(child, idxRef));
    }
  }
  
  const idxRef = { idx: 0 };
  const children = Array.from(temp.childNodes);
  children.forEach(child => processNode(child, idxRef));
  
  return temp.innerHTML;
}

// URL detection regex
const urlRegex = /(https?:\/\/[^\s]+)/gi;

function extractUrls(text) {
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

// Generate slug from entry text (limit to 17 characters)
function generateEntrySlug(text, entryData = null) {
  if (entryData && entryData.mediaCardData && entryData.mediaCardData.type === 'image') {
    const suffix = (entryData.id || '').slice(-8).replace(/[^a-z0-9-]/gi, '') || '0';
    return 'image-' + suffix;
  }
  if (entryData && entryData.mediaCardData && entryData.mediaCardData.title) {
    const slug = entryData.mediaCardData.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with one
      .trim()
      .substring(0, 17)
      .replace(/-+$/, ''); // Remove trailing hyphens
    return slug || 'media';
  }
  
  if (!text) return '';
  
  // Remove URLs first
  let cleanText = text;
  const urls = extractUrls(text);
  urls.forEach(url => {
    cleanText = cleanText.replace(url, '').trim();
  });
  
  // If only URLs, extract meaningful text from first URL
  if (!cleanText.trim() && urls.length > 0) {
    cleanText = extractUrlSlug(urls[0]);
  }
  
  // Limit to 17 characters
  const slug = cleanText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with one
    .trim()
    .substring(0, 17)
    .replace(/-+$/, ''); // Remove trailing hyphens
  
  return slug || 'entry';
}

// Extract meaningful text from URL (first 10 chars, skip protocol/domain)
function extractUrlSlug(url) {
  try {
    const urlObj = new URL(url);
    // Get pathname + search, or hostname if no path
    let meaningful = urlObj.pathname + urlObj.search;
    
    // Remove leading slash
    meaningful = meaningful.replace(/^\//, '');
    
    // If no path, use hostname but remove common TLDs
    if (!meaningful || meaningful === '/') {
      meaningful = urlObj.hostname
        .replace(/^www\./, '')
        .replace(/\.(com|org|net|edu|gov|io|co|ai)$/, '');
    }
    
    // Extract first 10 characters that are alphanumeric
    const clean = meaningful
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10);
    
    return clean || 'link';
  } catch {
    // Fallback: extract first 10 alphanumeric chars from URL
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10) || 'link';
  }
}

async function generateLinkCard(url) {
  try {
    const response = await fetch('/api/generate-link-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate card');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error generating link card:', error);
    return null;
  }
}

function createLinkCardPlaceholder(url) {
  const placeholder = document.createElement('div');
  placeholder.className = 'link-card-placeholder';
  placeholder.dataset.url = url;
  
  const placeholderContent = `
    <div class="link-card-placeholder-content">
      <div class="link-card-placeholder-url">${escapeHtml(url)}</div>
      <div class="link-card-placeholder-loading">Loading...</div>
    </div>
  `;
  
  placeholder.innerHTML = placeholderContent;
  
  // Change cursor to pointer when hovering over link-card placeholder
  placeholder.addEventListener('mouseenter', (e) => {
    const entry = placeholder.closest('.entry');
    if (entry) {
      entry.classList.add('has-link-card-hover');
    }
  });
  
  placeholder.addEventListener('mouseleave', (e) => {
    const entry = placeholder.closest('.entry');
    if (entry) {
      entry.classList.remove('has-link-card-hover');
    }
  });
  
  placeholder.addEventListener('mousedown', (e) => {
    // Allow shift+click to propagate for dragging
    if (!e.shiftKey) {
      e.stopPropagation();
    }
  });
  placeholder.addEventListener('dblclick', (e) => {
    e.stopPropagation();
  });
  
  return placeholder;
}

function createLinkCard(cardData) {
  const card = document.createElement('div');
  const isYouTube = cardData.isVideo && cardData.videoId;

  if (isYouTube) {
    card.className = 'link-card link-card-yt';
    card.dataset.videoId = cardData.videoId;
    card.dataset.isVideo = 'true';
  } else {
    card.className = cardData.image ? 'link-card' : 'link-card link-card-no-image';
  }

  card.dataset.url = cardData.url;
  card.dataset.title = cardData.title;
  card.dataset.siteName = cardData.siteName;
  card.dataset.description = cardData.description || '';

  let cardContent;
  if (isYouTube) {
    cardContent = `
      <div class="link-card-yt-thumb" style="background-image: url('${cardData.image}')">
        <div class="link-card-yt-play"><span></span></div>
      </div>
      <div class="link-card-content">
        <div class="link-card-yt-channel">${escapeHtml(cardData.description || '')}</div>
        <div class="link-card-title">${escapeHtml(cardData.title)}</div>
      </div>
    `;
  } else {
    cardContent = `
      ${cardData.image ? `<div class="link-card-image" style="background-image: url('${cardData.image}')"></div>` : ''}
      <div class="link-card-content">
        <div class="link-card-site">${escapeHtml(cardData.siteName)}</div>
        <div class="link-card-title">${escapeHtml(cardData.title)}</div>
        ${cardData.description ? `<div class="link-card-description">${escapeHtml(cardData.description)}</div>` : ''}
      </div>
    `;
  }

  card.innerHTML = cardContent;
  
  // Change cursor to pointer when hovering over link-card
  card.addEventListener('mouseenter', (e) => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.add('has-link-card-hover');
    }
  });
  
  card.addEventListener('mouseleave', (e) => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.remove('has-link-card-hover');
    }
  });
  
  // Single click: Command/Ctrl + click opens link in new tab
  card.addEventListener('click', (e) => {
    // Don't handle click if shift was held (shift+click is for dragging)
    // Also don't handle if we just finished dragging (prevents navigation after drag)
    if (e.shiftKey || justFinishedDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    e.stopPropagation();
    
    // Command/Ctrl + click: open link
    if (e.metaKey || e.ctrlKey) {
      window.open(cardData.url, '_blank');
      return;
    }
    
    // Regular single click does nothing (allows dragging)
  });
  
  // Double click: create entry and navigate to it (like text entries)
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Regular double-click: create entry and navigate to it
    const entryText = cardData.url;
    
    // Check for duplicate entry at the same directory level
    const duplicateId = findDuplicateEntry(entryText, currentViewEntryId, null);
    if (duplicateId) {
      // Navigate to existing entry instead of creating duplicate
      navigateToEntry(duplicateId);
      return;
    }
    
    const entryId = `entry-${entryIdCounter++}`;
    const entry = document.createElement('div');
    entry.className = 'entry melt';
    entry.id = entryId;
    
    // Position the new entry near the card
    const cardRect = card.getBoundingClientRect();
    const cardWorldPos = screenToWorld(cardRect.left, cardRect.top);
    const offsetX = 300; // Offset to the right of the card
    const offsetY = 0;
    
    entry.style.left = `${cardWorldPos.x + offsetX}px`;
    entry.style.top = `${cardWorldPos.y + offsetY}px`;
    entry.style.width = '400px';
    entry.style.minHeight = '60px';
    
    // Create entry text from link card data
    entry.innerHTML = meltify(entryText);
    world.appendChild(entry);
    
    // Store entry data
    const entryData = {
      id: entryId,
      element: entry,
      text: entryText,
      position: { x: cardWorldPos.x + offsetX, y: cardWorldPos.y + offsetY },
      parentEntryId: currentViewEntryId
    };
    entries.set(entryId, entryData);
    
    // Save to server
    saveEntryToServer(entryData);
    
    // Navigate to the new entry
    navigateToEntry(entryId);
    
    // Remove melt class after animation
    const maxDuration = 1500;
    setTimeout(() => {
      entry.classList.remove('melt');
      const spans = entry.querySelectorAll('span');
      spans.forEach(span => {
        span.style.animation = 'none';
        span.style.transform = '';
        span.style.filter = '';
        span.style.opacity = '';
      });
    }, maxDuration);
  });
  card.addEventListener('mousedown', (e) => {
    // Allow mousedown to bubble for dragging (both regular and shift+click)
    // The entry handler will handle the drag, and we prevent unwanted click behavior in the click handler
    // Don't stop propagation here - let dragging work
  });
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Don't allow editing in read-only mode
    if (isReadOnly) return;
    
    // Right-click: edit the parent entry with the card's URL as text
    const entryEl = findEntryElement(card);
    if (entryEl && entryEl.id !== 'anchor' && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const rect = entryEl.getBoundingClientRect();
        const worldPos = screenToWorld(rect.left, rect.top);
        // Edit with the card's URL as the text
        placeEditorAtWorld(worldPos.x, worldPos.y, cardData.url, entryEl.id);
      }
    }
  });
  
  return card;
}

function processTextWithLinks(text) {
  const urls = extractUrls(text);
  let processedText = text;
  
  // Remove URLs from text (they'll be shown as cards)
  urls.forEach((url) => {
    processedText = processedText.replace(url, '').trim();
  });
  
  // Clean up multiple spaces but preserve newlines
  // Replace multiple spaces (but not newlines) with single space
  processedText = processedText.replace(/[ \t]+/g, ' ');
  // Clean up multiple consecutive newlines (keep single newlines)
  processedText = processedText.replace(/\n{3,}/g, '\n\n');
  // Trim trailing whitespace from each line, but preserve line structure
  processedText = processedText.split('\n').map(line => line.trimEnd()).join('\n').trim();
  
  return { processedText, urls };
}

// Helper to find entry element from event target
function findEntryElement(target) {
  let el = target;
  while (el && el !== world) {
    if (el.classList && (el.classList.contains('entry') || el.id === 'anchor')) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function isImageEntry(entryEl) {
  if (!entryEl || !entryEl.id || entryEl.id === 'anchor') return false;
  const data = entries.get(entryEl.id);
  return data && data.mediaCardData && data.mediaCardData.type === 'image';
}

function isFileEntry(entryEl) {
  if (!entryEl || !entryEl.id || entryEl.id === 'anchor') return false;
  const data = entries.get(entryEl.id);
  return data && data.mediaCardData && data.mediaCardData.type === 'file';
}

function selectOnlyEntry(entryId) {
  clearSelection();
  const entryData = entries.get(entryId);
  if (entryData && entryData.element) {
    selectedEntries.add(entryId);
    entryData.element.classList.add('selected');
    hideCursor();
  }
}

// ——— Image Resize Handle System ———
let resizeSelectedEntry = null;
let resizeState = null;

function showResizeHandles(entryEl) {
  if (resizeSelectedEntry === entryEl) return;
  hideResizeHandles();
  resizeSelectedEntry = entryEl;
  entryEl.classList.add('resize-selected');
  ['nw', 'ne', 'sw', 'se'].forEach(corner => {
    const h = document.createElement('div');
    h.className = `resize-handle ${corner}`;
    h.dataset.corner = corner;
    entryEl.appendChild(h);
  });
}

function hideResizeHandles() {
  if (!resizeSelectedEntry) return;
  resizeSelectedEntry.classList.remove('resize-selected');
  resizeSelectedEntry.querySelectorAll('.resize-handle').forEach(h => h.remove());
  resizeSelectedEntry = null;
  resizeState = null;
}

function initResizeDrag(e, handle, entryEl) {
  e.preventDefault();
  e.stopPropagation();
  const img = entryEl.querySelector('img');
  if (!img) return;
  const aspect = (img.naturalWidth || img.offsetWidth) / (img.naturalHeight || img.offsetHeight) || 1;
  const rect = entryEl.getBoundingClientRect();
  resizeState = {
    entry: entryEl,
    img: img,
    corner: handle.dataset.corner,
    startX: e.clientX,
    startY: e.clientY,
    startW: rect.width / cam.z,
    startH: rect.height / cam.z,
    aspect: aspect,
    startLeft: parseFloat(entryEl.style.left) || 0,
    startTop: parseFloat(entryEl.style.top) || 0
  };
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e) {
  if (!resizeState) return;
  const { entry, img, corner, startX, startY, startW, startH, aspect, startLeft, startTop } = resizeState;
  const dx = (e.clientX - startX) / cam.z;
  const dy = (e.clientY - startY) / cam.z;
  let newW = startW;
  if (corner === 'se' || corner === 'ne') newW = startW + dx;
  else newW = startW - dx;
  newW = Math.max(60, newW);
  const newH = newW / aspect;
  img.style.width = `${newW}px`;
  img.style.height = `${newH}px`;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  entry.style.setProperty('width', `${newW}px`, 'important');
  entry.style.setProperty('height', `${newH}px`, 'important');
  if (corner === 'nw' || corner === 'sw') {
    entry.style.left = `${startLeft + (startW - newW)}px`;
  }
  if (corner === 'nw' || corner === 'ne') {
    entry.style.top = `${startTop + (startH - newH)}px`;
  }
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  if (!resizeState) return;
  const { entry, img } = resizeState;
  const finalW = parseFloat(img.style.width);
  const finalH = parseFloat(img.style.height);
  updateEntryDimensions(entry);
  const entryData = entries.get(entry.id);
  if (entryData) {
    entryData.position = { x: parseFloat(entry.style.left) || 0, y: parseFloat(entry.style.top) || 0 };
    if (!entryData.mediaCardData) entryData.mediaCardData = {};
    entryData.mediaCardData.customWidth = finalW;
    entryData.mediaCardData.customHeight = finalH;
    updateEntryOnServer(entryData);
  }
  resizeState = null;
}

async function createImageEntryAtWorld(worldX, worldY, imageUrl) {
  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = 'entry canvas-image';
  entry.id = entryId;
  entry.style.left = `${worldX}px`;
  entry.style.top = `${worldY}px`;
  entry.style.width = '200px';
  entry.style.height = '150px';
  const img = document.createElement('img');
  img.src = getThumbUrl(imageUrl);
  img.dataset.fullSrc = imageUrl;
  img.alt = 'Canvas image';
  img.draggable = false;
  img.decoding = 'async';
  img.onload = () => updateEntryDimensions(entry);
  img.onerror = function() { if (this.src !== imageUrl) { this.src = imageUrl; } else { updateEntryDimensions(entry); } };
  entry.appendChild(img);
  world.appendChild(entry);
  const entryData = {
    id: entryId,
    element: entry,
    text: '',
    position: { x: worldX, y: worldY },
    parentEntryId: currentViewEntryId,
    mediaCardData: { type: 'image', url: imageUrl }
  };
  entries.set(entryId, entryData);
  updateEntryVisibility();
  setTimeout(() => updateEntryDimensions(entry), 50);
  await saveEntryToServer(entryData);
  return entryData;
}

// Click to type / Drag entries
let clickStart = null;
let isClick = false;
let dragThreshold = 5; // Pixels to move before starting drag
let hasMoved = false;

viewport.addEventListener('mousedown', (e) => {
  // Resize handle: intercept before anything else
  const resizeHandle = e.target.closest('.resize-handle');
  if (resizeHandle && resizeSelectedEntry) {
    initResizeDrag(e, resizeHandle, resizeSelectedEntry);
    return;
  }
  // Click outside resize-selected image: deselect handles
  if (resizeSelectedEntry && !e.target.closest('.resize-selected')) {
    hideResizeHandles();
  }
  // Shift+drag to select: if in edit mode, save & close editor then start selection.
  // We handle this inline instead of calling commitEditor() to avoid the
  // delete-on-empty logic which can misfire when e.preventDefault() disrupts
  // the editor DOM during mousedown.
  if(e.shiftKey && editingEntryId) {
    e.preventDefault();
    const entryData = entries.get(editingEntryId);
    const raw = editor.innerText;
    const trimmedRight = raw.replace(/\s+$/g,'');
    const htmlContent = editor.innerHTML;
    if(entryData) {
      const hasCards =
        !!entryData.mediaCardData ||
        (Array.isArray(entryData.linkCardsData) && entryData.linkCardsData.length > 0) ||
        !!entryData.element.querySelector('.link-card, .link-card-placeholder, .media-card');
      entryData.element.classList.remove('editing', 'deadline-editing');
      if(trimmedRight) {
        const isDeadline = htmlContent.includes('deadline-table');
        const isCalendarCard = htmlContent.includes('gcal-card');
        const hasFmt = isDeadline || isCalendarCard || /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(htmlContent);
        entryData.text = trimmedRight;
        entryData.textHtml = hasFmt ? htmlContent : null;
        if (isDeadline) {
          entryData.element.innerHTML = htmlContent;
        } else if (isCalendarCard) {
          entryData.element.innerHTML = htmlContent;
          const card = entryData.element.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        } else if (!hasCards) {
          const { processedText } = processTextWithLinks(trimmedRight);
          entryData.element.innerHTML = hasFmt ? meltifyHtml(htmlContent) : meltify(processedText || '');
        }
        applyEntryFontSize(entryData.element, hasFmt ? htmlContent : null);
        updateEntryDimensions(entryData.element);
        updateEntryOnServer(entryData);
      }
      // If trimmedRight is empty, entry keeps its existing saved data — no delete
    }
    // Close editor
    editingEntryId = null;
    editor.removeEventListener('keydown', handleDeadlineTableKeydown);
    editor.textContent = '';
    editor.innerHTML = '';
    editor.style.display = 'none';
    if(formatBar) formatBar.classList.add('hidden');
    // Start selection
    isSelecting = true;
    selectionStart = screenToWorld(e.clientX, e.clientY);
    if(!selectionBox){
      selectionBox = document.createElement('div');
      selectionBox.className = 'selection-box';
      viewport.appendChild(selectionBox);
    }
    selectionBox.style.display = 'block';
    const startScreen = worldToScreen(selectionStart.x, selectionStart.y);
    selectionBox.style.left = `${startScreen.x}px`;
    selectionBox.style.top = `${startScreen.y}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    clearSelection();
    return;
  }
  if(e.target === editor || editor.contains(e.target)) return;
  // Don't handle clicks on breadcrumb
  if(e.target.closest('#breadcrumb')) return;
  // Don't handle clicks on background picker
  if(e.target.closest('#bg-picker-button, #bg-picker-dropdown, #bg-upload-input')) return;
  // Research entries are normal entries — no special guard needed
  
  // Set flag to prevent cursor updates during click handling
  // This prevents cursor from appearing in random spot when clicking
  isProcessingClick = true;
  
  // In read-only mode, only allow panning (no entry dragging)
  if (isReadOnly) {
    const entryEl = findEntryElement(e.target);
    if (!entryEl) {
      // Start panning viewport (only if not clicking on entry)
      dragging = true;
      viewport.classList.add('dragging');
      last = { x: e.clientX, y: e.clientY };
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    } else {
      // Track click on entry for navigation (but don't start dragging)
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now(), entryEl: entryEl, button: e.button };
    }
    return;
  }
  
  // Normal mode: allow editing and dragging
  const entryEl = findEntryElement(e.target);

  // Shift+drag for selection box (works from anywhere — empty space or on an entry)
  if(e.shiftKey){
    e.preventDefault();

    // If currently editing, commit and exit edit mode first
    if(editingEntryId){
      commitEditor();
    }

    isSelecting = true;
    selectionStart = screenToWorld(e.clientX, e.clientY);

    // Create selection box element
    if(!selectionBox){
      selectionBox = document.createElement('div');
      selectionBox.className = 'selection-box';
      viewport.appendChild(selectionBox);
    }

    selectionBox.style.display = 'block';
    const startScreen = worldToScreen(selectionStart.x, selectionStart.y);
    selectionBox.style.left = `${startScreen.x}px`;
    selectionBox.style.top = `${startScreen.y}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';

    // Clear existing selection
    clearSelection();
    return;
  }

  if (entryEl) {
    // Right-click (button 2) is handled by contextmenu — DO NOT treat as empty-space drag.
    // Also store clickStart so mouseup won't place the cursor elsewhere.
    if (e.button === 2) {
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now(), entryEl: entryEl, button: e.button };
      isProcessingClick = false;
      return;
    }

    // Allow dragging when clicking on link card or media card too
    const isLinkCard = e.target.closest('.link-card, .link-card-placeholder');
    const isMediaCard = e.target.closest('.media-card');

    // Cancel any pending edit timeout since we're starting to drag
    if (pendingEditTimeout) {
      clearTimeout(pendingEditTimeout);
      pendingEditTimeout = null;
    }

    // Prepare for drag - always allow dragging entries (no shift needed)
    // This works for both regular entry clicks and card clicks
    const isEntrySelected = selectedEntries.has(entryEl.id);
    e.preventDefault();
    e.stopPropagation(); // Stop event from being handled elsewhere
    draggingEntry = entryEl;
    isClick = false;
    hasMoved = false;
      
      // Save initial positions for undo (for single entry and selected entries)
      dragStartPositions.clear();
      const entriesToTrack = isEntrySelected ? Array.from(selectedEntries).map(id => entries.get(id)).filter(Boolean) : [entries.get(entryEl.id)].filter(Boolean);
      entriesToTrack.forEach(entryData => {
        if (entryData) {
          dragStartPositions.set(entryData.id, { ...entryData.position });
        }
      });
      
      // Set cursor to move for the entry and all its children (including link cards)
      entryEl.style.cursor = 'move';
      const linkCards = entryEl.querySelectorAll('.link-card, .link-card-placeholder, .media-card');
      linkCards.forEach(card => {
        card.style.cursor = 'move';
      });
      
      // Calculate offset from mouse to entry position in world coordinates
      const entryRect = entryEl.getBoundingClientRect();
      const entryWorldPos = screenToWorld(entryRect.left, entryRect.top);
      const mouseWorldPos = screenToWorld(e.clientX, e.clientY);
      dragOffset.x = mouseWorldPos.x - entryWorldPos.x;
      dragOffset.y = mouseWorldPos.y - entryWorldPos.y;
      
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now(), entryEl: entryEl, button: e.button };
      
      console.log('[DRAG] Starting drag on entry:', entryEl.id, 'from target:', e.target);
  } else {
    // Start panning viewport (or prepare for click on empty space)
    dragging = true;
    viewport.classList.add('dragging');
    last = { x: e.clientX, y: e.clientY };
    clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    console.log('[MOUSEDOWN] Click on empty space - dragging set to true');
  }
});

viewport.addEventListener('mousemove', (e) => {
  // Track mouse position for typing without clicking
  currentMousePos = { x: e.clientX, y: e.clientY };
  
  // In read-only mode, only allow panning (no entry dragging)
  if (isReadOnly) {
    if (dragging) {
      // Pan viewport
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      cam.x += dx;
      cam.y += dy;
      applyTransform();
      isClick = false;
    }
    return;
  }
  
  // Handle selection box dragging
  if(isSelecting && selectionStart){
    const currentWorld = screenToWorld(e.clientX, e.clientY);
    
    // Calculate box dimensions in world coordinates
    const minX = Math.min(selectionStart.x, currentWorld.x);
    const minY = Math.min(selectionStart.y, currentWorld.y);
    const maxX = Math.max(selectionStart.x, currentWorld.x);
    const maxY = Math.max(selectionStart.y, currentWorld.y);
    
    // Convert to screen coordinates for the selection box element
    const topLeft = worldToScreen(minX, minY);
    const bottomRight = worldToScreen(maxX, maxY);
    
    selectionBox.style.left = `${topLeft.x}px`;
    selectionBox.style.top = `${topLeft.y}px`;
    selectionBox.style.width = `${bottomRight.x - topLeft.x}px`;
    selectionBox.style.height = `${bottomRight.y - topLeft.y}px`;
    
    // Highlight entries within the selection box
    selectEntriesInBox(minX, minY, maxX, maxY);
    return;
  }
  
  // Normal mode: allow entry dragging
  if(draggingEntry) {
    // Always allow dragging (no shift needed)
    const isEntrySelected = selectedEntries.has(draggingEntry.id);
    
    // Check if we've moved enough to start dragging
    if(clickStart){
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      if(dist > dragThreshold){
        hasMoved = true;
      }
    }
    
    // Only drag if we've moved past the threshold
    if(hasMoved){
      e.preventDefault();
      const mouseWorldPos = screenToWorld(e.clientX, e.clientY);
      const newX = mouseWorldPos.x - dragOffset.x;
      const newY = mouseWorldPos.y - dragOffset.y;
      
      // If dragging a selected entry, move all selected entries
      const entryId = draggingEntry.id;
      const isDraggingSelected = selectedEntries.has(entryId);
      
      if(isDraggingSelected && selectedEntries.size > 1) {
        // Calculate drag delta
        const entryData = entries.get(entryId);
        if(entryData) {
          const deltaX = newX - entryData.position.x;
          const deltaY = newY - entryData.position.y;
          
          // Move all selected entries by the same delta
          selectedEntries.forEach(selectedId => {
            const selectedData = entries.get(selectedId);
            if(selectedData && selectedData.element) {
              const selectedNewX = selectedData.position.x + deltaX;
              const selectedNewY = selectedData.position.y + deltaY;
              selectedData.element.style.left = `${selectedNewX}px`;
              selectedData.element.style.top = `${selectedNewY}px`;
              selectedData.position = { x: selectedNewX, y: selectedNewY };

              // If this selected entry is in edit mode, also move the editor to match
              if(editingEntryId === selectedId && editor.style.display !== 'none') {
                editorWorldPos = { x: selectedNewX, y: selectedNewY };
                // Account for editor's left padding (4px)
                editor.style.left = `${selectedNewX - 4}px`;
                editor.style.top = `${selectedNewY}px`;
              }
              // Update research SVG lines
              updateResearchLinePositions(selectedId);
            }
          });
        }
      } else {
        // Just move the single entry
      draggingEntry.style.left = `${newX}px`;
      draggingEntry.style.top = `${newY}px`;
      
      // Update stored position
      if(entryId === 'anchor') {
        anchorPos.x = newX;
        anchorPos.y = newY;
      } else {
        const entryData = entries.get(entryId);
        if(entryData) {
          console.log('[DRAG] Updating position for entry:', entryId, 'from', entryData.position, 'to', { x: newX, y: newY });
          entryData.position = { x: newX, y: newY };

          // If this entry is in edit mode, also move the editor to match
          if(editingEntryId === entryId && editor.style.display !== 'none') {
            editorWorldPos = { x: newX, y: newY };
            // Account for editor's left padding (4px)
            editor.style.left = `${newX - 4}px`;
            editor.style.top = `${newY}px`;
          }

          // Update research SVG lines
          updateResearchLinePositions(entryId);

          // Debounce position saves to avoid too many server requests
          if (entryData.positionSaveTimeout) {
            clearTimeout(entryData.positionSaveTimeout);
          }
          entryData.positionSaveTimeout = setTimeout(() => {
            updateEntryOnServer(entryData).catch(err => {
              console.error('Error saving position:', err);
            });
            entryData.positionSaveTimeout = null;
          }, 300); // Wait 300ms after dragging stops before saving
          }
        }
      }
    }
    
    isClick = false;
  } else if(dragging) {
    // Pan viewport
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    cam.x += dx;
    cam.y += dy;
    applyTransform();
    isClick = false;
  }
});

window.addEventListener('mouseup', async (e) => {
  // Handle selection box completion
  if(isSelecting){
    isSelecting = false;
    if(selectionBox){
      selectionBox.style.display = 'none';
    }
    selectionStart = null;
    // Keep the selected entries highlighted
    return;
  }
  
  // In read-only mode, only handle navigation clicks
  if (isReadOnly) {
    if (dragging) {
      dragging = false;
      viewport.classList.remove('dragging');
      clickStart = null;
      return;
    }
    
    // Only handle clicks on entries for navigation
    if (clickStart && clickStart.entryEl) {
      // Skip navigation if this was a right-click
      if (e.button !== 2 && clickStart.button !== 2) {
        const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
        const dt = performance.now() - clickStart.t;
        const isClick = (dist < dragThreshold && dt < 350);
        
        if (isClick) {
          const entryEl = clickStart.entryEl;
          
          // Command/Ctrl + click: open link in browser
          if ((e.metaKey || e.ctrlKey) && entryEl.id !== 'anchor' && entryEl.id) {
            const entryData = entries.get(entryEl.id);
            if (entryData) {
              const urls = extractUrls(entryData.text);
              if (urls.length > 0) {
                window.open(urls[0], '_blank');
              }
            }
          } 
          // Regular click: navigate to entry (open breadcrumb)
          // But don't navigate if we're currently editing
          else if (entryEl.id !== 'anchor' && entryEl.id && !editingEntryId) {
            navigateToEntry(entryEl.id);
          }
        }
      }
    }
    
    clickStart = null;
    return;
  }
  
  // Normal mode: allow all interactions
  if(draggingEntry) {
    // Mark that we just finished dragging (even if no movement, shift+click means drag attempt)
    if(hasMoved || e.shiftKey) {
      justFinishedDragging = true;
      // Clear flag after a short delay to allow click event to check it
      setTimeout(() => {
        justFinishedDragging = false;
      }, 100);
    }
    
    // Only reset if we didn't actually drag
    if(!hasMoved){
      // Check if it was a click (no movement)
      if(clickStart) {
        const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
        const dt = performance.now() - clickStart.t;
        isClick = (dist < dragThreshold && dt < 350);
        
        // Edit entry if it was a click (not a drag). Images: only select, no edit.
        // Skip right-click (button 2) — the contextmenu handler handles that.
        if(isClick && e.button !== 2 && draggingEntry.id !== 'anchor' && draggingEntry.id && !isReadOnly) {
          const entryData = entries.get(draggingEntry.id);
          if(entryData) {
            // Cmd/Ctrl+click: toggle entry in multi-selection
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
              const eid = draggingEntry.id;
              // Check if this entry has a URL — if so, open it (existing behavior)
              const urls = extractUrls(entryData.text);
              if (urls.length > 0) {
                window.open(urls[0], '_blank');
              } else {
                // Toggle selection
                if (selectedEntries.has(eid)) {
                  selectedEntries.delete(eid);
                  entryData.element.classList.remove('selected');
                  if (selectedEntries.size === 0) showCursorInDefaultPosition();
                } else {
                  selectedEntries.add(eid);
                  entryData.element.classList.add('selected');
                  hideCursor();
                }
              }
            } else if(isImageEntry(draggingEntry)) {
              selectOnlyEntry(draggingEntry.id);
              showResizeHandles(draggingEntry);
            } else if(isFileEntry(draggingEntry)) {
              selectOnlyEntry(draggingEntry.id);
            } else if(draggingEntry.querySelector('.gcal-card')) {
              // Calendar card: no edit mode, do nothing on click
            } else if(draggingEntry.querySelector('.deadline-table')) {
              const alreadyEditing = editingEntryId === draggingEntry.id;
              if (!alreadyEditing) {
                if (editor && (editor.textContent.trim() || editingEntryId)) {
                  await commitEditor();
                }
                const rect = draggingEntry.getBoundingClientRect();
                const worldPos = screenToWorld(rect.left, rect.top);
                placeEditorAtWorld(worldPos.x, worldPos.y, entryData.text, draggingEntry.id);
              }
              // Focus the nearest cell at the original click position
              const cx = clickStart ? clickStart.x : e.clientX;
              const cy = clickStart ? clickStart.y : e.clientY;
              requestAnimationFrame(() => {
                const table = editor.querySelector('.deadline-table');
                if (table) {
                  // Check if click was on an interactive element (dot, badge, ghost)
                  const elAtPoint = document.elementFromPoint(cx, cy);
                  if (elAtPoint) {
                    const dot = elAtPoint.closest('.deadline-dot');
                    const badge = elAtPoint.closest('.status-badge');
                    const ghost = elAtPoint.closest('.deadline-ghost-row');
                    if (dot) { dot.click(); return; }
                    if (badge) { badge.click(); return; }
                    if (ghost) { ghost.click(); return; }
                  }
                  focusNearestDeadlineCell(table, cx, cy);
                }
              });
            } else if (researchModeEnabled) {
              // Research mode: just spawn research, don't open editor
              spawnResearchEntries(draggingEntry.id);
            } else {
              // If currently editing, commit first and wait for it to complete
              if (editor && (editor.textContent.trim() || editingEntryId)) {
                await commitEditor();
              }

              const rect = draggingEntry.getBoundingClientRect();
              const worldPos = screenToWorld(rect.left, rect.top);
              const entryIdToEdit = draggingEntry.id;
              const textToEdit = entryData.text;
              if (pendingEditTimeout) {
                clearTimeout(pendingEditTimeout);
              }
              pendingEditTimeout = setTimeout(() => {
                pendingEditTimeout = null;
                if (entryIdToEdit !== 'anchor') {
                  placeEditorAtWorld(worldPos.x, worldPos.y, textToEdit, entryIdToEdit);
                }
              }, 300);
            }
          }
        }
      }
    }
    
    // Reset cursor for entry and link cards
    if(draggingEntry) {
      draggingEntry.style.cursor = '';
      const linkCards = draggingEntry.querySelectorAll('.link-card, .link-card-placeholder');
      linkCards.forEach(card => {
        card.style.cursor = '';
      });
    }
    
    // Save final position immediately when dragging ends
    if (draggingEntry && draggingEntry.id !== 'anchor' && hasMoved) {
      const entryData = entries.get(draggingEntry.id);
      if (entryData) {
        console.log('[DRAG END] Saving final position for entry:', draggingEntry.id, 'position:', entryData.position);
        
        // Save undo state for moved entries
        const moves = [];
        const isEntrySelected = selectedEntries.has(draggingEntry.id);
        const entriesToSave = isEntrySelected ? Array.from(selectedEntries).map(id => entries.get(id)).filter(Boolean) : [entryData];
        
        entriesToSave.forEach(ed => {
          const oldPosition = dragStartPositions.get(ed.id);
          if (oldPosition && (oldPosition.x !== ed.position.x || oldPosition.y !== ed.position.y)) {
            moves.push({ entryId: ed.id, oldPosition });
          }
        });
        
        if (moves.length > 0) {
          saveUndoState('move', { moves });
        }
        
        // Clear any pending debounced save
        if (entryData.positionSaveTimeout) {
          clearTimeout(entryData.positionSaveTimeout);
          entryData.positionSaveTimeout = null;
        }
        // Save final position immediately
        updateEntryOnServer(entryData).catch(err => {
          console.error('Error saving final position:', err);
        });
        
        // Also save selected entries if dragging multiple
        if (isEntrySelected) {
          for (const selectedId of selectedEntries) {
            if (selectedId !== draggingEntry.id) {
              const selectedData = entries.get(selectedId);
              if (selectedData) {
                updateEntryOnServer(selectedData).catch(err => {
                  console.error('Error saving selected entry position:', err);
                });
              }
            }
          }
        }
      } else {
        console.error('[DRAG END] ERROR: Could not find entry data for:', draggingEntry.id, 'Available entries:', Array.from(entries.keys()));
      }
    }
    
    draggingEntry = null;
    clickStart = null;
    hasMoved = false;
    dragStartPositions.clear();
  } else if(dragging) {
    dragging = false;
    viewport.classList.remove('dragging');
    
    // Check if it was a click (no movement) - place editor
    // Always allow clicking to place cursor, even during navigation
    if(clickStart) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;
      console.log('[MOUSEUP] Dragging ended. dist:', dist, 'dt:', dt, 'isClick:', isClick);
      if(dist < 6 && dt < 350 && !isClick){
        console.log('[MOUSEUP] Detected as click on empty space');
        // Research entries are real — no special cleanup on empty click
        // Clear selection if clicking on empty space (no shift key)
        if (!e.shiftKey && selectedEntries.size > 0) {
          clearSelection();
        }
        
        const w = screenToWorld(e.clientX, e.clientY);
        
        // Store click position for typing
        lastClickPos = { x: w.x, y: w.y };
        // Mark that user clicked - typing should happen at click position, not hover
        hasClickedRecently = true;
        // Clear stored cursor position - user clicked, so don't restore old position
        cursorPosBeforeEdit = null;
        // Clear the flag after a short delay to allow hover typing again
        setTimeout(() => {
          hasClickedRecently = false;
        }, 100);
        
        // ALWAYS place editor/cursor at exact click position - this is the superceding rule
        // Clear navigation flags so user can type immediately
        navigationJustCompleted = false;
        isNavigating = false; // Also clear isNavigating to allow blur handler to commit
        
        // If currently editing an entry or editor has content, commit before moving cursor
        // Must commit synchronously here because placeEditorAtWorld will clear editor content
        if (editingEntryId || editor.textContent.trim()) {
          console.log('[CLICK] Committing current edit before moving cursor');
          await commitEditor();
        }

        // Always place cursor at click position, even during navigation
        // Use force=true to ensure cursor is visible and ready
        placeEditorAtWorld(w.x, w.y, '', null, true); // force = true to allow during navigation
        
        // Clear the processing flag after cursor is placed
        requestAnimationFrame(() => {
          isProcessingClick = false;
        });
      } else {
        // Not a click (was a drag) - clear the flag
        isProcessingClick = false;
      }
    } else {
      // No clickStart - clear the flag
      isProcessingClick = false;
    }
    clickStart = null;
  } else if(clickStart && clickStart.entryEl) {
    if (e.button !== 2 && clickStart.button !== 2) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;
      const isClick = (dist < dragThreshold && dt < 350);

      if (isClick) {
        const entryEl = clickStart.entryEl;
        if (isImageEntry(entryEl) || isFileEntry(entryEl)) {
          selectOnlyEntry(entryEl.id);
          clickStart = null;
          return;
        }
        if ((e.metaKey || e.ctrlKey) && entryEl.id !== 'anchor' && entryEl.id) {
          const entryData = entries.get(entryEl.id);
          if (entryData) {
            const urls = extractUrls(entryData.text);
            if (urls.length > 0) window.open(urls[0], '_blank');
          }
        } else if (entryEl.id !== 'anchor' && entryEl.id && !editingEntryId && !entryEl.querySelector('.deadline-table') && !entryEl.querySelector('.gcal-card')) {
          navigateToEntry(entryEl.id);
        }
      }
    }
    clickStart = null;
  }
});

viewport.addEventListener('dblclick', (e) => {
  if (isReadOnly) return;
  // Research entries are normal entries — no special guard needed
  if (pendingEditTimeout) {
    clearTimeout(pendingEditTimeout);
    pendingEditTimeout = null;
  }
  const entryEl = findEntryElement(e.target);
  if (e.target.closest('.link-card, .link-card-placeholder, .media-card')) return;
  if (entryEl && (entryEl.querySelector('.deadline-table') || entryEl.querySelector('.gcal-card'))) return;
  if (entryEl && entryEl.id !== 'anchor' && entryEl.id && !editingEntryId) {
    e.preventDefault();
    e.stopPropagation();
    navigateToEntry(entryEl.id);
  }
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();

  const mouse = { x: e.clientX, y: e.clientY };
  const before = screenToWorld(mouse.x, mouse.y);

  const delta = -e.deltaY;
  const zoomFactor = Math.exp(delta * 0.0012);

  const newZ = clamp(cam.z * zoomFactor, 0.12, 8);
  cam.z = newZ;

  const after = screenToWorld(mouse.x, mouse.y);

  cam.x += (after.x - before.x) * cam.z;
  cam.y += (after.y - before.y) * cam.z;

  applyTransform();
}, { passive: false });

editor.addEventListener('keydown', (e) => {
  // Handle autocomplete keyboard navigation
  if (autocomplete && !autocomplete.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteKeyboardNavigation = true; // User is using keyboard to navigate
      autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, autocompleteResults.length - 1);
      updateAutocompleteSelection();
      const selectedItem = autocomplete.querySelector(`[data-index="${autocompleteSelectedIndex}"]`);
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteKeyboardNavigation = true; // User is using keyboard to navigate
      autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, -1);
      updateAutocompleteSelection();
      return;
    } else if (e.key === 'Enter' && autocompleteSelectedIndex >= 0 && !e.shiftKey && autocompleteKeyboardNavigation) {
      // Only select on Enter if user explicitly navigated with keyboard (not just hover)
      e.preventDefault();
      selectAutocompleteResult(autocompleteResults[autocompleteSelectedIndex]);
      return;
    } else if (e.key === 'Escape') {
      hideAutocomplete();
      return;
    }
  }

  // Command/Ctrl+B to toggle bold
  if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    // Toggle bold using execCommand
    document.execCommand('bold', false, null);
    return;
  }
  
  // Allow Command/Ctrl+Shift+1 to navigate home even when editor is focused
  const isOneKey = e.key === '1' || e.key === 'Digit1' || e.code === 'Digit1';
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && isOneKey) {
    e.preventDefault();
    e.stopPropagation();
    navigateToRoot();
    return;
  }
  
  // Handle space after dash to create bullet point
  if (e.key === ' ' && !e.shiftKey) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;
      const offset = range.startOffset;
      
      // Get full text and cursor position
      const fullText = editor.innerText || editor.textContent || '';
      let cursorPos = 0;
      
      // Calculate cursor position in full text
      if (textNode.nodeType === Node.TEXT_NODE) {
        const walker = document.createTreeWalker(
          editor,
          NodeFilter.SHOW_TEXT,
          null
        );
        let node;
        while (node = walker.nextNode()) {
          if (node === textNode) {
            cursorPos += offset;
            break;
          }
          cursorPos += node.textContent.length;
        }
      } else {
        cursorPos = fullText.length;
      }
      
      // Find start of current line
      let lineStart = 0;
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (fullText[i] === '\n') {
          lineStart = i + 1;
          break;
        }
      }
      
      // Check if line starts with "-" (cursor is right after the dash, before space would be inserted)
      const lineText = fullText.substring(lineStart, cursorPos);
      if (lineText === '-') {
        e.preventDefault();
        
        // Replace "-" with "• " directly in the DOM for immediate visual feedback
        if (textNode.nodeType === Node.TEXT_NODE) {
          const text = textNode.textContent;
          
          // Calculate position within this text node
          // We need to find where in the full text this node starts
          const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node;
          let nodeStartPos = 0;
          while (node = walker.nextNode()) {
            if (node === textNode) {
              break;
            }
            nodeStartPos += node.textContent.length;
          }
          
          // Calculate offset within this text node
          const nodeOffset = cursorPos - nodeStartPos;
          
          // Replace the dash with bullet point and space
          const beforeDash = text.substring(0, nodeOffset - 1);
          const afterDash = text.substring(nodeOffset);
          
          // Update the text node directly for immediate visual feedback
          textNode.textContent = beforeDash + '• ' + afterDash;
          
          // Set cursor position immediately after the bullet and space
          const newOffset = nodeOffset - 1 + 2; // -1 (remove dash) + 2 (add "• ")
          const range = document.createRange();
          range.setStart(textNode, newOffset);
          range.setEnd(textNode, newOffset);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Fallback: replace entire text content
          const beforeText = fullText.substring(0, lineStart);
          const afterText = fullText.substring(cursorPos);
          editor.textContent = beforeText + '• ' + afterText;
          
          // Set cursor after bullet
          const newCursorPos = lineStart + 2;
          requestAnimationFrame(() => {
            const range = document.createRange();
            const sel = window.getSelection();
            
            const walker = document.createTreeWalker(
              editor,
              NodeFilter.SHOW_TEXT,
              null
            );
            let node;
            let pos = 0;
            while (node = walker.nextNode()) {
              const nodeLength = node.textContent.length;
              if (pos + nodeLength >= newCursorPos) {
                range.setStart(node, newCursorPos - pos);
                range.setEnd(node, newCursorPos - pos);
                sel.removeAllRanges();
                sel.addRange(range);
                return;
              }
              pos += nodeLength;
            }
            // Fallback: move to end
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          });
        }
        
        // Trigger input event to update dimensions
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
  }
  
  // Handle Enter key
  if(e.key === 'Enter'){
    // If autocomplete is showing and something is selected via keyboard navigation, let it handle Enter
    if (autocomplete && !autocomplete.classList.contains('hidden') && autocompleteSelectedIndex >= 0 && autocompleteKeyboardNavigation) {
      // Autocomplete will handle this
      return;
    }
    
    // Hide autocomplete when Enter is pressed to commit (cancel any pending search)
    clearTimeout(autocompleteSearchTimeout);
    hideAutocomplete();
    autocompleteIsShowing = false;
    
    // Command/Ctrl+Enter always saves, regardless of bullets
    if(e.metaKey || e.ctrlKey) {
      e.preventDefault();
      console.log('[CMD+ENTER] Committing editor');
      commitEditor();
      return;
    }
    
    // Shift+Enter is handled separately (allows newline in bullet lists)
    if(e.shiftKey) {
      // Allow default behavior (newline)
      return;
    }
    
    // Regular Enter - check if we're on a bullet line
    const selection = window.getSelection();
    let isOnBulletLine = false;
    
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;
      const offset = range.startOffset;
      
      // Get full text and cursor position
      const fullText = editor.innerText || editor.textContent || '';
      let cursorPos = 0;
      
      if (textNode.nodeType === Node.TEXT_NODE) {
        const walker = document.createTreeWalker(
          editor,
          NodeFilter.SHOW_TEXT,
          null
        );
        let node;
        while (node = walker.nextNode()) {
          if (node === textNode) {
            cursorPos += offset;
            break;
          }
          cursorPos += node.textContent.length;
        }
      } else {
        cursorPos = fullText.length;
      }
      
      // Find start of current line
      let lineStart = 0;
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (fullText[i] === '\n') {
          lineStart = i + 1;
          break;
        }
      }
      
      // Get current line text
      const lineEnd = fullText.indexOf('\n', cursorPos);
      const lineText = fullText.substring(lineStart, lineEnd >= 0 ? lineEnd : fullText.length);
      
      // Check if line starts with bullet
      isOnBulletLine = lineText.trim().startsWith('•');
      
      // If line starts with bullet, continue bullet on new line
      if (isOnBulletLine) {
        e.preventDefault();
        
        const beforeText = fullText.substring(0, cursorPos);
        const afterText = fullText.substring(cursorPos);
        
        editor.textContent = beforeText + '\n• ' + afterText;
        
        // Set cursor after new bullet
        const newCursorPos = cursorPos + 3; // "\n• " is 3 chars
        setTimeout(() => {
          const range = document.createRange();
          const sel = window.getSelection();
          
          const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node;
          let pos = 0;
          while (node = walker.nextNode()) {
            const nodeLength = node.textContent.length;
            if (pos + nodeLength >= newCursorPos) {
              range.setStart(node, newCursorPos - pos);
              range.setEnd(node, newCursorPos - pos);
              sel.removeAllRanges();
              sel.addRange(range);
              return;
            }
            pos += nodeLength;
          }
          // Fallback: move to end
          range.selectNodeContents(editor);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }, 0);
        
        editor.dispatchEvent(new Event('input'));
        return;
      }
    }
    
    // Deadline tables handle Enter themselves; calendar cards don't commit on Enter
    if (editor.querySelector('.deadline-table') || editor.querySelector('.gcal-card')) {
      return;
    }

    // Not on bullet line: Enter saves the entry
    e.preventDefault();
    console.log('[ENTER] Committing editor, isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    commitEditor();
    return;
  }
  // Shift+Enter: allow newline (default behavior)

  if(e.key === 'Escape'){
    e.preventDefault();

    // Dismiss resize handles if active
    if (resizeSelectedEntry) {
      hideResizeHandles();
      return;
    }

    // Research entries are real — no special cleanup on ESC

    // Remove editing class from entry
    if(editingEntryId && editingEntryId !== 'anchor'){
      const entryData = entries.get(editingEntryId);
      if(entryData && entryData.element){
        entryData.element.classList.remove('editing', 'deadline-editing');
      }
    }

    // Clear editor content to prevent stale content from creating duplicates
    editor.removeEventListener('keydown', handleDeadlineTableKeydown);
    editor.textContent = '';
    editor.innerHTML = '';
    editingEntryId = null;

    // After escaping, show cursor in default position
    showCursorInDefaultPosition();
    return;
  }
});

// Helper function to calculate width of widest line (accounting for line breaks)
// Update editing border dimensions to wrap content dynamically
function updateEditingBorderDimensions(entry) {
  if (!entry || !entry.classList.contains('editing')) return;

  // Deadline tables / calendar cards: size border to match content dimensions
  const deadlineTable = entry.querySelector('.deadline-table');
  const gcalCard = entry.querySelector('.gcal-card');
  if (deadlineTable || gcalCard) {
    entry.style.removeProperty('width');
    entry.style.removeProperty('height');
    return;
  }

  // Find the maximum font size in the editor content
  let maxFontSize = parseFloat(window.getComputedStyle(editor).fontSize);

  // Walk through all text nodes and their parents to find max font size
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      const parent = node.parentNode;
      if (parent && parent !== editor) {
        const fontSize = parseFloat(window.getComputedStyle(parent).fontSize);
        if (!isNaN(fontSize) && fontSize > maxFontSize) {
          maxFontSize = fontSize;
        }
      }
    }
  }

  // Set the entry's font-size to match the max font size in content
  // This makes the em-based CSS padding/border scale automatically
  entry.style.fontSize = `${maxFontSize}px`;

  // Don't set explicit width/height - let CSS auto sizing handle it
  // The CSS already has: width: auto !important; height: auto !important;
  // With em-based padding: 0.5em 2em 0.5em 1em
  entry.style.removeProperty('width');
  entry.style.removeProperty('height');
}

function getWidestLineWidth(element) {
  const text = element.innerText || element.textContent || '';
  
  // Calculate one character width as the minimum
  const temp = document.createElement('span');
  temp.style.position = 'absolute';
  temp.style.visibility = 'hidden';
  temp.style.whiteSpace = 'pre';
  temp.style.font = window.getComputedStyle(element).font;
  temp.style.fontSize = window.getComputedStyle(element).fontSize;
  temp.style.fontFamily = window.getComputedStyle(element).fontFamily;
  document.body.appendChild(temp);
  
  // Get one character width as minimum
  temp.textContent = 'M';
  const oneCharWidth = temp.offsetWidth;
  
  if (!text || text.trim().length === 0) {
    document.body.removeChild(temp);
    return oneCharWidth;
  }
  
  const lines = text.split('\n');
  if (lines.length === 0) {
    document.body.removeChild(temp);
    return oneCharWidth;
  }
  
  let maxWidth = 0;
  for (const line of lines) {
    temp.textContent = line || ' '; // Use space for empty lines
    const width = temp.offsetWidth;
    if (width > maxWidth) {
      maxWidth = width;
    }
  }
  
  document.body.removeChild(temp);
  // Use one character width as minimum instead of fixed 220px
  return Math.max(maxWidth, oneCharWidth);
}

// Autocomplete state
let autocompleteSearchTimeout = null;
let autocompleteSelectedIndex = -1;
let autocompleteResults = [];
let autocompleteKeyboardNavigation = false; // Track if user used arrow keys to navigate
let mediaAutocompleteEnabled = false; // Toggle for media autocomplete mode
let latexModeEnabled = false; // Toggle for LaTeX conversion mode

// Update editor width and entry border dimensions as content changes
editor.addEventListener('input', () => {
  // Calculate width based on widest line (preserves line structure)
  const contentWidth = getWidestLineWidth(editor);
  editor.style.width = `${contentWidth}px`;
  
  // Also update the editing entry's dimensions if we're editing an entry
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      updateEditingBorderDimensions(entryData.element);
    }
  }
  
  // Enable autocomplete for text input
  handleAutocompleteSearch();
});

// Ensure idle-cursor is removed when editor gets focus (native caret will show)
editor.addEventListener('focus', (e) => {
  editor.classList.remove('idle-cursor');
});

let isRightClickContext = false;

editor.addEventListener('blur', (e) => {
  // Auto-save when editor loses focus (e.g., clicking elsewhere)
  // Only save if there's content and we're not in the middle of navigation
  // Note: We clear isNavigating when user clicks, so this should work
  console.log('[BLUR] Editor blurred. isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted, 'editingEntryId:', editingEntryId, 'isRightClickContext:', isRightClickContext);
  
  if (isNavigating || navigationJustCompleted) {
    console.log('[BLUR] Skipping commit due to navigation');
    return;
  }
  
  // Don't commit if this blur was caused by right-click context menu
  if (isRightClickContext) {
    isRightClickContext = false;
    return;
  }
  
  // Don't commit if user is selecting an autocomplete result
  if (isSelectingAutocomplete) {
    isSelectingAutocomplete = false;
    return;
  }
  
  // Check if editor has content
  const raw = editor.innerText || editor.textContent || '';
  const trimmed = raw.trim();
  
  // Only commit if there's actual content (for both new and existing entries)
  if (trimmed.length > 0) {
    // Use setTimeout to ensure blur completes before commit
    // This prevents issues with focus changes during commit
    setTimeout(() => {
      const active = document.activeElement;
      const focusInFormatBar = formatBar && formatBar.contains(active);
      if (active !== editor && !editor.contains(active) && !focusInFormatBar && editor.innerText.trim().length > 0) {
        commitEditor();
      }
    }, 0);
  } else if (trimmed.length === 0 && editingEntryId && editingEntryId !== 'anchor') {
    // If editor is empty and editing existing entry, consider deleting the entry
    // BUT: skip auto-delete for entries that are pure media/link cards (no text)
    setTimeout(async () => {
      const active = document.activeElement;
      const focusInFormatBar = formatBar && formatBar.contains(active);
      if (active !== editor && !editor.contains(active) && !focusInFormatBar) {
        const entryData = entries.get(editingEntryId);
        if (!entryData) return;

        // SAFETY: If the entry has saved text, the editor reading as empty is a
        // DOM timing race (blur/focus race, shift+drag, rapid click, etc.).
        // Never auto-delete an entry that has persisted text.
        if (entryData.text && entryData.text.trim().length > 0) {
          console.log('[BLUR] Editor empty but entry has saved text — skipping delete, entry:', editingEntryId);
          entryData.element.classList.remove('editing', 'deadline-editing');
          editingEntryId = null;
          editor.removeEventListener('keydown', handleDeadlineTableKeydown);
          editor.textContent = '';
          editor.innerHTML = '';
          showCursorInDefaultPosition();
          return;
        }

        const hasMediaOrLinks =
          !!entryData.mediaCardData ||
          (Array.isArray(entryData.linkCardsData) && entryData.linkCardsData.length > 0);

        if (hasMediaOrLinks) {
          // Just exit editing state without deleting the entry
          entryData.element.classList.remove('editing', 'deadline-editing');
          editingEntryId = null;
          editor.removeEventListener('keydown', handleDeadlineTableKeydown);
          editor.textContent = '';
          editor.innerHTML = '';
          showCursorInDefaultPosition();
          return;
        }

        // No saved text and no media/link cards: user really cleared text, delete entry
        const deletedEntryId = editingEntryId; // Store before deletion
        const deletedEntryData = entries.get(deletedEntryId);
        let deletedEntryPos = null;
        if (deletedEntryData && deletedEntryData.element) {
          // Store position before deletion
          const element = deletedEntryData.element;
          const rect = element.getBoundingClientRect();
          const worldX = parseFloat(element.style.left) || 0;
          const worldY = parseFloat(element.style.top) || 0;
          const worldWidth = rect.width;
          const worldHeight = rect.height;
          const padding = 40;
          deletedEntryPos = {
            x: worldX + worldWidth + padding,
            y: worldY + worldHeight + padding
          };
        }
        const deleted = await deleteEntryWithConfirmation(editingEntryId);
        if (deleted) {
          // Show cursor at bottom-right of deleted entry (use stored position)
          if (deletedEntryPos) {
            showCursorAtWorld(deletedEntryPos.x, deletedEntryPos.y);
          } else {
            showCursorInDefaultPosition();
          }
          editingEntryId = null;
        }
      }
    }, 0);
  } else if (trimmed.length === 0 && (!editingEntryId || editingEntryId === 'anchor')) {
    // If empty and creating new entry, show cursor in default position
    // Skip when focus moved to drop dialog so we don't steal focus back
    setTimeout(() => {
      if (document.activeElement !== editor && !isFocusInDropDialog()) {
        showCursorInDefaultPosition();
        editingEntryId = null;
      }
    }, 0);
  }
});

editor.addEventListener('mousedown', (e) => e.stopPropagation());
editor.addEventListener('wheel', (e) => e.stopPropagation());
editor.addEventListener('paste', (e) => {
  // Only prevent paste during navigation transitions or right after navigation
  if (isNavigating || navigationJustCompleted) {
    e.preventDefault();
    e.stopPropagation();
    // Clear the editor content to be safe
    editor.textContent = '';
    return;
  }
  // Also prevent paste if editor is hidden (shouldn't happen, but safety check)
  if (editor.style.display === 'none') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Allow paste to work normally when editor is visible and focused
});

// Right-click to edit entry (only if not read-only). Images: only select.
viewport.addEventListener('contextmenu', (e) => {
  if(e.target === editor || editor.contains(e.target)) return;
  if(isReadOnly) return;
  
  const entryEl = findEntryElement(e.target);
  if(e.target.closest('.link-card')) return;
  
  if(entryEl && entryEl.id !== 'anchor' && entryEl.id){
    if(isImageEntry(entryEl) || isFileEntry(entryEl)){
      e.preventDefault();
      e.stopPropagation();
      selectOnlyEntry(entryEl.id);
      return;
    }
    if(entryEl.querySelector('.gcal-card')){
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Mark that this focus/blur sequence came from a right-click edit
    isRightClickContext = true;
    const entryData = entries.get(entryEl.id);
    if(entryData){
      const rect = entryEl.getBoundingClientRect();
      const worldPos = screenToWorld(rect.left, rect.top);
      placeEditorAtWorld(worldPos.x, worldPos.y, entryData.text, entryEl.id);
    }
  }
});

// Convert a Supabase storage URL to a thumbnail URL using image transforms
// Falls back to original URL for non-Supabase URLs
function getThumbUrl(url, width = 400) {
  if (!url || typeof url !== 'string') return url;
  // Match Supabase storage public URLs: .../storage/v1/object/public/...
  const match = url.match(/^(https?:\/\/[^/]+\/storage\/v1\/)object\/(public\/.+)$/);
  if (match) {
    return `${match[1]}render/image/${match[2]}?width=${width}&resize=contain`;
  }
  return url;
}

// Compress image files client-side to stay under Vercel's 4.5MB body limit
const MAX_UPLOAD_SIZE = 4 * 1024 * 1024; // 4MB target (leave headroom)
async function compressImageFile(file) {
  if (file.size <= MAX_UPLOAD_SIZE) return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      // Scale down to fit within reasonable dimensions
      const maxDim = 2048;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Try quality levels until under size limit
      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= MAX_UPLOAD_SIZE || quality <= 0.3) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            quality -= 0.15;
            tryCompress();
          }
        }, 'image/jpeg', quality);
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Drag-and-drop files onto canvas
viewport.addEventListener('dragover', (e) => {
  if(isReadOnly) return;
  if(e.dataTransfer.types.includes('Files')){
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
viewport.addEventListener('drop', async (e) => {
  if(isReadOnly) return;
  if(!e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  e.stopPropagation();

  // Check if dropped onto an existing deadline table on the canvas
  const targetTable = e.target.closest ? e.target.closest('.deadline-table') : null;
  const targetEntry = targetTable ? targetTable.closest('.entry') : null;
  if (targetTable && targetEntry && !targetTable.closest('#editor')) {
    const allFiles = Array.from(e.dataTransfer.files);
    await extractDeadlinesIntoEntry(targetEntry, targetTable, allFiles);
    return;
  }

  const files = Array.from(e.dataTransfer.files);
  if(!files.length) return;

  const baseWorldPos = screenToWorld(e.clientX, e.clientY);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const offset = files.length > 1 ? goldenAngleSpiralPosition(i, 60) : { x: 0, y: 0 };
    const pos = { x: baseWorldPos.x + offset.x, y: baseWorldPos.y + offset.y };

    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImageFile(file);
        const form = new FormData();
        form.append('file', compressed);
        const res = await fetch('/api/upload-image', { method: 'POST', credentials: 'include', body: form });
        if(!res.ok){
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Upload failed');
        }
        const { url } = await res.json();
        await createImageEntryAtWorld(pos.x, pos.y, url);
      } catch(err){
        console.error('Image upload failed:', err);
      }
    } else {
      await createFileEntryAtWorld(pos.x, pos.y, file);
    }
  }
});

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimetype) {
  if (mimetype === 'application/pdf') return '📄';
  if (mimetype.includes('word') || mimetype.includes('document')) return '📝';
  if (mimetype.includes('sheet') || mimetype.includes('csv')) return '📊';
  if (mimetype.includes('presentation')) return '📽';
  if (mimetype.startsWith('text/')) return '📃';
  return '📎';
}

async function createFileEntryAtWorld(worldX, worldY, file) {
  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = 'entry canvas-file';
  entry.id = entryId;
  entry.style.left = `${worldX}px`;
  entry.style.top = `${worldY}px`;
  // Show placeholder while uploading
  entry.innerHTML = `<div class="file-card"><div class="file-card-icon">${getFileIcon(file.type)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(file.name)}</div><div class="file-card-meta">Uploading...</div></div></div>`;
  world.appendChild(entry);

  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload-file', { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    const data = await res.json();
    const mediaData = { type: 'file', url: data.url, name: data.name, size: data.size, mimetype: data.mimetype };

    entry.innerHTML = '';
    entry.appendChild(createFileCard(mediaData));
    updateEntryDimensions(entry);

    const entryData = {
      id: entryId,
      element: entry,
      text: data.name,
      position: { x: worldX, y: worldY },
      parentEntryId: currentViewEntryId,
      mediaCardData: mediaData
    };
    entries.set(entryId, entryData);
    updateEntryVisibility();
    await saveEntryToServer(entryData);
  } catch (err) {
    console.error('File upload failed:', err);
    entry.remove();
  }
}

function createFileCard(mediaData) {
  const card = document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = `<div class="file-card-icon">${getFileIcon(mediaData.mimetype || '')}</div>
    <div class="file-card-info"><div class="file-card-name">${escapeHtml(mediaData.name || 'File')}</div><div class="file-card-meta">${formatFileSize(mediaData.size || 0)}</div></div>
    <div class="file-card-actions">
      <a class="file-action-btn" href="${escapeHtml(mediaData.url)}" target="_blank" title="View"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
      <a class="file-action-btn" href="${escapeHtml(mediaData.url)}" download="${escapeHtml(mediaData.name || 'file')}" title="Download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
    </div>`;
  // Prevent clicks on action buttons from triggering entry editing
  card.querySelectorAll('.file-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => e.stopPropagation());
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
  });
  return card;
}

async function extractDeadlinesIntoEntry(entryEl, table, files) {
  // Accept a single file or array of files
  const fileList = Array.isArray(files) ? files : [files];
  entryEl.classList.add('deadline-extracting');

  const promises = fileList.map(file => extractFileIntoTable(table, file));
  await Promise.allSettled(promises);

  entryEl.classList.remove('deadline-extracting');

  // Save updated entry
  const entryData = entries.get(entryEl.id);
  if (entryData) {
    entryData.text = entryEl.innerText;
    entryData.textHtml = entryEl.innerHTML;
    await updateEntryOnServer(entryData);
  }
}

requestAnimationFrame(() => {
  centerAnchor();
  // Show cursor after initial setup
  if (!isReadOnly) {
    setTimeout(() => {
      showCursorInDefaultPosition();
    }, 100);
  }
});

// Handle browser back/forward buttons
window.addEventListener('popstate', (event) => {
  if (window.PAGE_USERNAME) {
    // Extract path from URL
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    
    if (pathParts.length === 1 && pathParts[0] === window.PAGE_USERNAME) {
      // At root of user page
      navigateToRoot();
    } else if (pathParts.length > 1) {
      // Navigate to the entry based on the URL path
      const slugPath = pathParts.slice(1); // Remove username
      
      // If we have saved state, use it
      if (event.state && event.state.navigationStack) {
        navigationStack = [...event.state.navigationStack];
        currentViewEntryId = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;
        updateBreadcrumb();
        updateEntryVisibility();
      } else {
        // Otherwise, reconstruct navigation from path
        let currentParent = null;
        navigationStack = [];
        
        for (const slug of slugPath) {
          const children = Array.from(entries.values()).filter(e => e.parentEntryId === currentParent);
          const targetEntry = children.find(e => {
            // Pass full entry data to generateEntrySlug to handle media cards
            const entrySlug = generateEntrySlug(e.text, e);
            return entrySlug === slug;
          });
          
          if (targetEntry) {
            navigationStack.push(targetEntry.element.id);
            currentParent = targetEntry.element.id;
          } else {
            break;
          }
        }
        
        currentViewEntryId = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;
        updateBreadcrumb();
        updateEntryVisibility();
        
        // Recalculate dimensions and zoom after popstate navigation
        setTimeout(() => {
          entries.forEach((entryData, entryId) => {
            if (entryId === 'anchor') return;
            const entry = entryData.element;
            if (entry && entry.style.display !== 'none') {
              updateEntryDimensions(entry);
            }
          });
          
          requestAnimationFrame(() => {
            zoomToFitEntries();
          });
        }, 100);
      }
    }
  }
});

// ——— Simplex 2D Noise (deterministic, no dependencies) ———
const _organizeNoise = (function() {
  const perm = new Uint8Array(512);
  const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  let s = 42;
  function rng() { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; }
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function(x, y) {
    const sk = (x + y) * F2, i = Math.floor(x + sk), j = Math.floor(y + sk);
    const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 8, gi1 = perm[ii + i1 + perm[jj + j1]] % 8, gi2 = perm[ii + 1 + perm[jj + 1]] % 8;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(grad[gi0][0]*x0+grad[gi0][1]*y0); }
    let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(grad[gi1][0]*x1+grad[gi1][1]*y1); }
    let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(grad[gi2][0]*x2+grad[gi2][1]*y2); }
    return 70 * (n0 + n1 + n2);
  };
})();

// ——— HSL color distance with hue wraparound ———
function _colorDist(a, b) {
  const dH = Math.min(Math.abs(a.hue - b.hue), 360 - Math.abs(a.hue - b.hue)) / 180;
  const dS = Math.abs((a.sat || 0) / 100 - (b.sat || 0) / 100);
  const dL = Math.abs((a.lum || 50) / 100 - (b.lum || 50) / 100);
  return Math.sqrt(dH * dH * 4.0 + dS * dS * 1.0 + dL * dL * 0.5);
}

// ——— Organize Canvas Layout: Force-directed + Multi-spiral ———
async function organizeCanvasLayout() {
  const organizeBtn = document.getElementById('organize-button');
  if (organizeBtn) organizeBtn.classList.add('organizing');

  try {
    console.log('[ORGANIZE] Starting organizeCanvasLayout');
    // Step 1: Collect visible entries
    const visibleEntries = Array.from(entries.values()).filter(e => {
      if (e.id === 'anchor') return false;
      return e.element && e.element.style.display !== 'none';
    });
    console.log('[ORGANIZE] Visible entries:', visibleEntries.length);
    if (visibleEntries.length === 0) {
      console.log('[ORGANIZE] No visible entries, returning');
      return;
    }

    // Step 2: Measure each entry and extract dominant color
    // Batch getBoundingClientRect to minimize forced reflows
    const rects = visibleEntries.map(ed => ed.element.getBoundingClientRect());
    const items = [];
    const linkColorPromises = [];
    for (let idx = 0; idx < visibleEntries.length; idx++) {
      const ed = visibleEntries[idx];
      const el = ed.element;
      const rect = rects[idx];
      const w = rect.width / cam.z;
      const h = rect.height / cam.z;
      let hue = 0, sat = 0, lum = 50;
      let hasColor = false;
      let type = 'text';

      if (el.classList.contains('canvas-image')) {
        type = 'image';
        const img = el.querySelector('img');
        if (img && img.complete && img.naturalWidth > 0) {
          const hsl = extractDominantHSL(img);
          hue = hsl.h; sat = hsl.s; lum = hsl.l; hasColor = true;
        }
      } else if (el.querySelector('.link-card')) {
        type = 'link';
        const thumb = el.querySelector('.link-card-image, .link-card-yt-thumb');
        if (thumb) {
          const bg = thumb.style.backgroundImage;
          const urlMatch = bg && bg.match(/url\(["']?(.+?)["']?\)/);
          if (urlMatch) {
            // Collect promise — resolve all link colors in parallel below
            linkColorPromises.push({ idx: items.length, src: urlMatch[1] });
          }
        }
      } else if (el.querySelector('.media-card')) {
        type = 'media';
      }

      // Store positions as centers (not top-left) for correct overlap math
      const topLeftX = parseFloat(el.style.left) || 0;
      const topLeftY = parseFloat(el.style.top) || 0;
      items.push({
        id: ed.id, element: el, data: ed, w, h, type,
        hue, sat, lum, hasColor,
        oldX: topLeftX + w / 2,
        oldY: topLeftY + h / 2,
        x: 0, y: 0, vx: 0, vy: 0
      });
    }
    // Resolve all link-card colors in parallel
    if (linkColorPromises.length > 0) {
      const results = await Promise.allSettled(
        linkColorPromises.map(p => loadImageForColor(p.src).then(img => ({ idx: p.idx, hsl: extractDominantHSL(img) })))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const item = items[r.value.idx];
          item.hue = r.value.hsl.h; item.sat = r.value.hsl.s; item.lum = r.value.hsl.l; item.hasColor = true;
        }
      }
    }

    const n = items.length;
    console.log('[ORGANIZE] Items measured:', n);
    if (n === 0) {
      console.log('[ORGANIZE] No items after measurement, returning');
      return;
    }

    // Step 3: Cluster by color similarity using simple greedy clustering
    // Group items whose colors are within threshold into the same cluster
    const COLOR_THRESHOLD = 0.45;
    const clusters = [];
    const assigned = new Set();
    // Sort items with color first, then without
    const colorItems = items.filter(m => m.hasColor).sort((a, b) => a.hue - b.hue);
    const noColorItems = items.filter(m => !m.hasColor);

    for (const item of colorItems) {
      if (assigned.has(item.id)) continue;
      const cluster = [item];
      assigned.add(item.id);
      for (const other of colorItems) {
        if (assigned.has(other.id)) continue;
        if (_colorDist(item, other) < COLOR_THRESHOLD) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }
      clusters.push(cluster);
    }
    // Non-color items form their own cluster
    if (noColorItems.length > 0) {
      clusters.push(noColorItems);
      noColorItems.forEach(m => assigned.add(m.id));
    }

    // Step 4: Greedy tight-packing with asymmetry
    // Sort by area (largest first) so big items anchor the layout, small items fill gaps
    // For each item, find a position adjacent to placed items, biased toward center + noise
    console.log('[ORGANIZE] Clusters:', clusters.length, 'sizes:', clusters.map(c => c.length));
    const vpRect = viewport.getBoundingClientRect();
    const center = screenToWorld(vpRect.width / 2, vpRect.height / 2);
    console.log('[ORGANIZE] Center:', center, 'cam:', {x: cam.x, y: cam.y, z: cam.z}, 'viewport:', vpRect.width, 'x', vpRect.height);
    const avgDiag = items.reduce((s, m) => s + Math.sqrt(m.w * m.w + m.h * m.h), 0) / n;
    const PAD = 22; // generous padding to prevent visual overlap (shadows, borders)
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    console.log('[ORGANIZE] avgDiag:', avgDiag, 'PAD:', PAD);

    // Sort by area descending
    items.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    // Place first item at center
    items[0].x = center.x;
    items[0].y = center.y;

    // For each subsequent item, find the best position
    for (let i = 1; i < n; i++) {
      const item = items[i];
      let bestX = center.x, bestY = center.y;
      let bestScore = Infinity;
      // Golden-angle offset per item — ensures each item samples different angles first
      const angleOffset = i * goldenAngle;

      // Generate candidate positions adjacent to each already-placed item
      for (let j = 0; j < i; j++) {
        const p = items[j];
        const gapX = p.w / 2 + item.w / 2 + PAD;
        const gapY = p.h / 2 + item.h / 2 + PAD;

        // 20 candidates around the perimeter, offset by golden angle per item
        const NUM_ANGLES = 20;
        for (let a = 0; a < NUM_ANGLES; a++) {
          const angle = angleOffset + (a / NUM_ANGLES) * Math.PI * 2;
          const dx = Math.cos(angle), dy = Math.sin(angle);
          // Minimum AABB separation distance along this angle
          const tX = Math.abs(dx) > 0.01 ? gapX / Math.abs(dx) : 1e9;
          const tY = Math.abs(dy) > 0.01 ? gapY / Math.abs(dy) : 1e9;
          const t = Math.min(tX, tY);
          const cx = p.x + t * dx;
          const cy = p.y + t * dy;

          // Check no overlap with any placed item
          let valid = true;
          for (let k = 0; k < i; k++) {
            const overlapX = (item.w / 2 + items[k].w / 2 + PAD) - Math.abs(cx - items[k].x);
            const overlapY = (item.h / 2 + items[k].h / 2 + PAD) - Math.abs(cy - items[k].y);
            if (overlapX > 0 && overlapY > 0) {
              valid = false;
              break;
            }
          }

          if (valid) {
            const dist = Math.sqrt((cx - center.x) ** 2 + (cy - center.y) ** 2);
            // Add noise bias to break grid symmetry — nearby candidates compete randomly
            const noiseBias = _organizeNoise(i * 2.7 + a * 0.4, j * 1.9) * avgDiag * 0.12;
            const score = dist + noiseBias;
            if (score < bestScore) {
              bestScore = score;
              bestX = cx;
              bestY = cy;
            }
          }
        }
      }

      // Fallback: if no valid position found, use golden spiral outward
      if (bestScore === Infinity) {
        const angle = i * goldenAngle;
        const radius = avgDiag * 0.5 * Math.sqrt(i);
        bestX = center.x + radius * Math.cos(angle);
        bestY = center.y + radius * Math.sin(angle);
      }

      item.x = bestX;
      item.y = bestY;
    }

    // Step 5: Post-placement overlap resolution safety pass
    // Fixes any remaining overlaps (visual overflow, edge cases)
    for (let pass = 0; pass < 10; pass++) {
      let hasOverlap = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const overlapX = (items[i].w / 2 + items[j].w / 2 + PAD) - Math.abs(items[i].x - items[j].x);
          const overlapY = (items[i].h / 2 + items[j].h / 2 + PAD) - Math.abs(items[i].y - items[j].y);
          if (overlapX > 0 && overlapY > 0) {
            hasOverlap = true;
            const area_i = items[i].w * items[i].h || 1;
            const area_j = items[j].w * items[j].h || 1;
            const total = area_i + area_j;
            const wi = area_j / total, wj = area_i / total;
            if (overlapX < overlapY) {
              const sign = items[i].x > items[j].x ? 1 : -1;
              items[i].x += sign * overlapX * wi;
              items[j].x -= sign * overlapX * wj;
            } else {
              const sign = items[i].y > items[j].y ? 1 : -1;
              items[i].y += sign * overlapY * wi;
              items[j].y -= sign * overlapY * wj;
            }
          }
        }
      }
      if (!hasOverlap) break;
    }
    console.log('[ORGANIZE] Packing done. Sample positions:', items.slice(0, 5).map(i => ({id: i.id, w: Math.round(i.w), h: Math.round(i.h), x: Math.round(i.x), y: Math.round(i.y)})));

    // Step 6b: Re-center layout on viewport center
    // Compute centroid of all items and shift so it aligns with the viewport center
    let centroidX = 0, centroidY = 0;
    for (let i = 0; i < n; i++) {
      centroidX += items[i].x;
      centroidY += items[i].y;
    }
    centroidX /= n;
    centroidY /= n;
    const shiftX = center.x - centroidX;
    const shiftY = center.y - centroidY;
    for (let i = 0; i < n; i++) {
      items[i].x += shiftX;
      items[i].y += shiftY;
    }
    console.log('[ORGANIZE] Re-centered. centroid was:', {x: Math.round(centroidX), y: Math.round(centroidY)}, 'shift:', {x: Math.round(shiftX), y: Math.round(shiftY)});
    console.log('[ORGANIZE] Final positions:', items.slice(0, 5).map(i => ({id: i.id, x: Math.round(i.x), y: Math.round(i.y), oldX: Math.round(i.oldX), oldY: Math.round(i.oldY)})));

    // Step 7: Animate from old to new positions
    const duration = 700;
    const stagger = Math.min(25, 800 / n); // Cap total stagger to 800ms regardless of count
    const startTime = performance.now();

    await new Promise(resolve => {
      function animate(now) {
        let allDone = true;
        for (let i = 0; i < n; i++) {
          const item = items[i];
          const elapsed = now - startTime - i * stagger;
          if (elapsed < 0) { allDone = false; continue; }
          const t = Math.min(1, elapsed / duration);
          const ease = 1 - Math.pow(1 - t, 3);
          // Interpolate centers, then convert to top-left for rendering
          const animCX = item.oldX + (item.x - item.oldX) * ease;
          const animCY = item.oldY + (item.y - item.oldY) * ease;
          item.element.style.left = `${animCX - item.w / 2}px`;
          item.element.style.top = `${animCY - item.h / 2}px`;
          if (t < 1) allDone = false;
          if (t >= 1) item.data.position = { x: item.x - item.w / 2, y: item.y - item.h / 2 };
        }
        if (!allDone) requestAnimationFrame(animate);
        else resolve();
      }
      requestAnimationFrame(animate);
    });
    console.log('[ORGANIZE] Animation complete');

    // Step 8: Batch save positions (convert centers to top-left for storage)
    // IMPORTANT: include all entry metadata to prevent ON CONFLICT from wiping it
    const entriesToSave = items.map(item => ({
      id: item.id,
      text: item.data.text,
      position: { x: item.x - item.w / 2, y: item.y - item.h / 2 },
      parentEntryId: item.data.parentEntryId || null,
      mediaCardData: item.data.mediaCardData || null,
      linkCardsData: item.data.linkCardsData || null,
      latexData: item.data.latexData || null
    }));
    try {
      await fetch('/api/entries/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave, pageOwnerId: window.PAGE_OWNER_ID })
      });
    } catch (err) {
      console.error('[ORGANIZE] Error saving organized positions:', err);
    }
    console.log('[ORGANIZE] Batch save sent for', entriesToSave.length, 'entries');

    // Step 9: Zoom to fit
    console.log('[ORGANIZE] Calling zoomToFitEntries');
    setTimeout(() => zoomToFitEntries(), 150);

  } catch (err) {
    console.error('[ORGANIZE] Error during organize:', err);
  } finally {
    if (organizeBtn) organizeBtn.classList.remove('organizing');
    console.log('[ORGANIZE] Done');
  }
}

function extractDominantHSL(img) {
  try {
    const c = document.createElement('canvas');
    const size = 32;
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
      rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; count++;
    }
    const r = rSum / count / 255, g = gSum / count / 255, b = bSum / count / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  } catch(e) { return { h: 0, s: 0, l: 50 }; }
}

function loadImageForColor(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Gentle alignment algorithm - local, visual-only refinement
async function organizeEntriesIntoHubs() {
  // Get all visible entries (current view level)
  const visibleEntries = Array.from(entries.values()).filter(e => {
    if (e.id === 'anchor') return false;
    const entry = e.element;
    return entry && entry.style.display !== 'none';
  });

  if (visibleEntries.length === 0) return;

  // Get viewport bounds in world coordinates
  const viewportRect = viewport.getBoundingClientRect();
  const margin = 0.2; // 20% margin
  const marginX = viewportRect.width * margin;
  const marginY = viewportRect.height * margin;
  
  // Convert viewport bounds to world coordinates
  // Viewport screen coordinates (0,0) to (width, height) map to world coordinates
  const topLeft = screenToWorld(-marginX, -marginY);
  const bottomRight = screenToWorld(viewportRect.width + marginX, viewportRect.height + marginY);
  
  // Filter entries to only those in viewport + margin
  const localEntries = visibleEntries.filter(e => {
    const pos = e.position || { x: 0, y: 0 };
    return pos.x >= topLeft.x && pos.x <= bottomRight.x &&
           pos.y >= topLeft.y && pos.y <= bottomRight.y;
  });

  if (localEntries.length < 4) return; // Need at least 4 entries to form a group

  // Step 1: Detect local neighborhoods (purely spatial)
  const NEIGHBOR_RADIUS = 400;
  const groups = [];
  const processed = new Set();

  localEntries.forEach(entry => {
    if (processed.has(entry.id)) return;

    const entryPos = entry.position || { x: 0, y: 0 };
    const neighbors = localEntries.filter(other => {
      if (other.id === entry.id || processed.has(other.id)) return false;
      const otherPos = other.position || { x: 0, y: 0 };
      const dx = otherPos.x - entryPos.x;
      const dy = otherPos.y - entryPos.y;
      return Math.sqrt(dx * dx + dy * dy) <= NEIGHBOR_RADIUS;
    });

    if (neighbors.length >= 4) {
      const group = [entry, ...neighbors];
      groups.push(group);
      group.forEach(e => processed.add(e.id));
    }
  });

  if (groups.length === 0) return;

  // Step 2: Infer natural alignment axis using PCA for each group
  const alignedEntries = [];

  groups.forEach(group => {
    if (group.length < 4) return;

    // Get positions
    const positions = group.map(e => {
      const pos = e.position || { x: 0, y: 0 };
      return [pos.x, pos.y];
    });

    // Compute centroid
    const centroid = [
      positions.reduce((sum, p) => sum + p[0], 0) / positions.length,
      positions.reduce((sum, p) => sum + p[1], 0) / positions.length
    ];

    // Center positions
    const centered = positions.map(p => [p[0] - centroid[0], p[1] - centroid[1]]);

    // Compute covariance matrix
    const cov = [
      [0, 0],
      [0, 0]
    ];

    centered.forEach(p => {
      cov[0][0] += p[0] * p[0];
      cov[0][1] += p[0] * p[1];
      cov[1][0] += p[1] * p[0];
      cov[1][1] += p[1] * p[1];
    });

    const n = centered.length;
    cov[0][0] /= n;
    cov[0][1] /= n;
    cov[1][0] /= n;
    cov[1][1] /= n;

    // Compute eigenvalues and eigenvectors (simplified 2x2 PCA)
    const trace = cov[0][0] + cov[1][1];
    const det = cov[0][0] * cov[1][1] - cov[0][1] * cov[1][0];
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) return; // Skip if degenerate

    const sqrtDisc = Math.sqrt(discriminant);
    const eigenval1 = (trace + sqrtDisc) / 2;
    const eigenval2 = (trace - sqrtDisc) / 2;

    // Get dominant eigenvector (larger eigenvalue)
    let dominantDir;
    if (Math.abs(eigenval1) > Math.abs(eigenval2)) {
      // Solve (cov - eigenval1 * I) * v = 0
      const a = cov[0][0] - eigenval1;
      const b = cov[0][1];
      if (Math.abs(b) > 0.001) {
        dominantDir = [1, -a / b];
      } else {
        dominantDir = [0, 1];
      }
    } else {
      const a = cov[0][0] - eigenval2;
      const b = cov[0][1];
      if (Math.abs(b) > 0.001) {
        dominantDir = [1, -a / b];
      } else {
        dominantDir = [0, 1];
      }
    }

    // Normalize direction vector
    const dirLen = Math.sqrt(dominantDir[0] * dominantDir[0] + dominantDir[1] * dominantDir[1]);
    if (dirLen < 0.001) return;
    dominantDir[0] /= dirLen;
    dominantDir[1] /= dirLen;

    // Perpendicular direction
    const perpDir = [-dominantDir[1], dominantDir[0]];

    // POST-PROCESSING: Local Hub Decluttering & Alignment (MANDATORY)
    
    // Step A: Choose dominant layout axis per hub
    // Compute bounding box for group
    const xs = group.map(e => (e.position || { x: 0 }).x);
    const ys = group.map(e => (e.position || { y: 0 }).y);
    const bboxWidth = Math.max(...xs) - Math.min(...xs);
    const bboxHeight = Math.max(...ys) - Math.min(...ys);
    
    // Determine if horizontal or vertical alignment
    const isHorizontal = bboxWidth > bboxHeight;
    const layoutAxis = isHorizontal ? dominantDir : perpDir;
    const layoutPerp = isHorizontal ? perpDir : dominantDir;

    // Step B: Text-aware sizing
    const CHAR_WIDTH = 9; // Approximate character width in pixels
    const LINE_HEIGHT = 24; // Approximate line height
    
    const entryBboxes = group.map(e => {
      const text = e.text || '';
      const lines = text.split('\n');
      const maxLineLength = Math.max(...lines.map(l => l.length), 0);
      
      // Estimate dimensions
      const width = Math.max(maxLineLength * CHAR_WIDTH, 60);
      const height = lines.length * LINE_HEIGHT;
      
      const pos = e.position || { x: 0, y: 0 };
      
      return {
        id: e.id,
        x: pos.x,
        y: pos.y,
        width,
        height,
        text,
        original: { x: pos.x, y: pos.y }
      };
    });

    // Step C: Order entries along the axis
    // Project onto layout axis and sort
    const projected = entryBboxes.map(bbox => ({
      ...bbox,
      projection: bbox.x * layoutAxis[0] + bbox.y * layoutAxis[1]
    }));
    
    projected.sort((a, b) => a.projection - b.projection);

    // Step D: Enforce minimum spacing (no overlap allowed)
    const MIN_GAP = 22; // Average of 18-28px
    const workingPositions = [];
    
    // Position first entry at its projected location
    let prevEnd = projected[0].projection;
    
    projected.forEach((bbox, index) => {
      let currentPos;
      
      if (index === 0) {
        // Keep first entry at original projection
        currentPos = bbox.projection;
      } else {
        // Ensure minimum spacing from previous entry
        const entrySize = isHorizontal ? bbox.width : bbox.height;
        const desiredPos = bbox.projection;
        const minPos = prevEnd + MIN_GAP;
        
        currentPos = Math.max(desiredPos, minPos);
      }
      
      // Calculate new world coordinates
      const entrySize = isHorizontal ? bbox.width : bbox.height;
      const newX = currentPos * layoutAxis[0] + (bbox.x - bbox.projection * layoutAxis[0]);
      const newY = currentPos * layoutAxis[1] + (bbox.y - bbox.projection * layoutAxis[1]);
      
      workingPositions.push({
        id: bbox.id,
        x: newX,
        y: newY,
        width: bbox.width,
        height: bbox.height,
        original: bbox.original
      });
      
      prevEnd = currentPos + entrySize;
    });

    // Step E: Organic variation (small perpendicular jitter)
    const perpJitter = (Math.random() - 0.5) * 20; // 10-14px range, shared direction
    const perpJitterDir = Math.random() > 0.5 ? 1 : -1;
    
    workingPositions.forEach(pos => {
      const jitterAmount = (Math.random() * 6 + 8) * perpJitterDir; // 8-14px in same direction
      pos.x += layoutPerp[0] * jitterAmount;
      pos.y += layoutPerp[1] * jitterAmount;
    });

    // Step F: Movement caps
    const MAX_MOVEMENT = 120;
    
    workingPositions.forEach(pos => {
      const dx = pos.x - pos.original.x;
      const dy = pos.y - pos.original.y;
      const totalDist = Math.sqrt(dx * dx + dy * dy);
      
      if (totalDist > MAX_MOVEMENT) {
        const scale = MAX_MOVEMENT / totalDist;
        pos.x = pos.original.x + dx * scale;
        pos.y = pos.original.y + dy * scale;
      }
      
      alignedEntries.push({
        id: pos.id,
        position: { x: pos.x, y: pos.y },
        original: pos.original
      });
    });
  });

  if (alignedEntries.length === 0) return;

  // Animate position changes
  alignedEntries.forEach(({ id, position, original }) => {
    const entryData = entries.get(id);
    if (!entryData) return;

    const element = entryData.element;
    const startX = original.x;
    const startY = original.y;
    const endX = position.x;
    const endY = position.y;

    // Step G: Animate over 700-900ms with ease-out
    const duration = 700 + Math.random() * 200;
    const startTime = performance.now();

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentX = startX + (endX - startX) * eased;
      const currentY = startY + (endY - startY) * eased;

      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Update stored position
        entryData.position = { x: endX, y: endY };
      }
    }

    requestAnimationFrame(animate);
  });

  // Save updated positions after animation completes
  setTimeout(async () => {
    const entriesToSave = alignedEntries.map(e => {
      const entryData = entries.get(e.id);
      return {
        id: e.id,
        text: entryData.text,
        position: e.position,
        parentEntryId: entryData.parentEntryId || null,
        mediaCardData: entryData.mediaCardData || null,
        linkCardsData: entryData.linkCardsData || null,
        latexData: entryData.latexData || null
      };
    });

    try {
      await fetch('/api/entries/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave, pageOwnerId: window.PAGE_OWNER_ID })
      });
    } catch (error) {
      console.error('Error saving aligned positions:', error);
    }
  }, 950); // Slightly after animation completes (max 900ms + buffer)
}

// Autocomplete toggle functionality
const toggleButton = document.getElementById('toggle-button');

if (toggleButton) {
  // Ensure initial pressed state matches current value
  toggleButton.classList.toggle('active', mediaAutocompleteEnabled);

  toggleButton.addEventListener('click', () => {
    mediaAutocompleteEnabled = !mediaAutocompleteEnabled;
    toggleButton.classList.toggle('active', mediaAutocompleteEnabled);

    if (mediaAutocompleteEnabled) {
      // Trigger autocomplete search if editor has content
      if (editor.style.display !== 'none' && editor.innerText.trim().length >= 3) {
        handleAutocompleteSearch();
      }
    } else {
      hideAutocomplete(); // Hide autocomplete when switching to text mode
    }
  });
}

// LaTeX toggle functionality
const latexToggleButton = document.getElementById('latex-toggle-button');
if (latexToggleButton) {
  latexToggleButton.classList.toggle('active', latexModeEnabled);
  latexToggleButton.addEventListener('click', () => {
    latexModeEnabled = !latexModeEnabled;
    latexToggleButton.classList.toggle('active', latexModeEnabled);
  });
}

// Help modal functionality
const helpButton = document.getElementById('help-button');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');

if (helpButton) {
  helpButton.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });
}

if (helpClose) {
  helpClose.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });
}

if (helpModal) {
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.classList.add('hidden');
    }
  });
  // Help category toggles
  helpModal.querySelectorAll('.help-category-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.closest('.help-category');
      const isOpen = cat.getAttribute('data-open') === 'true';
      cat.setAttribute('data-open', isOpen ? 'false' : 'true');
    });
  });
}

// ——— Text format bar ———
function updateFormatBarState() {
  if (!formatBar || !editor || document.activeElement !== editor) return;
  if (formatBtnBold) formatBtnBold.classList.toggle('active', document.queryCommandState('bold'));
  if (formatBtnItalic) formatBtnItalic.classList.toggle('active', document.queryCommandState('italic'));
  if (formatBtnUnderline) formatBtnUnderline.classList.toggle('active', document.queryCommandState('underline'));
  if (formatBtnStrike) formatBtnStrike.classList.toggle('active', document.queryCommandState('strikeThrough'));
}

function saveSelectionInEditor() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  return { range };
}

function restoreSelection(saved) {
  if (!saved || !saved.range) return;
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved.range);
  } catch (_) {}
}

function getSelectionFontSize() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    // No selection - return editor's base font size
    const editorFontSize = parseFloat(window.getComputedStyle(editor).fontSize);
    return isNaN(editorFontSize) ? 16 : Math.round(editorFontSize);
  }
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!editor.contains(node)) {
    // Fallback to editor's base font size
    const editorFontSize = parseFloat(window.getComputedStyle(editor).fontSize);
    return isNaN(editorFontSize) ? 16 : Math.round(editorFontSize);
  }
  const px = parseFloat(window.getComputedStyle(node).fontSize);
  return isNaN(px) ? 16 : Math.round(px);
}

function applyFontSizePx(px, savedSelection) {
  editor.focus();
  if (savedSelection) restoreSelection(savedSelection);
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
  const size = Math.min(72, Math.max(10, Number(px) || 16));
  const range = sel.getRangeAt(0);
  
  if (range.collapsed) {
    // For collapsed cursor: insert a zero-width space in a span with the font size
    // This ensures future typing inherits the font size without affecting existing text
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    span.appendChild(document.createTextNode('\u200B')); // Zero-width space
    range.insertNode(span);
    
    // Position cursor after the zero-width space inside the span
    const newRange = document.createRange();
    newRange.setStart(span.firstChild, 1);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    
    if (formatFontPx) formatFontPx.value = size;
    updateFormatBarState();
  } else {
    // For selection: wrap in span with font-size
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
    
    // Select the wrapped content
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(newRange);
    
    if (formatFontPx) formatFontPx.value = size;
    updateFormatBarState();
  }
  
  // Update editing border dimensions to match new font size
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      // Use requestAnimationFrame to ensure DOM is updated with new font size
      requestAnimationFrame(() => {
        updateEditingBorderDimensions(entryData.element);
      });
    }
  }
}

function applyFormat(cmd, value, savedSelection) {
  editor.focus();
  if (savedSelection) restoreSelection(savedSelection);
  document.execCommand(cmd, false, value);
  updateFormatBarState();
}

if (formatBar && editor) {
  editor.addEventListener('focus', () => {
    updateFormatBarState();
    if (formatFontPx) formatFontPx.value = getSelectionFontSize();
  });

  editor.addEventListener('selectionchange', () => {
    updateFormatBarState();
    if (formatFontPx && document.activeElement === editor) formatFontPx.value = getSelectionFontSize();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) {
      updateFormatBarState();
      if (formatFontPx) formatFontPx.value = getSelectionFontSize();
    }
  });
}

function handleFormatButton(cmd, value) {
  return (e) => {
    e.preventDefault();
    const saved = saveSelectionInEditor();
    applyFormat(cmd, value, saved);
  };
}

if (formatFontDecrease) formatFontDecrease.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const saved = saveSelectionInEditor();
  const current = getSelectionFontSize();
  applyFontSizePx(current - 2, saved);
});
if (formatFontIncrease) formatFontIncrease.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const saved = saveSelectionInEditor();
  const current = getSelectionFontSize();
  applyFontSizePx(current + 2, saved);
});
if (formatFontPx) {
  const applyFontPxFromInput = () => {
    const saved = saveSelectionInEditor();
    const px = parseInt(formatFontPx.value, 10);
    if (!isNaN(px)) applyFontSizePx(px, saved);
  };
  formatFontPx.addEventListener('change', applyFontPxFromInput);
  formatFontPx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFontPxFromInput();
      editor.focus();
    }
  });
  formatFontPx.addEventListener('blur', () => {
    if (editor.style.display === 'block') editor.focus();
  });
  formatFontPx.addEventListener('mousedown', (e) => e.stopPropagation());
}
if (formatBtnBold) formatBtnBold.addEventListener('mousedown', handleFormatButton('bold'));
if (formatBtnItalic) formatBtnItalic.addEventListener('mousedown', handleFormatButton('italic'));
if (formatBtnUnderline) formatBtnUnderline.addEventListener('mousedown', handleFormatButton('underline'));
if (formatBtnStrike) formatBtnStrike.addEventListener('mousedown', handleFormatButton('strikeThrough'));

if (formatBar) {
  formatBar.addEventListener('mousedown', (e) => {
    if (formatFontPx && (e.target === formatFontPx || formatFontPx.contains(e.target))) return;
    e.preventDefault();
  });
}

// ——— Canvas chat (trenches + proactive bot) ———
function entryTitle(ed) {
  if (!ed) return 'Untitled';
  if (ed.mediaCardData && ed.mediaCardData.title) return ed.mediaCardData.title;
  const first = (ed.text || '').split('\n')[0].trim();
  return first ? first.substring(0, 80) : 'Untitled';
}

function dataPointsFromEntry(ed) {
  const out = [];
  const base = { id: ed.id, position: ed.position };
  if (ed.mediaCardData) {
    out.push({
      ...base,
      type: ed.mediaCardData.type === 'song' ? 'song' : ed.mediaCardData.type === 'movie' ? 'movie' : 'media',
      title: ed.mediaCardData.title,
      artist: ed.mediaCardData.artist,
      year: ed.mediaCardData.year,
      url: ed.mediaCardData.url
    });
  } else if (ed.linkCardsData && ed.linkCardsData.length) {
    for (const l of ed.linkCardsData) {
      if (!l) continue;
      out.push({
        ...base,
        type: 'link',
        title: l.title,
        url: l.url,
        description: l.description || null,
        siteName: l.siteName || null
      });
    }
  }
  if (out.length === 0) {
    out.push({
      ...base,
      type: 'text',
      text: (ed.text || '').trim().slice(0, 500)
    });
  }
  return out;
}

function dist(a, b) {
  const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
  const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function buildTrenchesPayload() {
  const all = Array.from(entries.values()).filter(e => e.id);
  const roots = all.filter(e => !e.parentEntryId);
  const k = 4;
  
  // Recursively build a trench with all nested sub-trenches; traverse fully
  function buildTrenchRecursive(entry, allEntries, depth = 0) {
    const children = allEntries.filter(e => e.parentEntryId === entry.id);
    const hasChild = (e) => allEntries.some(c => c.parentEntryId === e.id);
    const directDataPoints = children.filter(e => !hasChild(e));
    const subTrenches = children.filter(hasChild);
    
    const trench = {
      id: entry.id,
      title: entryTitle(entry),
      position: entry.position,
      dataPoints: directDataPoints.flatMap(dataPointsFromEntry),
      subTrenches: subTrenches.map(st => buildTrenchRecursive(st, allEntries, depth + 1))
    };
    
    // Calculate nearby IDs (spatial proximity)
    const others = allEntries.filter(x => x.id !== entry.id && x.position);
    const sorted = others.map(o => ({ id: o.id, d: dist(entry, o) })).sort((a, b) => a.d - b.d);
    trench.nearbyIds = sorted.slice(0, k).map(x => x.id);
    
    return trench;
  }
  
  const payload = [];
  for (const r of roots) {
    payload.push(buildTrenchRecursive(r, all));
  }
  
  // If we're inside a specific trench, also include it and all its descendants
  let focusedTrench = null;
  if (currentViewEntryId) {
    const focusedEntry = all.find(e => e.id === currentViewEntryId);
    if (focusedEntry) {
      focusedTrench = buildTrenchRecursive(focusedEntry, all);
    }
  }
  
  return { trenches: payload, currentViewEntryId, focusedTrench };
}

// ——— Drop zone + dialog ———
const dropZone = document.getElementById('drop-zone');
const dropDialog = document.getElementById('drop-dialog');
const dropDialogMessages = document.getElementById('drop-dialog-messages');
const dropDialogInput = document.getElementById('drop-dialog-input');
const dropDialogSend = document.getElementById('drop-dialog-send');
const dropDialogClose = document.getElementById('drop-dialog-close');
const dropDialogBackdrop = dropDialog ? dropDialog.querySelector('.drop-dialog-backdrop') : null;

let dropOrganizeContext = null; // { content, previousPlacements } for follow-up replies
let dropDialogMode = null; // 'chat' | 'organize'

function isFocusInDropDialog() {
  return dropDialog && !dropDialog.classList.contains('hidden') && dropDialog.contains(document.activeElement);
}

function addDropDialogMessage(text, role, loading = false) {
  if (!dropDialogMessages) return null;
  const div = document.createElement('div');
  div.className = `drop-dialog-msg ${role}` + (loading ? ' loading' : '');
  div.textContent = text;
  dropDialogMessages.appendChild(div);
  dropDialogMessages.scrollTop = dropDialogMessages.scrollHeight;
  return div;
}

function openDropDialog() {
  if (!dropDialog) return;
  dropDialog.classList.remove('hidden');
  if (dropDialogInput) dropDialogInput.focus();
}

function closeDropDialog() {
  if (!dropDialog) return;
  dropDialog.classList.add('hidden');
  dropOrganizeContext = null;
  dropDialogMode = null;
}

async function sendChatRequest(userMessage = null) {
  const payload = buildTrenchesPayload();
  const body = { ...payload, userMessage };
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Chat failed');
  }
  const data = await res.json();
  return data.message;
}

function openDropDialogAsChat() {
  if (!dropDialog || !dropDialogMessages) return;
  dropDialogMode = 'chat';
  dropOrganizeContext = null;
  dropDialogMessages.innerHTML = '';
  openDropDialog();
  if (!currentUser) {
    addDropDialogMessage('Sign in to use canvas chat.', 'bot');
    return;
  }
  const loader = addDropDialogMessage('…', 'bot', true);
  sendChatRequest(null)
    .then(msg => { loader.remove(); addDropDialogMessage(msg, 'bot'); })
    .catch(err => { loader.remove(); addDropDialogMessage(err.message || 'Something went wrong.', 'bot'); });
}

function handleDropDialogSend() {
  if (!currentUser) return;
  const raw = (dropDialogInput?.value || '').trim();
  if (!raw) return;
  dropDialogInput.value = '';
  addDropDialogMessage(raw, 'user');

  if (dropDialogMode === 'organize' && dropOrganizeContext) {
    // Follow-up reply for drop organize
    const loader = addDropDialogMessage('…', 'bot', true);
    const payload = buildTrenchesPayload();
    const body = {
      ...payload,
      content: dropOrganizeContext.content,
      userReply: raw,
      previousPlacements: dropOrganizeContext.previousPlacements
    };
    fetch('/api/drop-organize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(r => r.json())
      .then(data => {
        loader.remove();
        if (data.error) {
          addDropDialogMessage(data.error, 'bot');
          return;
        }
        if (data.action === 'create_and_place' && data.trenchName && data.placements?.length) {
          createTrenchAndPlace(data.trenchName, data.placements);
          addDropDialogMessage(data.message || `Created "${data.trenchName}" and placed items.`, 'bot');
          dropOrganizeContext = null;
        } else if (data.action === 'place' && data.placements?.length) {
          executePlacements(data.placements);
          addDropDialogMessage(data.message || 'Done! Items placed.', 'bot');
          dropOrganizeContext = null;
        } else if (data.action === 'ask') {
          addDropDialogMessage(data.message || 'Could you clarify?', 'bot');
          dropOrganizeContext.previousPlacements = data.placements;
        }
      })
      .catch(err => { loader.remove(); addDropDialogMessage(err.message || 'Something went wrong.', 'bot'); });
  } else {
    // Chat mode
    const loader = addDropDialogMessage('…', 'bot', true);
    sendChatRequest(raw)
      .then(msg => { loader.remove(); addDropDialogMessage(msg, 'bot'); })
      .catch(err => { loader.remove(); addDropDialogMessage(err.message || 'Something went wrong.', 'bot'); });
  }
}

// Golden angle spiral layout
const GOLDEN_ANGLE_DEG = 137.508;

function goldenAngleSpiralPosition(n, baseRadius = 80) {
  const angle = n * GOLDEN_ANGLE_DEG * (Math.PI / 180);
  const r = baseRadius * Math.sqrt(n + 1);
  const jitterX = (Math.random() - 0.5) * 30;
  const jitterY = (Math.random() - 0.5) * 30;
  return { x: Math.cos(angle) * r + jitterX, y: Math.sin(angle) * r + jitterY };
}

function computeSpiralCenter(targetPageId) {
  let sumX = 0, sumY = 0, count = 0;
  for (const [, ed] of entries) {
    if ((ed.parentEntryId || null) === (targetPageId || null)) {
      if (ed.position) { sumX += ed.position.x; sumY += ed.position.y; count++; }
    }
  }
  if (count > 0) return { x: sumX / count, y: sumY / count };
  // Fallback: viewport center in world coords
  const rect = viewport.getBoundingClientRect();
  const wc = screenToWorld(rect.width / 2, rect.height / 2);
  return { x: wc.x, y: wc.y };
}

function findNonOverlappingPosition(baseX, baseY) {
  let x = baseX, y = baseY;
  let attempts = 0;
  while (positionOverlapsEntry(x, y) && attempts < 20) {
    x += 40 + Math.random() * 20;
    y += 20 + Math.random() * 10;
    attempts++;
  }
  return { x, y };
}

// Collect dropped items from DataTransfer
async function collectDroppedItems(dataTransfer) {
  const items = [];
  // Check files first
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of dataTransfer.files) {
      if (file.type.startsWith('image/')) {
        try {
          const compressed = await compressImageFile(file);
          const form = new FormData();
          form.append('file', compressed);
          const res = await fetch('/api/upload-image', { method: 'POST', credentials: 'include', body: form });
          if (res.ok) {
            const data = await res.json();
            items.push({ type: 'image', url: data.url, name: file.name });
          }
        } catch (e) { console.error('Image upload failed:', e); }
      } else {
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/upload-file', { method: 'POST', credentials: 'include', body: form });
          if (res.ok) {
            const data = await res.json();
            items.push({ type: 'file', url: data.url, name: data.name, size: data.size, mimetype: data.mimetype });
          }
        } catch (e) { console.error('File upload failed:', e); }
      }
    }
  }
  // Check text/URI
  if (items.length === 0) {
    const uriList = dataTransfer.getData('text/uri-list');
    const plainText = dataTransfer.getData('text/plain');
    const textToCheck = uriList || plainText || '';
    if (textToCheck) {
      // Check if it's a URL
      const lines = textToCheck.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      for (const line of lines) {
        try {
          new URL(line);
          items.push({ type: 'link', url: line });
        } catch {
          items.push({ type: 'text', text: line });
        }
      }
    }
  }
  return items;
}

// Process dropped items through the organize API
async function processDroppedItems(items) {
  if (!items.length) return;
  dropDialogMode = 'organize';
  dropDialogMessages.innerHTML = '';
  openDropDialog();
  addDropDialogMessage('Processing...', 'system');

  const contentType = items.length === 1 ? items[0].type : 'mixed';
  const content = { type: contentType, items };
  dropOrganizeContext = { content, previousPlacements: null };

  try {
    if (dropZone) dropZone.classList.add('processing');
    const payload = buildTrenchesPayload();
    const body = { ...payload, content };
    const res = await fetch('/api/drop-organize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (dropZone) dropZone.classList.remove('processing');

    // Remove processing message
    const sysMsg = dropDialogMessages.querySelector('.drop-dialog-msg.system');
    if (sysMsg) sysMsg.remove();

    if (data.error) {
      addDropDialogMessage(data.error, 'bot');
      return;
    }

    if (data.action === 'create_and_place' && data.trenchName && data.placements?.length) {
      createTrenchAndPlace(data.trenchName, data.placements);
      addDropDialogMessage(data.message || `Created "${data.trenchName}" and placed items.`, 'bot');
      dropOrganizeContext = null;
    } else if (data.action === 'place' && data.placements?.length) {
      executePlacements(data.placements);
      addDropDialogMessage(data.message || 'Done! Items placed on your canvas.', 'bot');
      dropOrganizeContext = null;
    } else if (data.action === 'ask') {
      addDropDialogMessage(data.message || 'Where should I place these?', 'bot');
      dropOrganizeContext.previousPlacements = data.placements;
      if (dropDialogInput) dropDialogInput.focus();
    }
  } catch (err) {
    if (dropZone) dropZone.classList.remove('processing');
    const sysMsg = dropDialogMessages.querySelector('.drop-dialog-msg.system');
    if (sysMsg) sysMsg.remove();
    addDropDialogMessage(err.message || 'Something went wrong.', 'bot');
  }
}

// Create a new trench (parent entry) and place items inside it
async function createTrenchAndPlace(trenchName, placements) {
  // Create the trench entry at a good spot on the current page
  const rect = viewport.getBoundingClientRect();
  const wc = screenToWorld(rect.width / 2, rect.height / 2);
  const pos = findNonOverlappingPosition(wc.x, wc.y);

  const trenchId = generateEntryId();
  const trenchEl = document.createElement('div');
  trenchEl.className = 'entry';
  trenchEl.id = trenchId;
  trenchEl.style.left = `${pos.x}px`;
  trenchEl.style.top = `${pos.y}px`;
  trenchEl.innerHTML = meltify(trenchName);
  world.appendChild(trenchEl);

  const trenchData = {
    id: trenchId,
    element: trenchEl,
    text: trenchName,
    position: { x: pos.x, y: pos.y },
    parentEntryId: currentViewEntryId
  };
  entries.set(trenchId, trenchData);
  updateEntryDimensions(trenchEl);
  await saveEntryToServer(trenchData);

  // Now place items inside this trench
  const placementsWithTarget = placements.map(p => ({
    targetPageId: trenchId,
    content: p.content || p
  }));
  executePlacements(placementsWithTarget);
}

// Execute placements from the LLM
function executePlacements(placements) {
  const grouped = {};
  for (const p of placements) {
    const target = p.targetPageId || null;
    if (!grouped[target]) grouped[target] = [];
    grouped[target].push(p.content);
  }

  for (const [targetPageId, contentItems] of Object.entries(grouped)) {
    const resolvedTarget = targetPageId === 'null' ? null : targetPageId;
    const center = computeSpiralCenter(resolvedTarget);

    contentItems.forEach((item, i) => {
      const offset = goldenAngleSpiralPosition(i, 80);
      const base = { x: center.x + offset.x, y: center.y + offset.y };
      const pos = findNonOverlappingPosition(base.x, base.y);

      if (item.type === 'image' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry canvas-image';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.style.width = '200px';
        entry.style.height = '150px';
        const img = document.createElement('img');
        img.src = getThumbUrl(item.url);
        img.dataset.fullSrc = item.url;
        img.alt = 'Canvas image';
        img.draggable = false;
        img.decoding = 'async';
        img.onload = () => updateEntryDimensions(entry);
        img.onerror = function() { if (this.src !== item.url) { this.src = item.url; } else { updateEntryDimensions(entry); } };
        entry.appendChild(img);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: '',
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget,
          mediaCardData: { type: 'image', url: item.url }
        };
        entries.set(entryId, entryData);
        saveEntryToServer(entryData);
      } else if (item.type === 'file' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry canvas-file';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        const mediaData = { type: 'file', url: item.url, name: item.name || 'File', size: item.size || 0, mimetype: item.mimetype || '' };
        entry.appendChild(createFileCard(mediaData));
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: item.name || 'File',
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget,
          mediaCardData: mediaData
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
      } else if (item.type === 'link' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.innerHTML = meltify(item.url);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: item.url,
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
        generateLinkCard(item.url).then(cardData => {
          if (cardData) {
            entryData.linkCardsData = [cardData];
            entry.appendChild(createLinkCard(cardData));
            updateEntryDimensions(entry);
            saveEntryToServer(entryData);
          }
        }).catch(() => {});
      } else {
        // Text entry
        const text = item.text || item.url || '';
        if (!text) return;
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.innerHTML = meltify(text);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: text,
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
      }
    });
  }

  updateEntryVisibility();
}

// Organize button
const organizeButton = document.getElementById('organize-button');
if (organizeButton) {
  organizeButton.addEventListener('click', () => {
    if (isReadOnly) return;
    organizeCanvasLayout();
  });
}

// Drop zone event listeners
if (dropZone) {
  dropZone.addEventListener('click', () => {
    if (isReadOnly) return;
    openDropDialogAsChat();
  });

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    // Only remove if truly leaving the drop zone
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    if (isReadOnly || !currentUser) return;
    const items = await collectDroppedItems(e.dataTransfer);
    if (items.length > 0) processDroppedItems(items);
  });
}

// Dialog event listeners
if (dropDialogClose) dropDialogClose.addEventListener('click', closeDropDialog);
if (dropDialogBackdrop) dropDialogBackdrop.addEventListener('click', closeDropDialog);
if (dropDialogSend) dropDialogSend.addEventListener('click', handleDropDialogSend);
if (dropDialogInput) {
  dropDialogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleDropDialogSend(); }
    if (e.key === 'Escape') { e.preventDefault(); closeDropDialog(); }
  });
}
if (dropDialog) {
  dropDialog.addEventListener('mousedown', (e) => e.stopPropagation());
  dropDialog.addEventListener('keydown', (e) => e.stopPropagation());
}

// Global drag awareness — highlight drop zone when anything is dragged over the window
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  if (isReadOnly || !dropZone) return;
  dragCounter++;
  if (dragCounter === 1) dropZone.classList.add('drag-over');
});
document.addEventListener('dragleave', (e) => {
  if (!dropZone) return;
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove('drag-over'); }
});
document.addEventListener('drop', () => {
  dragCounter = 0;
  if (dropZone) dropZone.classList.remove('drag-over');
});

// Hide drop zone in read-only mode
if (isReadOnly && dropZone) dropZone.style.display = 'none';

// User menu functionality
const userMenuButton = document.getElementById('user-menu-button');
const userMenuDropdown = document.getElementById('user-menu-dropdown');
const spacesList = document.getElementById('spaces-list');
const createSpaceButton = document.getElementById('create-space-button');
const createSpaceForm = document.getElementById('create-space-form');
const newUsernameInput = document.getElementById('new-username-input');
const newUsernameError = document.getElementById('new-username-error');
const createSpaceCancel = document.getElementById('create-space-cancel');
const createSpaceSubmit = document.getElementById('create-space-submit');
const logoutButton = document.getElementById('logout-button');
const userMenu = document.getElementById('user-menu');

let editingSpaceId = null;

// Hide user menu if not logged in
if (userMenu) {
  fetch('/api/auth/me', { credentials: 'include' })
    .then(res => {
      if (!res.ok) {
        userMenu.style.display = 'none';
      }
    })
    .catch(() => {
      userMenu.style.display = 'none';
    });
}

// Toggle dropdown
if (userMenuButton && userMenuDropdown) {
  userMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown.classList.toggle('hidden');
    if (!userMenuDropdown.classList.contains('hidden')) {
      loadSpaces();
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (userMenuDropdown && !userMenuDropdown.contains(e.target) && !userMenuButton.contains(e.target)) {
      userMenuDropdown.classList.add('hidden');
      if (createSpaceForm) {
        createSpaceForm.classList.add('hidden');
      }
      editingSpaceId = null;
    }
  });
}

// Load spaces
async function loadSpaces() {
  if (!spacesList) {
    console.log('[SPACES CLIENT] spacesList element not found');
    return;
  }
  
  console.log('[SPACES CLIENT] Starting to load spaces...');
  console.log('[SPACES CLIENT] Current user:', currentUser);
  console.log('[SPACES CLIENT] User logged in:', !!currentUser);
  
  try {
    console.log('[SPACES CLIENT] Fetching /api/auth/spaces with credentials: include');
    const response = await fetch('/api/auth/spaces', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('[SPACES CLIENT] Response status:', response.status);
    console.log('[SPACES CLIENT] Response ok:', response.ok);
    console.log('[SPACES CLIENT] Response headers:', {
      'content-type': response.headers.get('content-type'),
      'set-cookie': response.headers.get('set-cookie')
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch((e) => {
        console.error('[SPACES CLIENT] Failed to parse error response:', e);
        return { error: 'Failed to parse error response' };
      });
      console.error('[SPACES CLIENT] Failed to load spaces:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5);">No spaces found</div>';
      return;
    }
    
    const data = await response.json().catch((e) => {
      console.error('[SPACES CLIENT] Failed to parse JSON response:', e);
      return null;
    });
    
    console.log('[SPACES CLIENT] Response data:', data);
    console.log('[SPACES CLIENT] Spaces array:', data.spaces);
    console.log('[SPACES CLIENT] Spaces count:', data.spaces?.length || 0);
    
    if (data && data.spaces) {
      console.log('[SPACES CLIENT] Processing', data.spaces.length, 'spaces');
      data.spaces.forEach((space, index) => {
        console.log(`[SPACES CLIENT] Space ${index + 1}:`, space);
      });
    }
    
    spacesList.innerHTML = '';
    
    if (data && data.spaces && data.spaces.length > 0) {
      console.log('[SPACES CLIENT] Rendering', data.spaces.length, 'spaces');
      data.spaces.forEach(space => {
        console.log('[SPACES CLIENT] Rendering space:', space);
        const spaceItem = document.createElement('div');
        spaceItem.className = 'space-item';
        spaceItem.innerHTML = `
          <div class="space-item-content">
            <span class="space-username">${escapeHtml(space.username)}</span>
          </div>
          <button class="space-edit-button" data-space-id="${space.id}" data-space-username="${escapeHtml(space.username)}" title="Edit username">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        `;
        
        // Click to navigate
        spaceItem.querySelector('.space-item-content').addEventListener('click', () => {
          console.log('[SPACES CLIENT] Navigating to space:', space.username);
          window.location.href = `/${space.username}`;
        });
        
        // Edit button
        spaceItem.querySelector('.space-edit-button').addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[SPACES CLIENT] Editing space:', space.id, space.username);
          startEditingSpace(space.id, space.username);
        });
        
        spacesList.appendChild(spaceItem);
      });
      console.log('[SPACES CLIENT] Successfully rendered', data.spaces.length, 'spaces');
    } else {
      console.log('[SPACES CLIENT] No spaces found in response');
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5); font-style: italic;">No spaces yet</div>';
    }
  } catch (error) {
    console.error('[SPACES CLIENT] Error loading spaces:', error);
    console.error('[SPACES CLIENT] Error stack:', error.stack);
    spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: #dc2626;">Error loading spaces</div>';
  }
}

function startEditingSpace(spaceId, currentUsername) {
  editingSpaceId = spaceId;
  const spaceItem = Array.from(spacesList.children).find(item => 
    item.querySelector('.space-edit-button').dataset.spaceId === spaceId
  );
  
  if (!spaceItem) return;
  
  const content = spaceItem.querySelector('.space-item-content');
  const editButton = spaceItem.querySelector('.space-edit-button');
  
  const editForm = document.createElement('div');
  editForm.className = 'space-edit-form';
  editForm.innerHTML = `
    <input type="text" class="space-edit-input" value="${escapeHtml(currentUsername)}" maxlength="40" />
    <div class="username-error hidden"></div>
    <div class="space-edit-buttons">
      <button class="space-edit-cancel">Cancel</button>
      <button class="space-edit-save">Save</button>
    </div>
  `;
  
  const input = editForm.querySelector('.space-edit-input');
  const errorDiv = editForm.querySelector('.username-error');
  const cancelBtn = editForm.querySelector('.space-edit-cancel');
  const saveBtn = editForm.querySelector('.space-edit-save');
  
  content.replaceWith(editForm);
  editButton.style.display = 'none';
  
  input.focus();
  input.select();
  
  cancelBtn.addEventListener('click', () => {
    restoreSpaceItem(spaceItem, spaceId, currentUsername);
  });
  
  saveBtn.addEventListener('click', async () => {
    const newUsername = input.value.trim();
    if (!newUsername) {
      showError(input, errorDiv, 'Username is required');
      return;
    }
    
    if (newUsername === currentUsername) {
      restoreSpaceItem(spaceItem, spaceId, currentUsername);
      return;
    }
    
    try {
      const response = await fetch('/api/auth/update-username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newUsername: newUsername, spaceId: spaceId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        if (error.error === 'Username already taken') {
          showError(input, errorDiv, 'Username already taken');
        } else {
          showError(input, errorDiv, error.error || 'Failed to update username');
        }
        return;
      }
      
      // Success - reload page to new username
      const data = await response.json();
      window.location.href = `/${data.user.username}`;
    } catch (error) {
      showError(input, errorDiv, 'Failed to update username');
    }
  });
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });
}

function restoreSpaceItem(spaceItem, spaceId, username) {
  const editForm = spaceItem.querySelector('.space-edit-form');
  const editButton = spaceItem.querySelector('.space-edit-button');
  
  const content = document.createElement('div');
  content.className = 'space-item-content';
  content.innerHTML = `<span class="space-username">${escapeHtml(username)}</span>`;
  
  content.addEventListener('click', () => {
    window.location.href = `/${username}`;
  });
  
  editForm.replaceWith(content);
  editButton.style.display = '';
  editingSpaceId = null;
}

function showError(input, errorDiv, message) {
  input.classList.add('error');
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}


// Create new space
if (createSpaceButton && createSpaceForm) {
  createSpaceButton.addEventListener('click', () => {
    createSpaceForm.classList.toggle('hidden');
    if (!createSpaceForm.classList.contains('hidden')) {
      newUsernameInput.focus();
    }
  });
  
  createSpaceCancel.addEventListener('click', () => {
    createSpaceForm.classList.add('hidden');
    newUsernameInput.value = '';
    newUsernameError.classList.add('hidden');
    newUsernameInput.classList.remove('error');
  });
  
  createSpaceSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const username = newUsernameInput.value.trim();
    if (!username) {
      showError(newUsernameInput, newUsernameError, 'Username is required');
      return;
    }
    
    // Clear previous errors
    newUsernameInput.classList.remove('error');
    newUsernameError.classList.add('hidden');
    
    try {
      const response = await fetch('/api/auth/create-space', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create space' }));
        if (errorData.error === 'Username already taken') {
          showError(newUsernameInput, newUsernameError, 'Username already taken');
        } else {
          showError(newUsernameInput, newUsernameError, errorData.error || 'Failed to create space');
        }
        return;
      }
      
      // Success - navigate to new space
      const data = await response.json();
      if (data.user && data.user.username) {
        window.location.href = `/${data.user.username}`;
      } else {
        showError(newUsernameInput, newUsernameError, 'Failed to create space');
      }
    } catch (error) {
      console.error('Error creating space:', error);
      showError(newUsernameInput, newUsernameError, 'Failed to create space');
    }
  });
  
  newUsernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      createSpaceSubmit.click();
    } else if (e.key === 'Escape') {
      createSpaceCancel.click();
    }
  });
}

// Logout
if (logoutButton) {
  logoutButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Close the dropdown
    if (userMenuDropdown) {
      userMenuDropdown.classList.add('hidden');
    }
    
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      // Clear any local state
      currentUser = null;
      isLoggedIn = false;
      
      // Force a hard redirect to root with cache busting to ensure fresh page load
      window.location.replace('/?logout=true&t=' + Date.now());
    } catch (error) {
      console.error('Error logging out:', error);
      // Still redirect even if logout fails
      currentUser = null;
      isLoggedIn = false;
      window.location.replace('/?logout=true&t=' + Date.now());
    }
  });
}

// Handle new space button - show inline form
const newSpaceButton = document.getElementById('new-space-button');
let isCreatingNewSpace = false;

if (newSpaceButton) {
  newSpaceButton.addEventListener('click', () => {
    if (isCreatingNewSpace) return;
    
    // Hide the button and show form
    newSpaceButton.style.display = 'none';
    isCreatingNewSpace = true;
    
    // Create form similar to edit form
    const newSpaceForm = document.createElement('div');
    newSpaceForm.className = 'space-edit-form';
    newSpaceForm.innerHTML = `
      <input type="text" class="space-edit-input" placeholder="Enter username" maxlength="40" />
      <div class="username-error hidden"></div>
      <div class="space-edit-buttons">
        <button class="space-edit-cancel">Cancel</button>
        <button class="space-edit-save">Create</button>
      </div>
    `;
    
    const input = newSpaceForm.querySelector('.space-edit-input');
    const errorDiv = newSpaceForm.querySelector('.username-error');
    const cancelBtn = newSpaceForm.querySelector('.space-edit-cancel');
    const saveBtn = newSpaceForm.querySelector('.space-edit-save');
    
    // Insert form before the button
    newSpaceButton.parentNode.insertBefore(newSpaceForm, newSpaceButton);
    
    input.focus();
    
    const cleanup = () => {
      newSpaceForm.remove();
      newSpaceButton.style.display = 'block';
      isCreatingNewSpace = false;
    };
    
    cancelBtn.addEventListener('click', cleanup);
    
    saveBtn.addEventListener('click', async () => {
      const trimmed = input.value.trim();
      if (!trimmed) {
        showError(input, errorDiv, 'Username is required');
        return;
      }
      
      try {
        const response = await fetch('/api/auth/create-space', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: trimmed })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          if (data.error === 'Username already taken') {
            showError(input, errorDiv, 'Username already taken');
          } else {
            showError(input, errorDiv, data.error || 'Failed to create space');
          }
          return;
        }
        
        // Navigate to the new space
        window.location.href = `/${data.user.username}`;
      } catch (error) {
        console.error('Error creating space:', error);
        showError(input, errorDiv, 'Failed to create space');
      }
    });
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cleanup();
      }
    });
  });
}

// Search modal removed - using autocomplete instead

// Autocomplete functions
let autocompleteIsShowing = false;
let isSelectingAutocomplete = false;

function handleAutocompleteSearch() {
  // Only show autocomplete if:
  // 1. Editor is visible (in edit mode)
  // 2. Media autocomplete is enabled
  if (!autocomplete || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    autocompleteIsShowing = false;
      return;
    }

  const text = editor.innerText || editor.textContent || '';
  const trimmed = text.trim();
  
  // Only search if we have at least 3 characters
  if (trimmed.length < 3) {
    hideAutocomplete();
    autocompleteIsShowing = false;
      return;
    }

  // Debounce search
  clearTimeout(autocompleteSearchTimeout);
  autocompleteSearchTimeout = setTimeout(() => {
    searchMedia(trimmed);
  }, 300);
}

// Check if a result is relevant to the query
// Returns true only if ALL meaningful words from query match the result
function isRelevantMatch(query, result) {
  const queryLower = query.toLowerCase().trim();
  const titleLower = (result.title || '').toLowerCase();
  const artistLower = (result.artist || '').toLowerCase();
  
  // Combine title and artist for matching
  const combinedText = `${titleLower} ${artistLower}`;
  
  // Extract meaningful words from query (ignore common words)
  const commonWords = ['the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'is', 'are', 'was', 'were'];
  const queryWords = queryLower.split(/\s+/).filter(word => {
    const cleaned = word.replace(/[^\w]/g, '');
    return cleaned.length > 2 && !commonWords.includes(cleaned);
  });
  
  // If query is very short or has no meaningful words, require exact match
  if (queryWords.length === 0) {
    return titleLower.includes(queryLower) || artistLower.includes(queryLower);
  }
  
  // STRICT: ALL meaningful words must appear in title OR artist
  // This prevents showing results when there's extra unrelated text
  const allWordsMatch = queryWords.every(word => 
    titleLower.includes(word) || artistLower.includes(word)
  );
  
  // Also allow if the query is a substring of title or artist (for exact matches)
  const hasSubstringMatch = titleLower.includes(queryLower) || artistLower.includes(queryLower);
  
  // Only show if ALL words match OR it's a substring match
  return allWordsMatch || hasSubstringMatch;
}

async function searchMedia(query) {
  if (!autocomplete) return;

  console.log('[Autocomplete] Searching for:', query);

  try {
    // Search both movies and songs in parallel
    const [moviesRes, songsRes] = await Promise.all([
      fetch(`/api/search/movies?q=${encodeURIComponent(query)}`),
      fetch(`/api/search/songs?q=${encodeURIComponent(query)}`)
    ]);

    console.log('[Autocomplete] Movies response:', moviesRes.ok, moviesRes.status);
    console.log('[Autocomplete] Songs response:', songsRes.ok, songsRes.status);

    const moviesData = moviesRes.ok ? await moviesRes.json() : { results: [] };
    const songsData = songsRes.ok ? await songsRes.json() : { results: [] };

    console.log('[Autocomplete] Movies results:', moviesData.results?.length || 0);
    console.log('[Autocomplete] Songs results:', songsData.results?.length || 0);

    // Filter results to only show relevant matches
    const movies = (moviesData.results || []).filter(result => isRelevantMatch(query, result));
    const songs = (songsData.results || []).filter(result => isRelevantMatch(query, result));
    
    // Only show if we have at least one relevant match
    if (movies.length === 0 && songs.length === 0) {
      console.log('[Autocomplete] No relevant matches found');
      hideAutocomplete();
      return;
    }

    // Interleave movies and songs for equal weighting
    const allResults = [];
    const maxLength = Math.max(movies.length, songs.length);
    
    for (let i = 0; i < maxLength; i++) {
      if (i < movies.length) allResults.push(movies[i]);
      if (i < songs.length) allResults.push(songs[i]);
    }

    console.log('[Autocomplete] Showing', allResults.length, 'relevant results');
    autocompleteResults = allResults;
    showAutocomplete(allResults);
  } catch (error) {
    console.error('[Autocomplete] Error searching media:', error);
    hideAutocomplete();
  }
}

function showAutocomplete(results) {
  if (!autocomplete) {
    console.error('[Autocomplete] Autocomplete element not found!');
    return;
  }

  console.log('[Autocomplete] Showing autocomplete with', results.length, 'results');

  autocomplete.innerHTML = '';
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false; // Reset keyboard navigation flag

  results.forEach((result, index) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.index = index;

    const imageHtml = result.image || result.poster
      ? `<div class="autocomplete-item-image" style="background-image: url('${result.image || result.poster}')"></div>`
      : '<div class="autocomplete-item-image"></div>';

    const subtitle = result.type === 'song'
      ? result.artist
      : result.type === 'movie'
      ? result.year ? `(${result.year})` : ''
      : '';

    item.innerHTML = `
      ${imageHtml}
      <div class="autocomplete-item-content">
        <div class="autocomplete-item-title">${escapeHtml(result.title)}</div>
        ${subtitle ? `<div class="autocomplete-item-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="autocomplete-item-type">${result.type === 'song' ? '🎵 Song' : '🎬 Movie'}</div>
      </div>
    `;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isSelectingAutocomplete = true;
    });

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAutocompleteResult(result);
    });

    item.addEventListener('mouseenter', () => {
      autocompleteSelectedIndex = index;
      autocompleteKeyboardNavigation = false; // Mouse hover doesn't count as keyboard navigation
      updateAutocompleteSelection();
    });

    autocomplete.appendChild(item);
  });

  // Position autocomplete below editor
  updateAutocompletePosition();
  autocomplete.classList.remove('hidden');
  
  console.log('[Autocomplete] Autocomplete displayed at', autocomplete.style.top, autocomplete.style.left);
}

function updateAutocompletePosition() {
  // Only update position if editor is visible (in edit mode) and media autocomplete is enabled
  if (!autocomplete || !editor || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    return;
  }

  const editorRect = editor.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  // Position below editor, relative to viewport
  const top = editorRect.bottom - viewportRect.top + 8;
  const left = editorRect.left - viewportRect.left;

  autocomplete.style.top = `${top}px`;
  autocomplete.style.left = `${left}px`;
  autocomplete.style.maxWidth = `${Math.min(400, viewportRect.width - left - 16)}px`;
}

function updateAutocompleteSelection() {
  if (!autocomplete) return;

  const items = autocomplete.querySelectorAll('.autocomplete-item');
  items.forEach((item, index) => {
    if (index === autocompleteSelectedIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function hideAutocomplete() {
  if (!autocomplete) return;
  autocomplete.classList.add('hidden');
  autocomplete.innerHTML = '';
  autocompleteResults = [];
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false; // Reset keyboard navigation flag
  autocompleteIsShowing = false;
}

function selectAutocompleteResult(result) {
  hideAutocomplete();

  // Check if we're editing an existing entry
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (!entryData) {
      console.warn('[Autocomplete] Missing entry data for edit. Aborting selection to avoid duplicate:', editingEntryId);
      if (editorWorldPos) {
        showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
      } else {
        hideCursor();
      }
      editingEntryId = null;
      return;
    }
    if (entryData) {
      // Replace existing entry with media card
      // Remove existing content
      entryData.element.innerHTML = '';
      entryData.element.classList.remove('editing', 'deadline-editing');
      
      // Update entry data
      entryData.text = ''; // Clear text - title is in mediaCardData
      entryData.mediaCardData = result;
      entryData.linkCardsData = null; // Clear any link cards
      
      // Add media card
      const card = createMediaCard(result);
      entryData.element.appendChild(card);
      
      // Clear and hide editor
      if (editorWorldPos) {
        showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
      } else {
        hideCursor();
      }
      editingEntryId = null;
      
      // Update entry dimensions and save
      setTimeout(() => {
        updateEntryDimensions(entryData.element);
        saveEntryToServer(entryData);
      }, 50);
      
      return;
    }
  }

  // Create new entry with media card
  const worldPos = editorWorldPos;
  
  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = 'entry melt';
  entry.id = entryId;
  
  entry.style.left = `${worldPos.x}px`;
  entry.style.top = `${worldPos.y}px`;
  
  world.appendChild(entry);
  
  const entryData = {
    id: entryId,
    element: entry,
    text: '', // Keep text empty for media cards - title is in mediaCardData
    position: { x: worldPos.x, y: worldPos.y },
    parentEntryId: currentViewEntryId,
    mediaCardData: result
  };
  entries.set(entryId, entryData);
  
  // Add media card to entry (no text content)
  const card = createMediaCard(result);
  entry.appendChild(card);
  
  // Clear editor and show cursor at current position
  if (editorWorldPos) {
    showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
  } else {
    hideCursor();
  }
  editingEntryId = null;
  
  // Update visibility
  updateEntryVisibility();
  
  // Update entry dimensions and save
  setTimeout(() => {
    updateEntryDimensions(entry);
    saveEntryToServer(entryData);
    
    // Save undo state
    saveUndoState('create', {
      entry: entryData
    });
  }, 50);
}

function createMediaCard(mediaData) {
  const card = document.createElement('div');
  card.className = mediaData.image || mediaData.poster ? 'media-card' : 'media-card media-card-no-image';
  card.dataset.mediaId = mediaData.id;
  card.dataset.type = mediaData.type;
  card.dataset.title = mediaData.title;

  const imageUrl = mediaData.image || mediaData.poster;
  const typeLabel = mediaData.type === 'song' ? 'Song' : 'Movie';
  const subtitle = mediaData.type === 'song'
    ? mediaData.artist
    : mediaData.type === 'movie'
    ? mediaData.year ? `${mediaData.year}` : ''
    : '';

  const cardContent = `
    <div class="media-card-inner">
      ${imageUrl ? `<div class="media-card-image" style="background-image: url('${imageUrl}')"></div>` : ''}
      <div class="media-card-content">
        <div class="media-card-type">${typeLabel}</div>
        <div class="media-card-title">${escapeHtml(mediaData.title)}</div>
        ${subtitle ? `<div class="media-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>
    </div>
  `;

  card.innerHTML = cardContent;

  // Single click: Command/Ctrl+click opens in new tab
  card.addEventListener('click', (e) => {
    // Don't handle click if shift was held (shift+click is for dragging)
    // Also don't handle if we just finished dragging (prevents navigation after drag)
    if (e.shiftKey || justFinishedDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    e.stopPropagation();
    
    // Command/Ctrl+click opens in new tab
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (mediaData.type === 'song' && mediaData.spotifyUrl) {
        window.open(mediaData.spotifyUrl, '_blank');
      } else if (mediaData.type === 'movie') {
        window.open(`https://www.themoviedb.org/movie/${mediaData.id}`, '_blank');
      }
      return;
    }
    
    // Regular single click does nothing (allows dragging)
  });
  
  // Double click: navigate into the entry (like text entries)
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Regular double-click navigates into the entry
    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      navigateToEntry(entryEl.id);
    }
  });
  
  // Allow mousedown to bubble for dragging, but prevent click from bubbling
  // This allows dragging cards while still preventing unwanted click behavior
  card.addEventListener('mousedown', (e) => {
    // Allow shift+click to bubble for dragging
    // For regular clicks, we still want to allow dragging, so don't stop propagation
    // The entry handler will handle the drag
  });

  // Right-click to edit the media card's link (similar to link cards)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Don't allow editing in read-only mode
    if (isReadOnly) return;
    
    // Get the entry this card belongs to
    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const rect = entryEl.getBoundingClientRect();
        const worldPos = screenToWorld(rect.left, rect.top);
        
        // Get the URL to edit
        let urlToEdit = '';
        if (mediaData.type === 'song' && mediaData.spotifyUrl) {
          urlToEdit = mediaData.spotifyUrl;
        } else if (mediaData.type === 'movie') {
          urlToEdit = `https://www.themoviedb.org/movie/${mediaData.id}`;
        }
        
        placeEditorAtWorld(worldPos.x, worldPos.y, urlToEdit, entryEl.id);
      }
    }
  });

  // Hover effects similar to link cards
  card.addEventListener('mouseenter', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.add('has-media-card-hover');
    }
  });

  card.addEventListener('mouseleave', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.remove('has-media-card-hover');
    }
  });

  return card;
}

// Hide autocomplete when clicking outside
document.addEventListener('click', (e) => {
  if (autocomplete && !autocomplete.contains(e.target) && e.target !== editor && !editor.contains(e.target)) {
    hideAutocomplete();
  }
});

// Update autocomplete position when editor moves or viewport changes
const updateAutocompleteOnMove = () => {
  if (autocomplete && !autocomplete.classList.contains('hidden')) {
    updateAutocompletePosition();
  }
};

editor.addEventListener('input', updateAutocompleteOnMove);
window.addEventListener('scroll', updateAutocompleteOnMove);
window.addEventListener('resize', updateAutocompleteOnMove);

// Selection helper functions
function clearSelection() {
  selectedEntries.forEach(entryId => {
    const entryData = entries.get(entryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('selected');
    }
  });
  selectedEntries.clear();
  
  // Show cursor again when selection is cleared (if not in read-only mode and not editing)
  if (!isReadOnly && !editingEntryId) {
    showCursorInDefaultPosition();
  }
}

function selectEntriesInBox(minX, minY, maxX, maxY) {
  // Clear previous selection
  clearSelection();
  
  // Check each entry to see if it touches the box (not just fully contained)
  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;
    
    const entry = entryData.element;
    if (!entry || entry.style.display === 'none') return;
    
    const rect = entry.getBoundingClientRect();
    // Convert entry corners to world coordinates
    const entryTopLeft = screenToWorld(rect.left, rect.top);
    const entryBottomRight = screenToWorld(rect.right, rect.bottom);
    
    // Check if entry overlaps with selection box (AABB collision)
    const overlaps = !(entryBottomRight.x < minX || entryTopLeft.x > maxX || 
                       entryBottomRight.y < minY || entryTopLeft.y > maxY);
    
    if (overlaps) {
      selectedEntries.add(entryId);
      entry.classList.add('selected');
    }
  });
  
  // Hide cursor when entries are selected
  if (selectedEntries.size > 0) {
    hideCursor();
  }
}

// Undo system functions
function saveUndoState(action, data) {
  undoStack.push({ action, data, timestamp: Date.now() });
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift(); // Remove oldest state
  }
}

async function performUndo() {
  if (undoStack.length === 0) return;
  
  const state = undoStack.pop();
  console.log('[Undo] Restoring state:', state.action);
  
  switch (state.action) {
    case 'delete':
      // Restore deleted entries
      // Sort entries so parents are restored before children
      const sortedEntries = [...state.data.entries].sort((a, b) => {
        // If a is a child of b, restore b first
        if (a.parentEntryId === b.id) return 1;
        // If b is a child of a, restore a first
        if (b.parentEntryId === a.id) return -1;
        // Otherwise maintain original order
        return 0;
      });
      
      for (const entryData of sortedEntries) {
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.id = entryData.id;
        entry.style.left = `${entryData.position.x}px`;
        entry.style.top = `${entryData.position.y}px`;
        const isImageEntryRestore = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
        if (isImageEntryRestore) {
          entry.classList.add('canvas-image');
          const img = document.createElement('img');
          const fullUrl = entryData.mediaCardData.url;
          img.src = getThumbUrl(fullUrl);
          img.dataset.fullSrc = fullUrl;
          img.alt = 'Canvas image';
          img.draggable = false;
          img.decoding = 'async';
          img.onerror = function() { if (this.src !== fullUrl) this.src = fullUrl; };
          entry.appendChild(img);
        } else {
          const { processedText, urls } = processTextWithLinks(entryData.text);
          if (entryData.textHtml && entryData.textHtml.includes('deadline-table')) {
            entry.innerHTML = entryData.textHtml;
            const dt = entry.querySelector('.deadline-table');
            if (dt) setupDeadlineTableHandlers(dt);
          } else if (entryData.textHtml && entryData.textHtml.includes('gcal-card')) {
            entry.innerHTML = entryData.textHtml;
            const card = entry.querySelector('.gcal-card');
            if (card) setupCalendarCardHandlers(card);
          } else if (processedText) {
            entry.innerHTML = meltify(processedText);
          } else {
            entry.innerHTML = '';
          }
          applyEntryFontSize(entry, entryData.textHtml);
          if (entryData.linkCardsData && entryData.linkCardsData.length > 0) {
            entryData.linkCardsData.forEach((cardData) => {
              if (cardData) {
                const card = createLinkCard(cardData);
                entry.appendChild(card);
                updateEntryWidthForLinkCard(entry, card);
              }
            });
          } else if (urls.length > 0) {
            urls.forEach(async (url) => {
              const cardData = await generateLinkCard(url);
              if (cardData) {
                const card = createLinkCard(cardData);
                entry.appendChild(card);
                updateEntryWidthForLinkCard(entry, card);
                if (!storedEntryData.linkCardsData) storedEntryData.linkCardsData = [];
                storedEntryData.linkCardsData.push(cardData);
              }
            });
          }
          if (entryData.mediaCardData) {
            const card = createMediaCard(entryData.mediaCardData);
            entry.appendChild(card);
            setTimeout(() => updateEntryDimensions(entry), 100);
          }
        }
        world.appendChild(entry);
        const storedEntryData = {
          ...entryData,
          element: entry,
          linkCardsData: entryData.linkCardsData || [],
          mediaCardData: entryData.mediaCardData || null
        };
        entries.set(entryData.id, storedEntryData);
        updateEntryDimensions(entry);
        await saveEntryToServer(storedEntryData);
      }
      refreshAllDeadlineDates();
      updateEntryVisibility();
      break;

    case 'move':
      // Restore previous positions
      for (const { entryId, oldPosition } of state.data.moves) {
        const entryData = entries.get(entryId);
        if (entryData && entryData.element) {
          entryData.element.style.left = `${oldPosition.x}px`;
          entryData.element.style.top = `${oldPosition.y}px`;
          entryData.position = oldPosition;
          await updateEntryOnServer(entryData);
        }
      }
      break;
      
    case 'create':
      // Delete created entry
      const entryData = entries.get(state.data.entryId);
      if (entryData) {
        await deleteEntryWithConfirmation(state.data.entryId, true); // Skip confirmation
      }
      break;
      
    case 'edit':
      // Restore old text and media/link cards
      const editEntryData = entries.get(state.data.entryId);
      if (editEntryData && editEntryData.element) {
        // Save current state for redo (if needed in future)
        const currentText = editEntryData.text;
        const currentMediaCardData = editEntryData.mediaCardData;
        const currentLinkCardsData = editEntryData.linkCardsData;
        
        // Restore old text
        editEntryData.text = state.data.oldText;
        editEntryData.mediaCardData = state.data.oldMediaCardData;
        editEntryData.linkCardsData = state.data.oldLinkCardsData;
        
        // Remove existing cards
        const existingCards = editEntryData.element.querySelectorAll('.link-card, .link-card-placeholder, .media-card');
        existingCards.forEach(card => card.remove());
        
        // Process and restore text
        const { processedText, urls } = processTextWithLinks(state.data.oldText);
        if (state.data.oldMediaCardData && state.data.oldMediaCardData.researchCardType) {
          renderResearchCard(editEntryData.element, editEntryData);
        } else if (editEntryData.textHtml && editEntryData.textHtml.includes('deadline-table')) {
          editEntryData.element.innerHTML = editEntryData.textHtml;
        } else if (editEntryData.textHtml && editEntryData.textHtml.includes('gcal-card')) {
          editEntryData.element.innerHTML = editEntryData.textHtml;
          const card = editEntryData.element.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        } else if (processedText) {
          editEntryData.element.innerHTML = meltify(processedText);
        } else {
          editEntryData.element.innerHTML = '';
        }
        
        // Restore link cards if they existed
        if (state.data.oldLinkCardsData && state.data.oldLinkCardsData.length > 0) {
          state.data.oldLinkCardsData.forEach((cardData) => {
            if (cardData) {
              const card = createLinkCard(cardData);
              editEntryData.element.appendChild(card);
              updateEntryWidthForLinkCard(editEntryData.element, card);
            }
          });
        } else if (urls.length > 0) {
          // Generate link cards from URLs if we don't have cached data
          urls.forEach(async (url) => {
            const cardData = await generateLinkCard(url);
            if (cardData) {
              const card = createLinkCard(cardData);
              editEntryData.element.appendChild(card);
              updateEntryWidthForLinkCard(editEntryData.element, card);
              if (!editEntryData.linkCardsData) editEntryData.linkCardsData = [];
              editEntryData.linkCardsData.push(cardData);
            }
          });
        }
        
        // Restore media card if it existed
        if (state.data.oldMediaCardData) {
          const card = createMediaCard(state.data.oldMediaCardData);
          editEntryData.element.appendChild(card);
          setTimeout(() => {
            updateEntryDimensions(editEntryData.element);
          }, 100);
        }
        
        // Update entry dimensions
        updateEntryDimensions(editEntryData.element);
        
        // Save to server
        await updateEntryOnServer(editEntryData);
      }
      break;
  }
}

// Multi-entry operations
async function deleteSelectedEntries() {
  if (selectedEntries.size === 0) return;
  
  // Check if any selected entries have children
  let hasChildren = false;
  let totalChildCount = 0;
  for (const entryId of selectedEntries) {
    const childCount = countChildEntries(entryId);
    if (childCount > 0) {
      hasChildren = true;
      totalChildCount += childCount;
    }
  }
  
  // If any entry has children, show confirmation
  if (hasChildren) {
    const confirmed = await showDeleteConfirmation(null, totalChildCount);
    if (!confirmed) {
      return; // User cancelled
    }
  }
  
  // Collect all entries to delete (including children)
  const allEntriesToDelete = [];
  
  // Helper to recursively collect all descendants
  function collectAllDescendants(entryId) {
    const entryData = entries.get(entryId);
    if (!entryData) return;
    
    allEntriesToDelete.push({
        id: entryData.id,
        text: entryData.text,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId,
        mediaCardData: entryData.mediaCardData,
        linkCardsData: entryData.linkCardsData
      });
    
    // Collect children recursively
    const children = Array.from(entries.values()).filter(e => e.parentEntryId === entryId);
    for (const child of children) {
      collectAllDescendants(child.id);
    }
  }
  
  // Collect all selected entries and their descendants
  for (const entryId of selectedEntries) {
    collectAllDescendants(entryId);
  }
  
  // Save undo state with all entries (including children)
  saveUndoState('delete', { entries: allEntriesToDelete });
  
  // Snapshot to array first — Set iteration is affected by mutations during async loop
  const entriesToDelete = [...selectedEntries];
  // Delete entries (skip confirmation since we already confirmed, skip undo since we saved it above)
  for (const entryId of entriesToDelete) {
    await deleteEntryWithConfirmation(entryId, true, true); // Skip confirmation and undo
  }
  
  clearSelection();
}

// Handle typing without clicking - start typing at hover position if editor is in idle mode
window.addEventListener('keydown', (e) => {
  // Only handle if editor is in idle mode (showing cursor but not actively editing) and we're in edit mode
  // Also check that the event target is not the editor (to avoid double-handling)
  if (editor.classList.contains('idle-cursor') && !isReadOnly && !isNavigating && !navigationJustCompleted && e.target !== editor) {
    // Check if this is a printable character (not a modifier key)
    // Allow letters, numbers, punctuation, space, etc.
    // Exclude special keys like Escape, Enter, Arrow keys, etc.
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    
    // Also allow some special keys that should start typing
    const isSpecialStartKey = e.key === 'Backspace' || e.key === 'Delete';
    
    if (isPrintable || isSpecialStartKey) {
      // Determine position: use last click position if available and recent, otherwise use hover position
      let targetPos;
      if (lastClickPos && hasClickedRecently) {
        // User clicked somewhere - type at click position
        targetPos = lastClickPos;
      } else {
        // User hasn't clicked - type at hover position
        const w = screenToWorld(currentMousePos.x, currentMousePos.y);
        targetPos = { x: w.x, y: w.y };
      }
      
      // Place editor at determined position (this will remove idle-cursor and focus)
      placeEditorAtWorld(targetPos.x, targetPos.y);
      
      // If it's a printable character, insert it into the editor
      if (isPrintable) {
        // Editor is already focused by placeEditorAtWorld, just insert the character
        // Insert the character at cursor position
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(e.key));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          // Fallback: append to end
          editor.textContent += e.key;
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        // Trigger input event to update dimensions
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
}, true); // Use capture phase to catch event early

// Keyboard shortcuts
window.addEventListener('keydown', async (e) => {
  // Command+Z / Ctrl+Z for undo — when editor focused, let browser handle (typing, formatting)
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    if (document.activeElement === editor) return;
    e.preventDefault();
    await performUndo();
    return;
  }
  // Command+Shift+Z / Ctrl+Y for redo — when editor focused, let browser handle
  if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') || ((e.metaKey || e.ctrlKey) && e.key === 'y')) {
    if (document.activeElement === editor) return;
  }
  
  // Delete key for selected entries
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedEntries.size > 0 && document.activeElement !== editor) {
      e.preventDefault();
      await deleteSelectedEntries();
      return;
    }
  }
  
  // Command+Shift+1 (Mac) or Ctrl+Shift+1 (Windows/Linux)
  // Check for both '1'/'Digit1' in key and 'Digit1' in code to handle different keyboard layouts
  const isOneKey = e.key === '1' || e.key === 'Digit1' || e.code === 'Digit1';
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && isOneKey) {
    e.preventDefault();
    e.stopPropagation();
    navigateToRoot();
  }
}, true); // Use capture phase to catch event before other handlers

// ——— Template system ———
const templateMenuButton = document.getElementById('template-menu-button');
const templateMenuDropdown = document.getElementById('template-menu-dropdown');

function closeTemplateMenu() {
  if (templateMenuButton) templateMenuButton.classList.remove('active');
  if (templateMenuDropdown) templateMenuDropdown.classList.add('hidden');
}

function openTemplateMenu() {
  if (templateMenuButton) templateMenuButton.classList.add('active');
  if (templateMenuDropdown) templateMenuDropdown.classList.remove('hidden');
}

if (templateMenuButton && templateMenuDropdown) {
  templateMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !templateMenuDropdown.classList.contains('hidden');
    if (isOpen) {
      closeTemplateMenu();
    } else {
      openTemplateMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!templateMenuDropdown.contains(e.target) && e.target !== templateMenuButton) {
      closeTemplateMenu();
    }
  });

  templateMenuDropdown.querySelectorAll('.template-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const templateType = btn.dataset.template;
      insertTemplate(templateType);
      closeTemplateMenu();
    });
  });
}

async function insertTemplate(templateType) {
  if (templateType === 'deadlines') {
    await insertDeadlinesTemplate();
  } else if (templateType === 'gcal-card') {
    await insertCalendarTemplate();
  } else if (templateType === 'google') {
    handleGoogleConnection();
  }
}

function getDeadlineRowHTML() {
  return `<div class="deadline-col-check"><button class="deadline-dot" type="button"></button></div>
    <div class="deadline-col-name" contenteditable="true"></div>
    <div class="deadline-col-deadline" contenteditable="true"></div>
    <div class="deadline-col-class" contenteditable="true"></div>
    <div class="deadline-col-status"><button class="status-badge" data-status="not-started" type="button">Not started</button><div class="status-dropdown"><div class="status-option" data-status="not-started">Not started</div><div class="status-option" data-status="overdue">Overdue</div><div class="status-option" data-status="done">Done</div></div></div>
    <div class="deadline-col-notes" contenteditable="true"></div>`;
}

function addDeadlineRow(table) {
  const ghostRow = table.querySelector('.deadline-ghost-row');
  const newRow = document.createElement('div');
  newRow.className = 'deadline-row';
  newRow.innerHTML = getDeadlineRowHTML();
  if (ghostRow) {
    table.insertBefore(newRow, ghostRow);
  } else {
    table.appendChild(newRow);
  }
  const firstCell = newRow.querySelector('.deadline-col-name');
  if (firstCell) {
    setTimeout(() => firstCell.focus(), 0);
  }
}

function getPacificToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}

function parseRawDeadlineDate(raw) {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();
  const year = getPacificToday().getFullYear();
  const months = {
    jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
    may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,
    oct:9,october:9,nov:10,november:10,dec:11,december:11
  };
  const cleaned = s.replace(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*,?\s*/i, '');
  const monthDay = cleaned.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*,?\s*(\d{4}))?/i);
  if (monthDay && months[monthDay[1].toLowerCase()] !== undefined) {
    const y = monthDay[3] ? parseInt(monthDay[3]) : year;
    return new Date(y, months[monthDay[1].toLowerCase()], parseInt(monthDay[2]));
  }
  const slash = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + parseInt(slash[3]) : parseInt(slash[3])) : year;
    return new Date(y, parseInt(slash[1]) - 1, parseInt(slash[2]));
  }
  return null;
}

function formatDeadlineDisplay(rawDate) {
  const d = parseRawDeadlineDate(rawDate);
  if (!d) return rawDate || '';
  const today = getPacificToday();
  today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diffDays = Math.round((target - today) / 86400000);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  if (diffDays >= 0 && diffDays <= 13) {
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays <= 6) return dayNames[target.getDay()];
    return 'Next ' + dayNames[target.getDay()];
  }
  return `${dayNames[target.getDay()]}, ${monthNames[target.getMonth()]} ${target.getDate()}, ${target.getFullYear()}`;
}

function refreshDeadlineDates(table) {
  table.querySelectorAll('.deadline-col-deadline').forEach(cell => {
    let raw = cell.dataset.rawDate;
    // If no raw date stored yet, try to parse the text content and set it
    if (!raw) {
      const text = cell.textContent.trim();
      if (!text) return;
      const parsed = parseRawDeadlineDate(text);
      if (parsed) {
        raw = `${parsed.getMonth()+1}/${parsed.getDate()}/${parsed.getFullYear()}`;
        cell.dataset.rawDate = raw;
      } else {
        return; // unparseable, leave as-is
      }
    }
    cell.textContent = formatDeadlineDisplay(raw);
  });
}

function refreshAllDeadlineDates() {
  document.querySelectorAll('.deadline-table').forEach(t => refreshDeadlineDates(t));
}

function parseDeadlineDateForSort(dateStr, cell) {
  // Prefer raw date stored in data attribute
  const raw = cell ? cell.dataset.rawDate : null;
  const src = raw || dateStr;
  if (!src || !src.trim()) return Infinity;
  const d = parseRawDeadlineDate(src);
  return d ? d.getTime() : Infinity;
}

function sortDeadlineRows(table) {
  // Only sort active rows (not in completed section)
  const completedSection = table.querySelector('.deadline-completed-section');
  const rows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const ghostRow = table.querySelector('.deadline-ghost-row');
  rows.sort((a, b) => {
    const aCel = a.querySelector('.deadline-col-deadline');
    const bCel = b.querySelector('.deadline-col-deadline');
    const aT = parseDeadlineDateForSort(aCel?.textContent, aCel);
    const bT = parseDeadlineDateForSort(bCel?.textContent, bCel);
    return aT - bT;
  });
  rows.forEach(row => {
    if (ghostRow) table.insertBefore(row, ghostRow);
    else table.appendChild(row);
  });
}

function isDeadlineRowEmpty(row) {
  const cells = row.querySelectorAll('[contenteditable="true"]');
  for (const cell of cells) {
    if (cell.textContent.trim() !== '') return false;
  }
  const badge = row.querySelector('.status-badge');
  if (badge && badge.dataset.status !== 'not-started') return false;
  const dot = row.querySelector('.deadline-dot');
  if (dot && dot.classList.contains('checked')) return false;
  return true;
}

function ensureCompletedSection(table) {
  if (!table.querySelector('.deadline-completed-section')) {
    const divider = document.createElement('div');
    divider.className = 'deadline-completed-divider';
    divider.textContent = 'Completed';
    divider.addEventListener('click', () => {
      divider.classList.toggle('expanded');
      const sec = table.querySelector('.deadline-completed-section');
      if (sec) sec.classList.toggle('expanded');
    });
    const section = document.createElement('div');
    section.className = 'deadline-completed-section';
    table.appendChild(divider);
    table.appendChild(section);
  }
  return table.querySelector('.deadline-completed-section');
}

function hideOrShowCompletedSection(table) {
  const section = table.querySelector('.deadline-completed-section');
  const divider = table.querySelector('.deadline-completed-divider');
  if (!section || !divider) return;
  const empty = section.children.length === 0;
  section.style.display = empty ? 'none' : '';
  divider.style.display = empty ? 'none' : '';
}

function findSortedInsertPosition(table, row) {
  const completedSection = table.querySelector('.deadline-completed-section');
  const ghostRow = table.querySelector('.deadline-ghost-row');
  const completedDivider = table.querySelector('.deadline-completed-divider');
  const activeRows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const newCell = row.querySelector('.deadline-col-deadline');
  const newTime = parseDeadlineDateForSort(newCell?.textContent, newCell);
  for (const existing of activeRows) {
    const cell = existing.querySelector('.deadline-col-deadline');
    const t = parseDeadlineDateForSort(cell?.textContent, cell);
    if (newTime < t) return existing;
  }
  return ghostRow || completedDivider || null;
}

function completeDeadlineRow(row, table) {
  row.classList.add('completing');
  const dot = row.querySelector('.deadline-dot');
  if (dot) dot.classList.add('checked');
  setTimeout(() => {
    const section = ensureCompletedSection(table);
    row.classList.remove('completing');
    section.appendChild(row);
    hideOrShowCompletedSection(table);
    saveDeadlineTableState(table);
  }, 350);
}

function uncompleteDeadlineRow(row, table) {
  const dot = row.querySelector('.deadline-dot');
  if (dot) dot.classList.remove('checked');
  row.classList.add('uncompleting');
  const insertBefore = findSortedInsertPosition(table, row);
  if (insertBefore) table.insertBefore(row, insertBefore);
  else {
    const ghost = table.querySelector('.deadline-ghost-row');
    if (ghost) table.insertBefore(row, ghost);
    else table.appendChild(row);
  }
  sortDeadlineRows(table);
  setTimeout(() => row.classList.remove('uncompleting'), 300);
  hideOrShowCompletedSection(table);
  saveDeadlineTableState(table);
}

async function extractFileIntoTable(table, file) {
  // Show or update loading overlay
  let overlay = table.querySelector('.deadline-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'deadline-loading-overlay';
    overlay.innerHTML = '<div class="deadline-loading-spinner"></div><div class="deadline-loading-text">Extracting deadlines...</div>';
    table.appendChild(overlay);
  }
  // Track active extraction count so overlay stays visible until all finish
  table._extractionCount = (table._extractionCount || 0) + 1;
  overlay.querySelector('.deadline-loading-text').textContent =
    table._extractionCount > 1 ? `Extracting (${table._extractionCount} files)...` : 'Extracting deadlines...';
  overlay.classList.add('active');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/extract-deadlines', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to extract deadlines');
    }

    const data = await res.json();
    // Filter to today onwards
    if (data.deadlines) {
      const todayMs = getPacificToday(); todayMs.setHours(0,0,0,0);
      data.deadlines = data.deadlines.filter(d => {
        const parsed = parseRawDeadlineDate(d.deadline);
        return !parsed || parsed.getTime() >= todayMs.getTime();
      });
    }

    if (!data.deadlines || data.deadlines.length === 0) {
      table._extractionCount--;
      if (table._extractionCount <= 0) {
        overlay.querySelector('.deadline-loading-text').textContent = 'No deadlines found';
        setTimeout(() => overlay.classList.remove('active'), 1500);
      }
      return;
    }

    // Remove empty rows before adding first batch
    Array.from(table.querySelectorAll('.deadline-row')).forEach(row => {
      if (isDeadlineRowEmpty(row)) row.remove();
    });

    // Add rows from extracted deadlines
    const ghostRow = table.querySelector('.deadline-ghost-row');
    data.deadlines.forEach(d => {
      const row = document.createElement('div');
      row.className = 'deadline-row';
      row.innerHTML = getDeadlineRowHTML();
      const nameCell = row.querySelector('.deadline-col-name');
      const deadlineCell = row.querySelector('.deadline-col-deadline');
      const classCell = row.querySelector('.deadline-col-class');
      const notesCell = row.querySelector('.deadline-col-notes');
      if (nameCell) nameCell.textContent = d.assignment || '';
      if (deadlineCell) {
        deadlineCell.dataset.rawDate = d.deadline || '';
        deadlineCell.textContent = formatDeadlineDisplay(d.deadline);
      }
      if (classCell) classCell.textContent = d.class || '';
      if (notesCell) notesCell.textContent = d.notes || '';
      if (ghostRow) table.insertBefore(row, ghostRow);
      else table.appendChild(row);
    });

    sortDeadlineRows(table);
    table._extractionCount--;
    if (table._extractionCount <= 0) {
      overlay.classList.remove('active');
    }
  } catch (err) {
    console.error('Deadline extraction error:', err);
    table._extractionCount--;
    if (table._extractionCount <= 0) {
      overlay.querySelector('.deadline-loading-text').textContent = err.message || 'Extraction failed';
      setTimeout(() => overlay.classList.remove('active'), 2000);
    }
  }
}

function saveDeadlineTableState(table) {
  const entry = table.closest('.entry');
  if (!entry) return;
  const entryData = entries.get(entry.id);
  if (entryData) {
    entryData.text = entry.innerText;
    entryData.textHtml = entry.innerHTML;
    updateEntryOnServer(entryData);
  }
}

function setupDeadlineTableHandlers(table) {
  table.addEventListener('mousedown', (e) => {
    table.classList.add('table-active');
    const inEditor = table.closest('#editor');
    if (inEditor) {
      const cell = e.target.closest('[contenteditable="true"]');
      if (!cell && !e.target.closest('button')) {
        e.preventDefault();
        focusNearestDeadlineCell(table, e.clientX, e.clientY);
      }
    }
  });

  // Deactivate when clicking outside + close any open dropdowns
  const deactivateHandler = (e) => {
    if (!table.contains(e.target)) {
      table.classList.remove('table-active');
      table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
    }
  };
  document.addEventListener('mousedown', deactivateHandler);

  // Migrate old checkboxes to dots
  table.querySelectorAll('.deadline-col-check input[type="checkbox"]').forEach(cb => {
    const dot = document.createElement('button');
    dot.className = 'deadline-dot';
    dot.type = 'button';
    if (cb.checked) dot.classList.add('checked');
    cb.replaceWith(dot);
  });

  // Wire up existing completed divider toggle if present in saved HTML
  const existingDivider = table.querySelector('.deadline-completed-divider');
  if (existingDivider) {
    existingDivider.addEventListener('click', () => {
      existingDivider.classList.toggle('expanded');
      const sec = table.querySelector('.deadline-completed-section');
      if (sec) sec.classList.toggle('expanded');
    });
  }
  hideOrShowCompletedSection(table);

  // Event delegation for clicks within the table
  table.addEventListener('click', (e) => {
    // Dot click - toggle completion
    const dot = e.target.closest('.deadline-dot');
    if (dot) {
      e.preventDefault();
      e.stopPropagation();
      const row = dot.closest('.deadline-row');
      if (!row) return;
      if (dot.classList.contains('checked')) {
        uncompleteDeadlineRow(row, table);
      } else {
        completeDeadlineRow(row, table);
      }
      return;
    }

    // Status badge click - toggle dropdown
    const badge = e.target.closest('.status-badge');
    if (badge) {
      e.preventDefault();
      e.stopPropagation();
      table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
      const dropdown = badge.closest('.deadline-col-status').querySelector('.status-dropdown');
      if (dropdown) dropdown.classList.toggle('open');
      return;
    }

    // Status option click - update badge
    const option = e.target.closest('.status-option');
    if (option) {
      e.preventDefault();
      e.stopPropagation();
      const status = option.dataset.status;
      const text = option.textContent;
      const statusCell = option.closest('.deadline-col-status');
      const statusBadge = statusCell.querySelector('.status-badge');
      if (statusBadge) {
        statusBadge.dataset.status = status;
        statusBadge.textContent = text;
      }
      option.closest('.status-dropdown').classList.remove('open');
      return;
    }

    // Ghost row click - add new row
    const ghostRow = e.target.closest('.deadline-ghost-row');
    if (ghostRow) {
      e.preventDefault();
      e.stopPropagation();
      addDeadlineRow(table);
      return;
    }

    // Close any open dropdowns when clicking elsewhere
    table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  table.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('[contenteditable="true"]');
    if (!cell) return;
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(cell);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  table.addEventListener('focusout', (e) => {
    const cell = e.target.closest('.deadline-col-deadline');
    if (cell) {
      const text = cell.textContent.trim();
      if (!text) { delete cell.dataset.rawDate; }
      else if (!(cell.dataset.rawDate && formatDeadlineDisplay(cell.dataset.rawDate) === text)) {
        const parsed = parseRawDeadlineDate(text);
        if (parsed) {
          const raw = `${parsed.getMonth()+1}/${parsed.getDate()}/${parsed.getFullYear()}`;
          cell.dataset.rawDate = raw;
          cell.textContent = formatDeadlineDisplay(raw);
        }
      }
    }
    setTimeout(() => {
      refreshDeadlineDates(table);
      sortDeadlineRows(table);
    }, 0);
  });

  // Drag and drop onto deadline table in editor to populate rows.
  // The viewport dragover already prevents default for all files, so
  // the browser won't open the file. These handlers add visual feedback
  // and handle the extraction when dropped directly on the table.
  table.addEventListener('dragover', (e) => {
    if (!table.closest('#editor')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    table.classList.add('deadline-drop-active');
  });

  table.addEventListener('dragleave', (e) => {
    if (!table.closest('#editor')) return;
    // Only remove if we're actually leaving the table, not entering a child
    if (!table.contains(e.relatedTarget)) {
      table.classList.remove('deadline-drop-active');
    }
  });

  table.addEventListener('drop', async (e) => {
    if (!table.closest('#editor')) return;
    e.preventDefault();
    e.stopPropagation();
    table.classList.remove('deadline-drop-active');

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Process each file concurrently — results append to table as they arrive
    const promises = files.map(file => extractFileIntoTable(table, file));
    await Promise.allSettled(promises);
  });
}

async function insertDeadlinesTemplate() {
  const tableHTML = `
<div class="deadline-table" contenteditable="false">
  <div class="deadline-header">
    <div></div>
    <div>assignment</div>
    <div>deadline</div>
    <div>class</div>
    <div>status</div>
    <div>notes</div>
  </div>
  <div class="deadline-row">
    ${getDeadlineRowHTML()}
  </div>
  <div class="deadline-ghost-row">
    <div>+</div>
    <div>Assignment...</div>
    <div>Date...</div>
    <div>Class...</div>
    <div>Status</div>
    <div></div>
  </div>
</div>`;

  editor.innerHTML = tableHTML;
  editor.classList.add('has-content');

  // Set up event handlers
  const table = editor.querySelector('.deadline-table');
  if (table) setupDeadlineTableHandlers(table);

  editor.removeEventListener('keydown', handleDeadlineTableKeydown);
  editor.addEventListener('keydown', handleDeadlineTableKeydown);

  // Focus first editable cell
  const firstCell = editor.querySelector('.deadline-col-name');
  if (firstCell) {
    setTimeout(() => firstCell.focus(), 0);
  }
}

function formatMonthKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function parseGcalMonth(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return new Date();
  return new Date(monthStr + '-01T12:00:00');
}

async function fetchGcalCalendars() {
  try {
    const res = await fetch('/api/google/calendars', { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { gcalConnected = false; updateGoogleConnectButton(); }
      return [];
    }
    const data = await res.json();
    return data.calendars || [];
  } catch (e) {
    console.error('Fetch calendars error:', e);
    return [];
  }
}

async function fetchGcalEventsForMonth(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month + 2, 0).toISOString();
  try {
    const res = await fetch(`/api/google/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { gcalConnected = false; updateGoogleConnectButton(); }
      return [];
    }
    const data = await res.json();
    return data.events || [];
  } catch (e) {
    console.error('Fetch events error:', e);
    return [];
  }
}

function getEventsForDateFromList(dateStr, eventsList) {
  return eventsList.filter(evt => {
    const start = evt.start;
    if (!start) return false;
    const evtDate = start.length === 10 ? start : start.substring(0, 10);
    if (evtDate === dateStr) return true;
    if (evt.allDay && evt.end) {
      const endDate = evt.end.length === 10 ? evt.end : evt.end.substring(0, 10);
      return dateStr >= evtDate && dateStr < endDate;
    }
    return false;
  });
}

function renderCalendarDayCell(day, dateStr, otherMonth, isToday, state) {
  const events = getEventsForDateFromList(dateStr, state.events || []);
  const maxChips = 3;
  const shown = events.slice(0, maxChips);
  const moreCount = events.length - maxChips;
  let chipsHtml = '';
  shown.forEach(evt => {
    const cal = (state.calendars || []).find(c => c.id === evt.calendarId);
    const color = cal?.backgroundColor || '#4285f4';
    const title = (evt.summary || 'Event').substring(0, 30);
    chipsHtml += `<div class="gcal-card-chip" style="border-left-color:${color}"><span class="gcal-card-chip-title">${escapeHtml(title)}</span></div>`;
  });
  if (moreCount > 0) {
    chipsHtml += `<div class="gcal-card-more">+${moreCount} more</div>`;
  }
  const classes = ['gcal-card-day'];
  if (otherMonth) classes.push('other-month');
  if (isToday) classes.push('today');
  return `<div class="${classes.join(' ')}" data-date="${escapeHtml(dateStr)}"><div class="gcal-card-day-num">${day}</div>${chipsHtml}</div>`;
}

function renderCalendarCard(card) {
  const state = card._gcalState || {};
  const viewDate = state.viewDate ? new Date(state.viewDate) : parseGcalMonth(card.dataset.gcalMonth || '');
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();

  const monthLabel = card.querySelector('.gcal-card-month-label');
  if (monthLabel) monthLabel.textContent = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const dayHeaders = card.querySelector('.gcal-card-day-headers');
  if (dayHeaders) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.innerHTML = days.map(d => `<span>${d}</span>`).join('');
  }

  const grid = card.querySelector('.gcal-card-grid');
  if (!grid) return;

  let html = '';
  const prevLastDay = new Date(year, month, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevLastDay - i;
    const dateStr = formatDateKey(new Date(year, month - 1, d));
    html += renderCalendarDayCell(d, dateStr, true, false, state);
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = formatDateKey(new Date(year, month, d));
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    html += renderCalendarDayCell(d, dateStr, false, isToday, state);
  }
  const totalCells = startDow + lastDay.getDate();
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    const dateStr = formatDateKey(new Date(year, month + 1, d));
    html += renderCalendarDayCell(d, dateStr, true, false, state);
  }
  grid.innerHTML = html;

  const loading = card.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');
}

function saveCalendarCardState(card) {
  const entry = card.closest('.entry');
  if (!entry) return;
  const entryData = entries.get(entry.id);
  if (!entryData) return;
  const clone = card.cloneNode(true);
  const grid = clone.querySelector('.gcal-card-grid');
  if (grid) grid.innerHTML = '';
  const loading = clone.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');
  entryData.text = entry.innerText;
  entryData.textHtml = clone.outerHTML;
  updateEntryOnServer(entryData);
}

function setupCalendarCardHandlers(card) {
  const monthStr = card.dataset.gcalMonth || formatMonthKey(new Date());
  card.dataset.gcalMonth = monthStr;
  const viewDate = parseGcalMonth(monthStr);
  card._gcalState = { viewDate: viewDate.getTime(), calendars: [], events: [] };

  const loading = card.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');

  renderCalendarCard(card);

  (async () => {
    const [calendars, events] = await Promise.all([
      fetchGcalCalendars(),
      fetchGcalEventsForMonth(viewDate)
    ]);
    if (!card._gcalState) return;
    card._gcalState.calendars = calendars;
    card._gcalState.events = events;
    renderCalendarCard(card);
    saveCalendarCardState(card);
  })();

  card.addEventListener('mousedown', (e) => {
    if (e.target.closest('.gcal-card-nav-btn, .gcal-card-today-btn')) e.stopPropagation();
  });

  const prevBtn = card.querySelector('.gcal-card-prev');
  const nextBtn = card.querySelector('.gcal-card-next');
  const todayBtn = card.querySelector('.gcal-card-today-btn');

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const state = card._gcalState || {};
      const d = new Date(state.viewDate || Date.now());
      d.setMonth(d.getMonth() - 1);
      card._gcalState.viewDate = d.getTime();
      card.dataset.gcalMonth = formatMonthKey(d);
      card._gcalState.events = [];
      renderCalendarCard(card);
      fetchGcalEventsForMonth(d).then(events => {
        if (!card._gcalState) return;
        card._gcalState.events = events;
        renderCalendarCard(card);
        saveCalendarCardState(card);
      });
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const state = card._gcalState || {};
      const d = new Date(state.viewDate || Date.now());
      d.setMonth(d.getMonth() + 1);
      card._gcalState.viewDate = d.getTime();
      card.dataset.gcalMonth = formatMonthKey(d);
      card._gcalState.events = [];
      renderCalendarCard(card);
      fetchGcalEventsForMonth(d).then(events => {
        if (!card._gcalState) return;
        card._gcalState.events = events;
        renderCalendarCard(card);
        saveCalendarCardState(card);
      });
    });
  }
  if (todayBtn) {
    todayBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = new Date();
      card._gcalState.viewDate = d.getTime();
      card.dataset.gcalMonth = formatMonthKey(d);
      card._gcalState.events = [];
      renderCalendarCard(card);
      fetchGcalEventsForMonth(d).then(events => {
        if (!card._gcalState) return;
        card._gcalState.events = events;
        renderCalendarCard(card);
        saveCalendarCardState(card);
      });
    });
  }
}

async function insertCalendarTemplate() {
  if (!gcalConnected) {
    handleGoogleConnection();
    return;
  }
  const now = new Date();
  const monthStr = formatMonthKey(now);
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const cardHTML = `
<div class="gcal-card" contenteditable="false" data-gcal-card="true" data-gcal-month="${escapeHtml(monthStr)}">
  <div class="gcal-card-header">
    <button type="button" class="gcal-card-nav-btn gcal-card-prev" aria-label="Previous month">‹</button>
    <button type="button" class="gcal-card-nav-btn gcal-card-next" aria-label="Next month">›</button>
    <span class="gcal-card-month-label">${escapeHtml(monthLabel)}</span>
    <button type="button" class="gcal-card-today-btn">Today</button>
  </div>
  <div class="gcal-card-day-headers">
    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
  </div>
  <div class="gcal-card-grid"></div>
  <div class="gcal-card-loading hidden" aria-hidden="true">Loading calendar…</div>
</div>`;
  editor.innerHTML = cardHTML;
  editor.classList.add('has-content');
  const card = editor.querySelector('.gcal-card');
  if (card) setupCalendarCardHandlers(card);
}

function focusNearestDeadlineCell(table, clientX, clientY) {
  const cells = Array.from(table.querySelectorAll('.deadline-col-name, .deadline-col-deadline, .deadline-col-class, .deadline-col-notes'));
  if (cells.length === 0) return;
  let nearest = cells[0];
  let minDist = Infinity;
  for (const cell of cells) {
    const r = cell.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (d < minDist) { minDist = d; nearest = cell; }
  }
  nearest.focus();
  const range = document.createRange();
  const sel = window.getSelection();
  if (document.caretRangeFromPoint) {
    const cr = document.caretRangeFromPoint(clientX, clientY);
    if (cr && nearest.contains(cr.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(cr);
      return;
    }
  }
  range.selectNodeContents(nearest);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getDeadlineEditableCells(row) {
  return Array.from(row.querySelectorAll('.deadline-col-name, .deadline-col-deadline, .deadline-col-class, .deadline-col-notes'));
}

function getDeadlineActiveRows(table) {
  const completedSection = table.querySelector('.deadline-completed-section');
  return Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
}

function handleDeadlineTableKeydown(e) {
  const target = e.target;
  const deadlineTable = target.closest('.deadline-table');
  if (!deadlineTable) return;

  const cell = target.closest('[contenteditable="true"]');
  const currentRow = cell ? cell.closest('.deadline-row') : null;
  const activeRows = getDeadlineActiveRows(deadlineTable);

  // Tab / Shift+Tab: traverse cells like a spreadsheet
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!cell || !currentRow) return;
    const cells = getDeadlineEditableCells(currentRow);
    const cellIndex = cells.indexOf(cell);
    const rowIndex = activeRows.indexOf(currentRow);
    if (e.shiftKey) {
      if (cellIndex > 0) {
        cells[cellIndex - 1].focus();
      } else if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        if (prevCells.length > 0) prevCells[prevCells.length - 1].focus();
      }
    } else {
      if (cellIndex < cells.length - 1) {
        cells[cellIndex + 1].focus();
      } else if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        if (nextCells.length > 0) nextCells[0].focus();
      }
    }
    return;
  }

  // Arrow keys: spreadsheet-style navigation
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!cell || !currentRow) return;
    const cells = getDeadlineEditableCells(currentRow);
    const cellIndex = cells.indexOf(cell);
    const rowIndex = activeRows.indexOf(currentRow);
    const sel = window.getSelection();

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        if (prevCells[cellIndex]) prevCells[cellIndex].focus();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        if (nextCells[cellIndex]) nextCells[cellIndex].focus();
      }
      return;
    }

    // ArrowLeft / ArrowRight: move within cell text, wrap to adjacent rows at edges
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const atStart = range.collapsed && cell.contains(range.startContainer) &&
      (range.startOffset === 0 || (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0));
    const atEnd = range.collapsed && cell.contains(range.endContainer) &&
      (range.endOffset === (range.endContainer.textContent || '').length);

    if (e.key === 'ArrowLeft' && atStart) {
      e.preventDefault();
      let target;
      if (cellIndex > 0) {
        target = cells[cellIndex - 1];
      } else if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        target = prevCells.length > 0 ? prevCells[prevCells.length - 1] : null;
      }
      if (target) {
        target.focus();
        const r = document.createRange();
        r.selectNodeContents(target);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    if (e.key === 'ArrowRight' && atEnd) {
      e.preventDefault();
      let target;
      if (cellIndex < cells.length - 1) {
        target = cells[cellIndex + 1];
      } else if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        target = nextCells.length > 0 ? nextCells[0] : null;
      }
      if (target) {
        target.focus();
        const r = document.createRange();
        r.setStart(target, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    return;
  }

  // Cmd/Ctrl+A: select all text within the current cell only
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    if (cell) {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }

  // Backspace/Delete: empty cell or empty row
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (cell && cell.textContent === '') {
      e.preventDefault();
      const row = cell.closest('.deadline-row');
      if (row && isDeadlineRowEmpty(row)) {
        const table = row.closest('.deadline-table');
        const allRows = Array.from(table.querySelectorAll('.deadline-row'));
        if (allRows.length <= 1) {
          editor.innerHTML = '';
          setTimeout(() => commitEditor(), 0);
        } else {
          const rowIndex = activeRows.indexOf(row);
          row.remove();
          const remaining = getDeadlineActiveRows(table);
          const focusRow = remaining[Math.min(rowIndex, remaining.length - 1)] || remaining[0];
          if (focusRow) {
            const focusCell = getDeadlineEditableCells(focusRow)[0];
            if (focusCell) focusCell.focus();
          }
        }
      }
      return;
    }
  }

  if (e.key !== 'Enter') return;

  e.preventDefault();

  // Cmd/Ctrl+Enter: always commit
  if (e.metaKey || e.ctrlKey) {
    setTimeout(() => commitEditor(), 0);
    return;
  }

  const enterRow = target.closest('.deadline-row');
  if (!enterRow) return;

  const table = enterRow.closest('.deadline-table');
  const completedSection = table.querySelector('.deadline-completed-section');
  const allRows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const currentIndex = allRows.indexOf(enterRow);
  const rowsBelow = allRows.slice(currentIndex + 1);

  // Check if any row below has an empty editable cell
  for (const row of rowsBelow) {
    const emptyCell = row.querySelector('.deadline-col-name:empty, .deadline-col-deadline:empty, .deadline-col-class:empty');
    if (emptyCell) {
      emptyCell.focus();
      return;
    }
  }

  // No filled row below or at the end — add a new row
  addDeadlineRow(table);
}

/* ── Background picker ─────────────────────────────────────────── */
(function initBgPicker() {
  const bgBtn = document.getElementById('bg-picker-button');
  const bgDropdown = document.getElementById('bg-picker-dropdown');
  const bgUploadBtn = document.getElementById('bg-upload-btn');
  const bgUploadInput = document.getElementById('bg-upload-input');
  if (!bgBtn || !bgDropdown) return;

  // Session state (loaded from API)
  var _bgUrl = null;
  var _bgUploads = [];
  var _saveTimer = null;

  // --- Image preload verification ---
  function preloadImage(url) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { resolve(url); };
      img.onerror = function() { reject(new Error('Image failed to load')); };
      img.src = url;
    });
  }

  // --- API persistence ---
  function saveBgToAPI() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      fetch('/api/user/background', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bgUrl: _bgUrl, bgUploads: _bgUploads })
      }).catch(function(err) { console.warn('Failed to save background:', err); });
    }, 200);
  }

  // Build a thumbnail option element for an uploaded image
  function createUploadedOption(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    var btn = document.createElement('button');
    btn.className = 'bg-picker-option bg-picker-preset bg-picker-uploaded';
    btn.setAttribute('data-bg', url);
    btn.title = 'Uploaded image (right-click to remove)';
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'uploaded bg';
    img.onerror = function() {
      _bgUploads = _bgUploads.filter(function(u) { return u !== url; });
      if (_bgUrl === url) {
        _bgUrl = null;
        removeBg();
        markActive(null);
      }
      btn.remove();
      saveBgToAPI();
    };
    btn.appendChild(img);
    btn.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      _bgUploads = _bgUploads.filter(function(u) { return u !== url; });
      btn.remove();
      if (_bgUrl === url) {
        _bgUrl = null;
        removeBg();
        markActive(null);
      }
      saveBgToAPI();
    });
    return btn;
  }

  // Render saved uploads into the dropdown (before the upload button)
  function renderSavedUploads() {
    bgDropdown.querySelectorAll('.bg-picker-uploaded').forEach(function(el) { el.remove(); });
    _bgUploads.forEach(function(url) {
      var opt = createUploadedOption(url);
      if (opt) bgDropdown.insertBefore(opt, bgUploadBtn);
    });
  }

  // --- Core functions ---
  function loadBg() {
    fetch('/api/user/background', { credentials: 'include' })
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) {
        if (!data) return;
        _bgUrl = data.bgUrl || null;
        _bgUploads = Array.isArray(data.bgUploads) ? data.bgUploads.filter(function(u) { return typeof u === 'string' && u.startsWith('http'); }) : [];
        renderSavedUploads();
        if (_bgUrl) {
          preloadImage(_bgUrl).then(function() {
            applyBg(_bgUrl);
            markActive(_bgUrl);
          }).catch(function() {
            console.warn('Background image failed to load:', _bgUrl);
            _bgUrl = null;
            saveBgToAPI();
          });
        }
      })
      .catch(function(err) { console.warn('Failed to load background settings:', err); });
  }

  function applyBg(url) {
    document.body.style.setProperty('--bg-url', "url('" + url + "')");
    document.body.classList.add('has-bg-image');
  }

  function removeBg() {
    document.body.classList.remove('has-bg-image');
    document.body.style.removeProperty('--bg-url');
  }

  function markActive(url) {
    bgDropdown.querySelectorAll('.bg-picker-option').forEach(function(opt) {
      var bg = opt.getAttribute('data-bg');
      opt.classList.toggle('active', bg === (url || 'none'));
    });
  }

  // Toggle dropdown
  bgBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    bgDropdown.classList.toggle('hidden');
  });

  // Option clicks (presets, none, uploaded, and upload button)
  bgDropdown.addEventListener('click', function(e) {
    var opt = e.target.closest('.bg-picker-option');
    if (!opt) return;
    var bg = opt.getAttribute('data-bg');
    if (bg === 'none') {
      removeBg();
      _bgUrl = null;
      saveBgToAPI();
      markActive(null);
    } else if (opt.id === 'bg-upload-btn') {
      bgUploadInput.click();
      return; // don't close dropdown yet
    } else {
      preloadImage(bg).then(function() {
        applyBg(bg);
        _bgUrl = bg;
        saveBgToAPI();
        markActive(bg);
      }).catch(function() {
        alert('Background image failed to load.');
      });
    }
    bgDropdown.classList.add('hidden');
  });

  function showBgError(msg) {
    if (typeof msg === 'string' && msg) alert('Background upload: ' + msg);
    else alert('Background upload failed. Try another image or check you\u2019re signed in.');
  }

  // Upload handler
  if (bgUploadInput) {
    bgUploadInput.addEventListener('change', async function() {
      var file = bgUploadInput.files[0];
      if (!file) return;
      bgDropdown.classList.add('hidden');

      var finalUrl = null;
      var serverError = null;

      // Try server upload
      try {
        var form = new FormData();
        form.append('file', file);
        var res = await fetch('/api/upload-background-image', { method: 'POST', credentials: 'include', body: form });
        if (res.ok) {
          var data = await res.json();
          if (data.url) finalUrl = data.url;
        } else {
          var body = await res.json().catch(function() { return {}; });
          serverError = body.error || res.statusText || 'Upload failed';
        }
      } catch (err) {
        console.warn('Background server upload failed:', err);
        serverError = 'Network error';
      }

      if (!finalUrl) {
        showBgError(serverError || 'Upload failed');
        bgUploadInput.value = '';
        return;
      }

      // Verify the image actually loads before applying
      try {
        await preloadImage(finalUrl);
      } catch (err) {
        showBgError('Uploaded image could not be loaded. The storage bucket may not be publicly accessible.');
        bgUploadInput.value = '';
        return;
      }

      // Add to uploads list and apply
      if (_bgUploads.indexOf(finalUrl) === -1) {
        _bgUploads.push(finalUrl);
      }
      _bgUrl = finalUrl;
      renderSavedUploads();
      applyBg(finalUrl);
      markActive(finalUrl);
      saveBgToAPI();

      bgUploadInput.value = '';
    });
  }

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!bgDropdown.classList.contains('hidden') && !bgDropdown.contains(e.target) && e.target !== bgBtn) {
      bgDropdown.classList.add('hidden');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !bgDropdown.classList.contains('hidden')) {
      bgDropdown.classList.add('hidden');
    }
  });

  // Expose loadBg so bootstrap can call it after auth
  window._loadBgAfterAuth = loadBg;
})();

// ——— Article View Mode ———
let currentViewMode = 'canvas';
const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');
const articleAiSection = document.getElementById('article-ai-section');
const articleAiContent = document.getElementById('article-ai-content');
const viewToggleCanvas = document.getElementById('view-toggle-canvas');
const viewToggleArticle = document.getElementById('view-toggle-article');
const viewToggleResearch = document.getElementById('view-toggle-research');

// ——— Research Mode State ———
let researchModeEnabled = false;
let researchGenerating = false;
// Track thought chain lineage: childEntryId → parentEntryId
const researchChainMap = new Map();
// Track which entries have already been researched to avoid duplicates
const researchedEntries = new Set();
// Track research source → child entry IDs for SVG lines
const researchChildrenMap = new Map();

// ——— Research Mode Functions ———

function buildThoughtChain(entryId) {
  const chain = [];
  let current = entryId;
  while (current) {
    const ed = entries.get(current);
    if (ed && ed.text) chain.unshift(ed.text);
    current = researchChainMap.get(current) || null;
  }
  return chain;
}

// ——— Research v2: Card Renderers ———

function createResearchFactCard(factText) {
  const card = document.createElement('div');
  card.className = 'research-fact-card research-card-animate';
  const icon = document.createElement('span');
  icon.className = 'research-fact-icon';
  icon.textContent = '\u2727';
  card.appendChild(icon);
  const textSpan = document.createElement('span');
  textSpan.textContent = factText;
  card.appendChild(textSpan);
  return card;
}

function createWebResultCard(result) {
  const card = document.createElement('div');
  card.className = 'research-web-card research-card-animate';
  let domain = '';
  try { domain = new URL(result.link).hostname.replace('www.', ''); } catch {}
  const faviconUrl = result.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  card.innerHTML = `<div class="research-web-card-header"><img class="research-web-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'"/><span class="research-web-domain">${escapeHtml(domain)}</span></div><div class="research-web-title">${escapeHtml(result.title)}</div><div class="research-web-snippet">${escapeHtml(result.snippet)}</div>`;
  card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      window.open(result.link, '_blank');
    }
  });
  return card;
}

function createResearchImageCard(imageData) {
  const card = document.createElement('div');
  card.className = 'research-image-card research-card-animate';
  const img = document.createElement('img');
  img.src = imageData.url;
  img.alt = imageData.alt || '';
  img.draggable = false;
  img.loading = 'lazy';
  card.appendChild(img);
  if (imageData.photographer) {
    const credit = document.createElement('div');
    credit.className = 'research-image-credit';
    credit.textContent = imageData.photographer;
    card.appendChild(credit);
  }
  return card;
}

function createFollowUpCard(questionText) {
  const card = document.createElement('div');
  card.className = 'research-followup-card research-card-animate';
  card.innerHTML = `<span class="research-followup-icon">?</span>`;
  const textSpan = document.createElement('span');
  textSpan.textContent = questionText;
  card.appendChild(textSpan);
  return card;
}

// Render a research card inside an entry element based on mediaCardData.researchCardType
function renderResearchCard(entry, entryData) {
  const mcd = entryData.mediaCardData;
  if (!mcd || !mcd.researchCardType) return false;

  entry.classList.add('research-entry');
  // Clear meltified content
  entry.innerHTML = '';

  switch (mcd.researchCardType) {
    case 'fact':
    case 'answer': // backward compat with old answer cards
      entry.appendChild(createResearchFactCard(entryData.text));
      break;
    case 'web': {
      const webData = mcd.webResultData || {};
      entry.appendChild(createWebResultCard({
        title: webData.title || entryData.text,
        link: webData.link || '',
        snippet: webData.snippet || '',
        favicon: webData.favicon || ''
      }));
      break;
    }
    case 'image': {
      const imgData = mcd.imageData || {};
      entry.appendChild(createResearchImageCard({
        url: imgData.url || '',
        alt: imgData.alt || entryData.text,
        photographer: imgData.photographer || ''
      }));
      break;
    }
    case 'followup':
      entry.appendChild(createFollowUpCard(entryData.text));
      break;
    default:
      return false;
  }
  return true;
}

// ——— Research v2: Layout Engine ———

// Card dimension constants
const CARD_DIMS = {
  fact:   { w: 340, h: 64 },
  web:    { w: 340, h: 110 },
  image:  { w: 300, h: 220 },
  followup: { w: 340, h: 44 }
};

function computeResearchLayout(sourceEntryId) {
  const sourceData = entries.get(sourceEntryId);
  if (!sourceData || !sourceData.element) return {};

  const el = sourceData.element;
  const srcX = parseFloat(el.style.left) || 0;
  const srcY = parseFloat(el.style.top) || 0;
  const srcW = el.offsetWidth || 160;
  const srcH = el.offsetHeight || 40;
  const cx = srcX + srcW / 2;
  const cy = srcY + srcH / 2;

  const margin = 30; // gap between cards
  const positions = {};

  // Follow-ups: above source, spread horizontally with gap
  const fuH = CARD_DIMS.followup.h;
  const fuY = cy - srcH / 2 - margin - fuH;
  positions.followUps = [
    { x: cx - CARD_DIMS.followup.w - margin / 2, y: fuY },
    { x: cx + margin / 2, y: fuY }
  ];

  // Web results: right of source, stacked vertically with gaps
  const webX = cx + srcW / 2 + margin + 60;
  const webStartY = cy - (CARD_DIMS.web.h * 1.5 + margin);
  positions.web = [
    { x: webX, y: webStartY },
    { x: webX, y: webStartY + CARD_DIMS.web.h + margin },
    { x: webX, y: webStartY + (CARD_DIMS.web.h + margin) * 2 }
  ];

  // Images: left of source, stacked vertically with gaps
  const imgX = cx - srcW / 2 - margin - CARD_DIMS.image.w - 60;
  const imgStartY = cy - (CARD_DIMS.image.h + margin / 2);
  positions.images = [
    { x: imgX, y: imgStartY },
    { x: imgX, y: imgStartY + CARD_DIMS.image.h + margin }
  ];

  // Facts: below source, stacked vertically, centered
  const factX = cx - CARD_DIMS.fact.w / 2;
  const factStartY = cy + srcH / 2 + margin + 20;
  positions.facts = [
    { x: factX, y: factStartY },
    { x: factX, y: factStartY + CARD_DIMS.fact.h + margin },
    { x: factX, y: factStartY + (CARD_DIMS.fact.h + margin) * 2 }
  ];

  return positions;
}

// Collect bounding boxes of all visible entries on the canvas
function getExistingEntryBounds(excludeSourceId) {
  const bounds = [];
  entries.forEach((ed, id) => {
    if (id === 'anchor' || id === excludeSourceId) return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    if (!ed.element || ed.element.style.display === 'none') return;
    const x = ed.position?.x ?? (parseFloat(ed.element.style.left) || 0);
    const y = ed.position?.y ?? (parseFloat(ed.element.style.top) || 0);
    const w = ed.element.offsetWidth || 160;
    const h = ed.element.offsetHeight || 40;
    bounds.push({ x, y, w, h });
  });
  return bounds;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad) {
  return ax < bx + bw + pad && ax + aw + pad > bx &&
         ay < by + bh + pad && ay + ah + pad > by;
}

// Push a position away from all existing entries and other new positions
function resolveCollisions(positions, sourceEntryId) {
  const existing = getExistingEntryBounds(sourceEntryId);
  const pad = 20; // minimum gap between any two cards

  // Collect all new cards with their dimensions
  const cards = [];
  (positions.facts || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.fact, dir: 'down' }));
  (positions.web || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.web, dir: 'down' }));
  (positions.images || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.image, dir: 'down' }));
  (positions.followUps || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.followup, dir: 'up' }));

  // Multiple passes to resolve
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      // Check against existing entries
      for (const b of existing) {
        if (rectsOverlap(c.pos.x, c.pos.y, c.w, c.h, b.x, b.y, b.w, b.h, pad)) {
          // Push in the card's primary direction
          if (c.dir === 'down') c.pos.y = b.y + b.h + pad;
          else c.pos.y = b.y - c.h - pad;
        }
      }
      // Check against other new cards
      for (let j = 0; j < i; j++) {
        const o = cards[j];
        if (rectsOverlap(c.pos.x, c.pos.y, c.w, c.h, o.pos.x, o.pos.y, o.w, o.h, pad)) {
          if (c.dir === 'down') c.pos.y = o.pos.y + o.h + pad;
          else c.pos.y = o.pos.y - c.h - pad;
        }
      }
    }
  }
}

// ——— Research v2: SVG Connection Lines ———

function drawResearchLine(svg, sourceId, targetId) {
  const sourceData = entries.get(sourceId);
  const targetData = entries.get(targetId);
  if (!sourceData?.element || !targetData?.element) return;

  const sEl = sourceData.element;
  const tEl = targetData.element;
  const sx = (parseFloat(sEl.style.left) || 0) + (sEl.offsetWidth || 0) / 2;
  const sy = (parseFloat(sEl.style.top) || 0) + (sEl.offsetHeight || 0) / 2;
  const tx = (parseFloat(tEl.style.left) || 0) + (tEl.offsetWidth || 0) / 2;
  const ty = (parseFloat(tEl.style.top) || 0) + (tEl.offsetHeight || 0) / 2;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', sx);
  line.setAttribute('y1', sy);
  line.setAttribute('x2', tx);
  line.setAttribute('y2', ty);
  line.classList.add('research-connection');
  line.dataset.sourceId = sourceId;
  line.dataset.targetId = targetId;
  svg.appendChild(line);
}

function clearResearchLines(sourceId) {
  const svg = document.getElementById('research-lines');
  if (!svg) return;
  const lines = svg.querySelectorAll(`line[data-source-id="${sourceId}"]`);
  lines.forEach(l => l.remove());
}

function updateResearchLinePositions(entryId) {
  const svg = document.getElementById('research-lines');
  if (!svg) return;
  // Update lines where this entry is source or target
  const lines = svg.querySelectorAll(`line[data-source-id="${entryId}"], line[data-target-id="${entryId}"]`);
  lines.forEach(line => {
    const sId = line.dataset.sourceId;
    const tId = line.dataset.targetId;
    const sData = entries.get(sId);
    const tData = entries.get(tId);
    if (!sData?.element || !tData?.element) { line.remove(); return; }
    const sEl = sData.element;
    const tEl = tData.element;
    line.setAttribute('x1', (parseFloat(sEl.style.left) || 0) + (sEl.offsetWidth || 0) / 2);
    line.setAttribute('y1', (parseFloat(sEl.style.top) || 0) + (sEl.offsetHeight || 0) / 2);
    line.setAttribute('x2', (parseFloat(tEl.style.left) || 0) + (tEl.offsetWidth || 0) / 2);
    line.setAttribute('y2', (parseFloat(tEl.style.top) || 0) + (tEl.offsetHeight || 0) / 2);
  });
}

// ——— Research v2: Skeleton Placeholders ———

function createResearchPlaceholder(pos, sizeClass) {
  const el = document.createElement('div');
  el.className = `research-placeholder ${sizeClass || ''}`;
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  world.appendChild(el);
  return el;
}

// ——— Research v2: Main Orchestrator ———

async function spawnResearchEntries(sourceEntryId) {
  if (!researchModeEnabled || isReadOnly || researchGenerating) return;
  if (researchedEntries.has(sourceEntryId)) return;

  const entryData = entries.get(sourceEntryId);
  if (!entryData || !entryData.text || entryData.text.trim().length < 5) return;

  researchGenerating = true;
  researchedEntries.add(sourceEntryId);
  if (entryData.element) entryData.element.classList.add('research-generating');

  const positions = computeResearchLayout(sourceEntryId);
  resolveCollisions(positions, sourceEntryId);

  // Show skeleton placeholders at all positions with staggered timing
  const skeletons = [];
  let skeletonDelay = 0;
  const addSkeleton = (pos, cls) => {
    setTimeout(() => {
      skeletons.push(createResearchPlaceholder(pos, cls));
    }, skeletonDelay);
    skeletonDelay += 80;
  };
  (positions.facts || []).forEach(p => addSkeleton(p, 'research-skeleton-fact'));
  (positions.web || []).forEach(p => addSkeleton(p, 'research-skeleton-web'));
  (positions.images || []).forEach(p => addSkeleton(p, 'research-skeleton-image'));
  (positions.followUps || []).forEach(p => addSkeleton(p, 'research-skeleton-followup'));

  const thoughtChain = buildThoughtChain(sourceEntryId);
  const canvasContext = [];
  const existingFacts = [];
  entries.forEach((ed) => {
    if (ed.id === 'anchor' || ed.id === sourceEntryId) return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    canvasContext.push({ text: ed.text });
    // Collect existing research facts to avoid repetition
    if (ed.mediaCardData && (ed.mediaCardData.researchCardType === 'fact' || ed.mediaCardData.researchCardType === 'answer')) {
      existingFacts.push(ed.text);
    }
  });

  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thoughtChain, canvasContext, existingFacts })
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    await placeResearchResults(sourceEntryId, data, positions, skeletons);
  } catch (err) {
    console.error('[RESEARCH] v2 failed, trying legacy endpoint:', err);
    // Fallback to old endpoint
    try {
      const res = await fetch('/api/research-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thoughtChain, canvasContext })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.entries && data.entries.length > 0) {
          // Legacy placement: use old 4-position radial layout
          const legacyPositions = computeLegacyResearchPositions(sourceEntryId);
          await placeLegacyResearchEntries(sourceEntryId, data.entries, legacyPositions, skeletons);
        }
      }
    } catch (e2) {
      console.error('[RESEARCH] Legacy fallback also failed:', e2);
    }
  } finally {
    skeletons.forEach(s => { if (s.parentNode) s.remove(); });
    researchGenerating = false;
    if (entryData.element) entryData.element.classList.remove('research-generating');
  }
}

// Legacy 4-position layout for fallback
function computeLegacyResearchPositions(sourceEntryId) {
  const sourceData = entries.get(sourceEntryId);
  if (!sourceData || !sourceData.element) return [];
  const el = sourceData.element;
  const srcX = parseFloat(el.style.left) || 0;
  const srcY = parseFloat(el.style.top) || 0;
  const srcW = el.offsetWidth || 160;
  const srcH = el.offsetHeight || 40;
  const cx = srcX + srcW / 2;
  const cy = srcY + srcH / 2;
  const radius = 340;
  const entryW = 200;
  const entryH = 80;
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return angles.map(angle => ({
    x: cx + radius * Math.cos(angle) - entryW / 2,
    y: cy + radius * Math.sin(angle) - entryH / 2,
  }));
}

async function placeLegacyResearchEntries(sourceEntryId, textEntries, positions, skeletons) {
  const svg = document.getElementById('research-lines');
  for (let i = 0; i < Math.min(textEntries.length, positions.length); i++) {
    const text = textEntries[i];
    if (!text || typeof text !== 'string') continue;
    if (skeletons[i] && skeletons[i].parentNode) skeletons[i].remove();
    const pos = positions[i];
    const entryId = generateEntryId();
    const entry = document.createElement('div');
    entry.className = 'entry melt';
    entry.id = entryId;
    entry.style.left = `${pos.x}px`;
    entry.style.top = `${pos.y}px`;
    entry.innerHTML = meltify(text);
    applyEntryFontSize(entry, null);
    world.appendChild(entry);
    setTimeout(() => updateEntryDimensions(entry), 50);
    const entryDataObj = {
      id: entryId, element: entry, text, textHtml: null, latexData: null,
      position: { x: pos.x, y: pos.y }, parentEntryId: currentViewEntryId
    };
    entries.set(entryId, entryDataObj);
    researchChainMap.set(entryId, sourceEntryId);
    updateEntryVisibility();
    await saveEntryToServer(entryDataObj);
    if (svg) drawResearchLine(svg, sourceEntryId, entryId);
    setTimeout(() => {
      entry.classList.remove('melt');
      entry.querySelectorAll('span').forEach(s => {
        s.style.animation = 'none'; s.style.transform = ''; s.style.filter = ''; s.style.opacity = '';
      });
      updateEntryDimensions(entry);
    }, 1500);
  }
}

async function placeResearchResults(sourceEntryId, data, positions, skeletons) {
  const svg = document.getElementById('research-lines');
  const childIds = [];
  let skeletonIdx = 0;
  let placeDelay = 0;

  const placeOne = async (pos, text, cardType, extraMediaData) => {
    // Remove corresponding skeleton
    if (skeletons[skeletonIdx] && skeletons[skeletonIdx].parentNode) skeletons[skeletonIdx].remove();
    skeletonIdx++;

    await new Promise(r => setTimeout(r, placeDelay));
    placeDelay += 120;

    const entryId = generateEntryId();
    const entry = document.createElement('div');
    entry.className = 'entry research-entry';
    entry.id = entryId;
    entry.style.left = `${pos.x}px`;
    entry.style.top = `${pos.y}px`;

    const mediaCardData = { researchCardType: cardType, ...extraMediaData };

    // Build entry data object
    const entryDataObj = {
      id: entryId, element: entry, text, textHtml: null, latexData: null,
      position: { x: pos.x, y: pos.y }, parentEntryId: currentViewEntryId,
      mediaCardData
    };
    entries.set(entryId, entryDataObj);

    // Render the card
    renderResearchCard(entry, entryDataObj);

    world.appendChild(entry);
    setTimeout(() => updateEntryDimensions(entry), 50);

    researchChainMap.set(entryId, sourceEntryId);
    childIds.push(entryId);

    updateEntryVisibility();
    await saveEntryToServer(entryDataObj);

    if (svg) {
      setTimeout(() => drawResearchLine(svg, sourceEntryId, entryId), 50);
    }

    return entryId;
  };

  // Place fact cards
  const facts = data.facts || [];
  const factPositions = positions.facts || [];
  for (let i = 0; i < Math.min(facts.length, factPositions.length); i++) {
    await placeOne(factPositions[i], facts[i], 'fact', {});
  }

  // Place web results
  const webResults = data.webResults || [];
  const webPositions = positions.web || [];
  for (let i = 0; i < Math.min(webResults.length, webPositions.length); i++) {
    const wr = webResults[i];
    await placeOne(webPositions[i], wr.title || '', 'web', {
      webResultData: { title: wr.title, link: wr.link, snippet: wr.snippet, favicon: wr.favicon }
    });
  }

  // Place images
  const images = data.images || [];
  const imgPositions = positions.images || [];
  for (let i = 0; i < Math.min(images.length, imgPositions.length); i++) {
    const img = images[i];
    await placeOne(imgPositions[i], img.alt || '', 'image', {
      imageData: { url: img.url, alt: img.alt, photographer: img.photographer }
    });
  }

  // Place follow-ups
  const followUps = data.followUps || [];
  const fuPositions = positions.followUps || [];
  for (let i = 0; i < Math.min(followUps.length, fuPositions.length); i++) {
    await placeOne(fuPositions[i], followUps[i], 'followup', {});
  }

  researchChildrenMap.set(sourceEntryId, childIds);
}

function setViewMode(mode) {
  if (mode === currentViewMode) return;

  // Just toggle the flag — research entries are real and persist
  if (researchModeEnabled && mode !== 'research') {
    researchModeEnabled = false;
  }

  currentViewMode = mode;

  viewToggleCanvas.classList.toggle('active', mode === 'canvas');
  viewToggleArticle.classList.toggle('active', mode === 'article');
  if (viewToggleResearch) viewToggleResearch.classList.toggle('active', mode === 'research');
  document.body.classList.toggle('article-mode', mode === 'article');

  if (mode === 'article') {
    researchModeEnabled = false;
    viewport.style.display = 'none';
    if (editingEntryId) {
      editor.blur();
      hideCursor();
    }
    articleView.classList.remove('hidden');
    renderArticleView();
  } else if (mode === 'research') {
    researchModeEnabled = true;
    articleView.classList.add('hidden');
    viewport.style.display = '';
    // Recalculate entry dimensions when switching
    setTimeout(() => {
      entries.forEach((ed, id) => {
        if (id === 'anchor') return;
        if (ed.element && ed.element.style.display !== 'none') {
          updateEntryDimensions(ed.element);
        }
      });
    }, 50);
  } else {
    // canvas mode
    researchModeEnabled = false;
    articleView.classList.add('hidden');
    viewport.style.display = '';
    // Recalculate entry dimensions when switching back
    setTimeout(() => {
      entries.forEach((ed, id) => {
        if (id === 'anchor') return;
        if (ed.element && ed.element.style.display !== 'none') {
          updateEntryDimensions(ed.element);
        }
      });
    }, 50);
  }
}

function getArticleCategory(ed) {
  const mcd = ed.mediaCardData;
  if (mcd && mcd.type === 'image') return 'images';
  if (mcd && mcd.type === 'file') return 'files';
  if (mcd && mcd.type === 'song') return 'songs';
  if (mcd && mcd.type === 'movie') return 'movies';
  if (ed.latexData && ed.latexData.enabled) return 'latex';
  if (ed.textHtml && ed.textHtml.includes('deadline-table')) return 'deadlines';
  if (ed.linkCardsData && ed.linkCardsData.length > 0 && ed.linkCardsData.some(c => c && c.url)) return 'links';
  return 'notes';
}

function getFlattenedArticleEntries() {
  const list = [];
  entries.forEach((ed) => {
    if (ed.id === 'anchor') return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    const cat = getArticleCategory(ed);
    list.push({ ed, category: cat });
  });
  list.sort((a, b) => {
    const ay = a.ed.position?.y ?? 0;
    const by = b.ed.position?.y ?? 0;
    if (ay !== by) return ay - by;
    return (a.ed.position?.x ?? 0) - (b.ed.position?.x ?? 0);
  });
  return list;
}

function renderArticleView() {
  const flattened = getFlattenedArticleEntries();
  const totalCount = flattened.length;

  let titleText = 'Home';
  if (currentViewEntryId) {
    const parent = entries.get(currentViewEntryId);
    if (parent) titleText = entryTitle(parent);
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  articleHeader.innerHTML = `<h1 class="article-header-title">${escapeHtml(titleText)}</h1><div class="article-header-meta">${totalCount} item${totalCount !== 1 ? 's' : ''} &middot; ${dateStr}</div>`;

  if (articleSidebarNav) articleSidebarNav.innerHTML = '';

  articleContent.innerHTML = '';
  if (totalCount === 0) {
    articleContent.innerHTML = '<div class="article-empty">No entries on this page yet.</div>';
    articleAiSection.classList.add('hidden');
    return;
  }

  const stream = document.createElement('div');
  stream.className = 'article-stream';
  flattened.forEach(({ ed, category }) => {
    const el = renderArticleEntry(ed, category);
    if (el) stream.appendChild(el);
  });
  articleContent.appendChild(stream);

  fetchArticleRelated();
}

function renderArticleEntry(ed, category) {
  switch (category) {
    case 'notes': {
      const card = document.createElement('div');
      card.className = 'article-note-card';
      if (ed.textHtml) {
        card.innerHTML = ed.textHtml;
      } else {
        card.textContent = ed.text || '';
      }
      // Check if this entry has children
      const hasChildren = Array.from(entries.values()).some(e => e.parentEntryId === ed.id);
      if (hasChildren) {
        card.classList.add('clickable');
        const hint = document.createElement('div');
        hint.className = 'article-note-children-hint';
        hint.textContent = 'Open subpage \u2192';
        card.appendChild(hint);
        card.addEventListener('click', () => navigateToEntry(ed.id));
      }
      return card;
    }
    case 'links': {
      const frag = document.createDocumentFragment();
      (ed.linkCardsData || []).forEach(lc => {
        if (!lc || !lc.url) return;
        const a = document.createElement('a');
        a.className = 'article-link-card';
        a.href = lc.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `${lc.image ? `<div class="article-link-thumb" style="background-image:url('${lc.image}')"></div>` : ''}
          <div class="article-link-body">
            <div class="article-link-site">${escapeHtml(lc.siteName || '')}</div>
            <div class="article-link-title">${escapeHtml(lc.title || '')}</div>
            ${lc.description ? `<div class="article-link-desc">${escapeHtml(lc.description)}</div>` : ''}
            <div class="article-link-open">Open link \u2192</div>
          </div>`;
        frag.appendChild(a);
      });
      // Also show the text if any (above the link cards)
      if (ed.text && ed.text.trim()) {
        const wrapper = document.createElement('div');
        const textDiv = document.createElement('div');
        textDiv.className = 'article-note-card';
        textDiv.style.marginBottom = '8px';
        textDiv.textContent = ed.text;
        wrapper.appendChild(textDiv);
        wrapper.appendChild(frag);
        return wrapper;
      }
      return frag.childNodes.length > 0 ? (() => { const d = document.createElement('div'); d.appendChild(frag); return d; })() : null;
    }
    case 'songs':
    case 'movies': {
      const mcd = ed.mediaCardData;
      if (!mcd) return null;
      const card = document.createElement('div');
      card.className = 'article-media-card';
      const imageUrl = mcd.image || mcd.poster || '';
      const typeLabel = mcd.type === 'song' ? 'Song' : 'Movie';
      const subtitle = mcd.type === 'song' ? (mcd.artist || '') : (mcd.year ? String(mcd.year) : '');
      card.innerHTML = `${imageUrl ? `<div class="article-media-image" style="background-image:url('${imageUrl}')"></div>` : ''}
        <div class="article-media-info">
          <div class="article-media-type">${typeLabel}</div>
          <div class="article-media-title">${escapeHtml(mcd.title || '')}</div>
          ${subtitle ? `<div class="article-media-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>`;
      return card;
    }
    case 'images': {
      const mcd = ed.mediaCardData;
      if (!mcd || !mcd.url) return null;
      const card = document.createElement('div');
      card.className = 'article-image-card';
      const img = document.createElement('img');
      img.src = mcd.url;
      img.alt = 'Image';
      img.loading = 'lazy';
      card.appendChild(img);
      return card;
    }
    case 'files': {
      const mcd = ed.mediaCardData;
      if (!mcd) return null;
      const card = document.createElement('div');
      card.className = 'article-file-card';
      card.innerHTML = `<span class="article-file-icon">${getFileIcon(mcd.mimetype || '')}</span>
        <div>
          <div class="article-file-name">${escapeHtml(mcd.name || 'File')}</div>
          <div class="article-file-size">${formatFileSize(mcd.size || 0)}</div>
        </div>`;
      if (mcd.url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => window.open(mcd.url, '_blank'));
      }
      return card;
    }
    case 'latex': {
      const card = document.createElement('div');
      card.className = 'article-latex-card';
      if (ed.latexData && ed.latexData.source) {
        const container = document.createElement('div');
        card.appendChild(container);
        setTimeout(() => {
          if (typeof renderMathInElement !== 'undefined') {
            container.innerHTML = ed.latexData.source;
            renderMathInElement(container, { delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false }
            ], throwOnError: false });
          } else if (typeof katex !== 'undefined') {
            try { katex.render(ed.latexData.source, container, { displayMode: true, throwOnError: false }); }
            catch(e) { container.textContent = ed.latexData.source; }
          } else {
            container.textContent = ed.latexData.source;
          }
        }, 100);
      }
      return card;
    }
    case 'deadlines': {
      const card = document.createElement('div');
      card.className = 'article-deadline-card';
      if (ed.element) {
        const dt = ed.element.querySelector('.deadline-table');
        if (dt) {
          card.appendChild(dt.cloneNode(true));
        } else if (ed.textHtml) {
          card.innerHTML = ed.textHtml;
        }
      } else if (ed.textHtml) {
        card.innerHTML = ed.textHtml;
      }
      return card;
    }
    default:
      return null;
  }
}

function fetchArticleRelated() {
  if (!currentUser) {
    articleAiSection.classList.add('hidden');
    return;
  }
  articleAiSection.classList.remove('hidden');
  articleAiContent.innerHTML = '<div class="article-related-loading">Finding related content…</div>';

  const payload = buildTrenchesPayload();
  const body = {
    ...payload,
    userMessage: `RELATED CONTENT TASK: Suggest 3–5 real articles and books that fit the content and aesthetic of this page.

Only recommend actual, well-known works: real book titles with authors, real essay/article titles with publications or authors. Never invent or make up titles. Draw from your knowledge of classic and notable works.

Format: One line per item. "Title" by Author (or "Article Title" – Publication). No asterisks, no markdown, no links. Plain text only.

Examples: "Bullshit Jobs" by David Graeber | "Consider the Lobster" – David Foster Wallace, The Atlantic`
  };
  fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
    .then(data => {
      let raw = (data.message || '').trim();
      raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/\*+/g, '').replace(/^#+\s*/gm, '');
      articleAiContent.innerHTML = `<div class="article-related-card">${escapeHtml(raw)}</div>`;
    })
    .catch(() => {
      articleAiContent.innerHTML = '<div class="article-related-loading">Could not load related content.</div>';
    });
}

// Toggle event listeners
if (viewToggleCanvas) viewToggleCanvas.addEventListener('click', () => setViewMode('canvas'));
if (viewToggleArticle) viewToggleArticle.addEventListener('click', () => setViewMode('article'));
if (viewToggleResearch) viewToggleResearch.addEventListener('click', () => setViewMode('research'));

// Patch navigation functions to re-render article view
const _origNavigateToEntry = navigateToEntry;
navigateToEntry = function(entryId) {
  _origNavigateToEntry(entryId);
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

const _origNavigateBack = navigateBack;
navigateBack = function(level) {
  _origNavigateBack(level);
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

const _origNavigateToRoot = navigateToRoot;
navigateToRoot = function() {
  _origNavigateToRoot();
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

// ——— Google Calendar Integration ———
const googleConnectBtn = document.getElementById('google-connect-btn');
const googleConnectLabel = document.getElementById('google-connect-label');
const googleConnectDesc = document.getElementById('google-connect-desc');

let gcalConnected = false;
let gcalCalendarSettings = {};

// Check Google connection on load
async function checkGoogleStatus() {
  try {
    const res = await fetch('/api/oauth/google/status', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    gcalConnected = data.connected;
    gcalCalendarSettings = data.calendarSettings || {};
    updateGoogleConnectButton();
  } catch(e) { /* not connected */ }
}

function updateGoogleConnectButton() {
  if (!googleConnectLabel) return;
  const gcalCardBtn = document.querySelector('.gcal-card-btn');
  if (gcalConnected) {
    googleConnectLabel.innerHTML = 'Google Connected <span class="google-connected-badge"></span>';
    if (googleConnectDesc) googleConnectDesc.textContent = 'GCal, Sheets, Docs';
    if (gcalCardBtn) gcalCardBtn.classList.remove('hidden');
  } else {
    googleConnectLabel.textContent = 'Google Connection';
    if (googleConnectDesc) googleConnectDesc.textContent = 'GCal, Sheets, Docs';
    if (gcalCardBtn) gcalCardBtn.classList.add('hidden');
  }
}

async function handleGoogleConnection() {
  if (!currentUser) return;
  if (gcalConnected) return;
  try {
    const res = await fetch('/api/oauth/google/auth', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    window.location.href = data.url;
  } catch (e) {
    console.error('Google auth error:', e);
  }
}

function formatDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Post-OAuth redirect: clean URL and refresh connection status
if (window.location.search.includes('google=connected')) {
  const url = new URL(window.location);
  url.searchParams.delete('google');
  window.history.replaceState({}, '', url.pathname);
  setTimeout(() => checkGoogleStatus(), 500);
}

bootstrap();

// Check Google status after auth loads
setTimeout(() => {
  if (currentUser) checkGoogleStatus();
}, 2000);
