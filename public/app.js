const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const editor = document.getElementById('editor');
const anchor = document.getElementById('anchor');
const breadcrumb = document.getElementById('breadcrumb');
const authOverlay = document.getElementById('auth-overlay');
const authStepPhone = document.getElementById('auth-step-phone');
const authStepCode = document.getElementById('auth-step-code');
const authStepUsername = document.getElementById('auth-step-username');
const authPhoneInput = document.getElementById('auth-phone-input');
const authCodeInput = document.getElementById('auth-code-input');
const authUsernameInput = document.getElementById('auth-username-input');
const authSendCodeBtn = document.getElementById('auth-send-code');
const authVerifyCodeBtn = document.getElementById('auth-verify-code');
const authEditPhoneBtn = document.getElementById('auth-edit-phone');
const authSaveUsernameBtn = document.getElementById('auth-save-username');
const authError = document.getElementById('auth-error');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authCodeHint = document.getElementById('auth-code-hint');
const authCodeBoxes = document.getElementById('auth-code-boxes');

let currentUser = null;
let isReadOnly = false; // Set to true when viewing someone else's page

// Camera state
let cam = { x: 0, y: 0, z: 1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const anchorPos = { x: 0, y: 0 };

// Entry storage
const entries = new Map();
let entryIdCounter = 0;

function setAnchorGreeting() {
  if (currentUser && currentUser.username) {
    anchor.textContent = `Hello, ${currentUser.username}`;
  } else {
    anchor.textContent = 'Hello';
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
  authStepUsername.classList.add('hidden');
  // Default to US country code so it's visible and users know to include +1
  authPhoneInput.value = '+1 ';
  authCodeInput.value = '';
  authUsernameInput.value = '';
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
  const phone = authPhoneInput.value.trim();
  if (!phone) {
    setAuthError('Enter a phone number.');
    return;
  }
  setAuthError('');
  authSendCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
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
  const phone = authPhoneInput.value.trim();
  const code = authCodeInput.value.trim();
  if (!phone || !code) {
    setAuthError('Enter your phone and the code.');
    return;
  }
  setAuthError('');
  authVerifyCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify code');
    }
    currentUser = data.user;
    setAnchorGreeting();
    if (data.needsUsername) {
      authStepCode.classList.add('hidden');
      authStepUsername.classList.remove('hidden');
      authUsernameInput.focus();
    } else {
      hideAuthOverlay();
      await loadEntriesFromServer();
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save username');
    }
    currentUser = data.user;
    setAnchorGreeting();
    hideAuthOverlay();
    await loadEntriesFromServer();
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
  authCodeInput.addEventListener('input', () => {
    authCodeInput.value = authCodeInput.value.replace(/\D/g, '').slice(0, 6);
    updateCodeBoxes();
  });
}

async function bootstrap() {
  // Check if we're on a user page FIRST, before anything else runs
  const pageUsername = window.PAGE_USERNAME;
  const isOwner = window.PAGE_IS_OWNER === true;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const isUserPage = !!pageUsername || (pathParts.length > 0 && pathParts[0] !== 'index.html' && pathParts[0] !== '');
  
  // CRITICAL: Hide auth overlay IMMEDIATELY if on a user page - do this BEFORE initAuthUI
  if (isUserPage && authOverlay) {
    authOverlay.classList.add('hidden');
    authOverlay.style.display = 'none'; // Force hide with inline style
  }
  
  // Only initialize auth UI if NOT on a user page
  if (!isUserPage) {
    initAuthUI();
  }
  
  setAnchorGreeting();
  
  try {
    const res = await fetch('/api/auth/me');
    let isLoggedIn = false;
    
    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      setAnchorGreeting();
      isLoggedIn = true;
      
      // If on root and logged in, redirect to user's page
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
    const response = await fetch(`/api/public/${username}/entries`);
    if (!response.ok) {
      throw new Error('Failed to load entries');
    }
    
    const data = await response.json();
    const entriesData = data.entries || [];
    
    console.log(`[LOAD] Fetched ${entriesData.length} entries for ${username}`);
    
    // Log entry hierarchy for debugging
    const rootEntries = entriesData.filter(e => !e.parentEntryId);
    const childEntries = entriesData.filter(e => e.parentEntryId);
    console.log(`[LOAD] Root entries: ${rootEntries.length}, Child entries: ${childEntries.length}`);
    console.log('[LOAD] Root entries:', rootEntries.map(e => ({ id: e.id, text: e.text.substring(0, 30) })));
    console.log('[LOAD] Child entries:', childEntries.map(e => ({ id: e.id, parent: e.parentEntryId, text: e.text.substring(0, 30) })));
    
    // Find the highest entry ID counter
    let maxCounter = 0;
    entriesData.forEach(entry => {
      const match = entry.id.match(/^entry-(\d+)$/);
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
      
      // Initially hide all entries - visibility will be set after navigation state is determined
      entry.style.display = 'none';
      
      // Process text with links
      const { processedText, urls } = processTextWithLinks(entryData.text);
      
      if (processedText) {
        entry.innerHTML = meltify(processedText);
      } else {
        entry.innerHTML = '';
      }
      
      // Set proper width for entries based on content
      if (entryData.text) {
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre';
        temp.style.font = window.getComputedStyle(entry).font;
        temp.style.fontSize = window.getComputedStyle(entry).fontSize;
        temp.style.fontFamily = window.getComputedStyle(entry).fontFamily;
        temp.textContent = entryData.text;
        document.body.appendChild(temp);
        const contentWidth = getWidestLineWidth(temp);
        document.body.removeChild(temp);
        entry.style.width = `${contentWidth}px`;
      } else {
        entry.style.width = '400px';
      }
      entry.style.minHeight = '60px';
      
      // In read-only mode, allow clicks for navigation
      if (!editable) {
        entry.style.cursor = 'pointer';
      }
      
      world.appendChild(entry);
      
      // Store entry data
      const storedEntryData = {
        id: entryData.id,
        element: entry,
        text: entryData.text,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId
      };
      entries.set(entryData.id, storedEntryData);
      
      // Generate link cards if URLs exist
      if (urls.length > 0) {
        urls.forEach(async (url) => {
          const cardData = await generateLinkCard(url);
          if (cardData) {
            const card = createLinkCard(cardData);
            entry.appendChild(card);
          }
        });
      }
    });
    
    // Set read-only mode
    isReadOnly = !editable;
    
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
          const entrySlug = e.text && (typeof e.text === 'string') 
            ? generateEntrySlug(e.text)
            : '';
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
    
    if (isReadOnly) {
      editor.style.display = 'none';
      // Keep pan/zoom but disable editing
      viewport.style.cursor = 'grab';
      
      // Disable all entry interactions except navigation
      entriesData.forEach(entryData => {
        const entry = document.querySelector(`#${entryData.id}`);
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
async function saveEntryToServer(entryData) {
  if (isReadOnly) {
    console.warn('Cannot save entry: read-only mode');
    return null;
  }
  
  try {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: entryData.id,
        text: entryData.text,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to save entry');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving entry to server:', error);
    // Don't throw - allow app to continue working offline
    return null;
  }
}

async function updateEntryOnServer(entryData) {
  if (isReadOnly) {
    console.warn('Cannot update entry: read-only mode');
    return null;
  }
  
  try {
    const response = await fetch(`/api/entries/${entryData.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: entryData.text,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId,
        cardData: entryData.cardData || null
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update entry');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error updating entry on server:', error);
    return null;
  }
}

async function deleteEntryFromServer(entryId) {
  if (isReadOnly) {
    console.warn('Cannot delete entry: read-only mode');
    return false;
  }
  
  try {
    const response = await fetch(`/api/entries/${entryId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete entry');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting entry from server:', error);
    return false;
  }
}

async function loadEntriesFromServer() {
  try {
    const response = await fetch('/api/entries');
    
    if (!response.ok) {
      throw new Error('Failed to load entries');
    }
    
    const entriesData = await response.json();
    
    // Find the highest entry ID counter
    let maxCounter = 0;
    entriesData.forEach(entry => {
      const match = entry.id.match(/^entry-(\d+)$/);
      if (match) {
        const counter = parseInt(match[1], 10);
        if (counter > maxCounter) {
          maxCounter = counter;
        }
      }
    });
    entryIdCounter = maxCounter + 1;
    
    // Create entry elements and add to map
    entriesData.forEach(entryData => {
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.id = entryData.id;
      
      entry.style.left = `${entryData.position.x}px`;
      entry.style.top = `${entryData.position.y}px`;
      
      // Process text with links
      const { processedText, urls } = processTextWithLinks(entryData.text);
      
      if (processedText) {
        entry.innerHTML = meltify(processedText);
      } else {
        entry.innerHTML = '';
      }
      
      // Set proper width for entries based on content
      // Calculate width of widest line for multi-line entries
      if (entryData.text) {
        // Create temporary element to measure text width
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre';
        temp.style.font = window.getComputedStyle(entry).font;
        temp.style.fontSize = window.getComputedStyle(entry).fontSize;
        temp.style.fontFamily = window.getComputedStyle(entry).fontFamily;
        temp.textContent = entryData.text;
        document.body.appendChild(temp);
        const contentWidth = getWidestLineWidth(temp);
        document.body.removeChild(temp);
        entry.style.width = `${contentWidth}px`;
      } else {
        entry.style.width = '400px';
      }
      entry.style.minHeight = '60px';
      
      world.appendChild(entry);
      
      // Store entry data
      const storedEntryData = {
        id: entryData.id,
        element: entry,
        text: entryData.text,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId
      };
      entries.set(entryData.id, storedEntryData);
      
      // Generate link cards if URLs exist
      if (urls.length > 0) {
        urls.forEach(async (url) => {
          const cardData = await generateLinkCard(url);
          if (cardData) {
            const card = createLinkCard(cardData);
            entry.appendChild(card);
          }
        });
      }
    });
    
    // Update visibility after loading
    updateEntryVisibility();
    
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

// Drag-to-pan
let dragging = false;
let draggingEntry = null;
let dragOffset = { x: 0, y: 0 };
let last = { x: 0, y: 0 };
let justFinishedDragging = false;

// Where the editor is placed in WORLD coordinates
let editorWorldPos = { x: 80, y: 80 };
let editingEntryId = null;

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

// Check if a duplicate entry exists at the current directory level
function findDuplicateEntry(text, parentEntryId) {
  const normalizedText = text.trim().toLowerCase();
  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;
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
  
  // Get current username from page context or current user
  const pageUsername = window.PAGE_USERNAME;
  const username = pageUsername || (currentUser && currentUser.username);
  
  // Navigate locally with URL path update
  navigationStack.push(entryId);
  currentViewEntryId = entryId;
  updateBreadcrumb();
  updateEntryVisibility();
  
  // Update URL if we're on a user page
  if (username && pageUsername) {
    const slug = generateEntrySlug(entryData.text);
    const currentPath = window.location.pathname.split('/').filter(Boolean);
    
    // Build new path: append slug to current path
    const newPath = `/${currentPath.join('/')}/${slug}`;
    
    // Update URL without reloading
    window.history.pushState({ entryId, navigationStack: [...navigationStack] }, '', newPath);
  }
}

function navigateBack(level = 1) {
  isNavigating = true;
  
  // Hide and blur editor to prevent paste behavior
  if (editor.style.display !== 'none') {
    editor.style.display = 'none';
    editor.blur();
    editor.textContent = '';
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing');
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
  
  // Update URL to reflect navigation state
  const pageUsername = window.PAGE_USERNAME;
  if (pageUsername) {
    if (navigationStack.length === 0) {
      window.history.pushState({ navigationStack: [] }, '', `/${pageUsername}`);
    } else {
      // Build path from navigation stack
      const pathParts = [pageUsername];
      navigationStack.forEach(entryId => {
        const entryData = entries.get(entryId);
        if (entryData) {
          const slug = generateEntrySlug(entryData.text);
          pathParts.push(slug);
        }
      });
      window.history.pushState({ navigationStack: [...navigationStack] }, '', `/${pathParts.join('/')}`);
    }
  }
  
  // Reset navigation flag after a delay to prevent paste events
  // Also prevent editor from being shown for a bit longer
  setTimeout(() => {
    isNavigating = false;
    // Ensure editor is still hidden after navigation completes
    if (editor.style.display !== 'none') {
      editor.style.display = 'none';
      editor.blur();
      editor.textContent = '';
      editingEntryId = null;
    }
  }, 1000);
}

function navigateToRoot() {
  isNavigating = true;
  
  // Hide and blur editor to prevent paste behavior
  if (editor.style.display !== 'none') {
    editor.style.display = 'none';
    editor.blur();
    editor.textContent = '';
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing');
    }
    editingEntryId = null;
  }
  
  navigationStack = [];
  currentViewEntryId = null;
  updateBreadcrumb();
  updateEntryVisibility();
  
  // Update URL to root user page
  const pageUsername = window.PAGE_USERNAME;
  if (pageUsername) {
    window.history.pushState({ navigationStack: [] }, '', `/${pageUsername}`);
  }
  
  // Reset navigation flag after a delay to prevent paste events
  // Also prevent editor from being shown for a bit longer
  navigationJustCompleted = true;
  setTimeout(() => {
    isNavigating = false;
    // Ensure editor is still hidden after navigation completes
    if (editor.style.display !== 'none') {
      editor.style.display = 'none';
      editor.blur();
      editor.textContent = '';
      editingEntryId = null;
    }
    // Keep the flag for a bit longer to prevent accidental editor placement
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
    // Clear editor content and hide it
    editor.textContent = '';
    editor.style.display = 'none';
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
    const displayText = entryData.text.split('\n')[0].trim().substring(0, 50) || 'Untitled';
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
      // Clear editor content and hide it
      editor.textContent = '';
      editor.style.display = 'none';
      const level = navigationStack.length - index - 1;
      if (level > 0) {
        navigateBack(level);
      }
    });
    breadcrumb.appendChild(item);
  });
}


function placeEditorAtWorld(wx, wy, text = '', entryId = null){
  // Don't show editor during or right after navigation
  if (isNavigating || navigationJustCompleted) {
    return;
  }
  
  editorWorldPos = { x: wx, y: wy };
  editingEntryId = entryId;
  
  // Remove editing class from any previously editing entry
  const previousEditing = document.querySelector('.entry.editing');
  if(previousEditing){
    previousEditing.classList.remove('editing');
  }
  
  // Add editing class to current entry if editing
  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    if(entryData && entryData.element){
      entryData.element.classList.add('editing');
    }
  }
  
  editor.style.left = `${wx}px`;
  editor.style.top  = `${wy}px`;
  editor.style.display = 'block';
  editor.textContent = text;
  
  // Set editor width to match entry width if editing, or use content width
  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    if(entryData && entryData.element){
      const entryWidth = entryData.element.offsetWidth || 400;
      editor.style.width = `${entryWidth}px`;
    }
  } else {
    // For new entries, let it expand naturally
    editor.style.width = 'auto';
  }
  
  editor.focus();
  
  // Update width based on content after rendering
  requestAnimationFrame(() => {
    const contentWidth = getWidestLineWidth(editor);
    editor.style.width = `${contentWidth}px`;
  });

  const range = document.createRange();
  const sel = window.getSelection();
  if(text){
    range.selectNodeContents(editor);
    range.collapse(false);
  } else {
    range.setStart(editor, 0);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

async function commitEditor(){
  // Prevent commits during or right after navigation
  if (isNavigating || navigationJustCompleted) {
    console.log('[COMMIT] Blocked - isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    editor.textContent = '';
    editor.style.display = 'none';
    editingEntryId = null;
    return;
  }
  
  console.log('[COMMIT] Processing entry...');
  
  const raw = editor.innerText;
  const trimmedRight = raw.replace(/\s+$/g,'');

  // If editing an existing entry
  if(editingEntryId && editingEntryId !== 'anchor'){
    const entryData = entries.get(editingEntryId);
    if(entryData){
      // If text is empty, delete the entry
      if(!trimmedRight){
        entryData.element.classList.remove('editing');
        entryData.element.remove();
        entries.delete(editingEntryId);
        deleteEntryFromServer(editingEntryId);
        editor.textContent = '';
        editor.style.display = 'none';
        editingEntryId = null;
        return;
      }

      // Extract URLs and process text
      const { processedText, urls } = processTextWithLinks(trimmedRight);

      // Remove existing cards and placeholders
      const existingCards = entryData.element.querySelectorAll('.link-card, .link-card-placeholder');
      existingCards.forEach(card => card.remove());

      // Update entry content
      if(processedText){
        entryData.element.innerHTML = meltify(processedText);
      } else {
        entryData.element.innerHTML = '';
      }
      // Calculate width based on widest line (preserves line structure)
      const contentWidth = getWidestLineWidth(editor);
      entryData.element.style.width = `${contentWidth}px`;
      entryData.element.style.minHeight = `${editor.offsetHeight}px`;
      entryData.text = trimmedRight;

      // Generate and add cards for URLs
      if(urls.length > 0){
        const placeholders = [];
        for(const url of urls){
          const placeholder = createLinkCardPlaceholder(url);
          entryData.element.appendChild(placeholder);
          placeholders.push({ placeholder, url });
        }
        
        // Replace placeholders with actual cards as they're generated
        for(const { placeholder, url } of placeholders){
          const cardData = await generateLinkCard(url);
          if(cardData){
            const card = createLinkCard(cardData);
            placeholder.replaceWith(card);
          } else {
            placeholder.remove();
          }
        }
      }

      // Remove editing class
      entryData.element.classList.remove('editing');
      
      // Save to server
      updateEntryOnServer(entryData);
      
      editor.textContent = '';
      editor.style.display = 'none';
      editingEntryId = null;
      return;
    }
  }

  // Create new entry
  // Extract URLs and process text
  const { processedText, urls } = processTextWithLinks(trimmedRight);

  // Allow entry if there's text OR URLs
  if(!processedText && urls.length === 0){
    editor.textContent = '';
    editor.style.display = 'none';
    editingEntryId = null;
    return;
  }

  // Check for duplicate entry at the same directory level
  const duplicateId = findDuplicateEntry(trimmedRight, currentViewEntryId);
  if (duplicateId) {
    // Don't create duplicate - just clear editor
    editor.textContent = '';
    editor.style.display = 'none';
    editingEntryId = null;
    return;
  }

  const entryId = `entry-${entryIdCounter++}`;
  const entry = document.createElement('div');
  entry.className = 'entry melt';
  entry.id = entryId;

  entry.style.left = `${editorWorldPos.x}px`;
  entry.style.top  = `${editorWorldPos.y}px`;
  // Calculate width based on widest line (preserves line structure)
  const contentWidth = getWidestLineWidth(editor);
  entry.style.width = `${contentWidth}px`;
  entry.style.minHeight = `${editor.offsetHeight}px`;

  // Only render text if there is any
  if(processedText){
    entry.innerHTML = meltify(processedText);
  } else {
    entry.innerHTML = '';
  }
  world.appendChild(entry);

  // Store entry data
  const entryData = {
    id: entryId,
    element: entry,
    text: trimmedRight,
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
  
  // Save to server
  saveEntryToServer(entryData);

  // Generate and add cards for URLs (async, after text is rendered)
  if(urls.length > 0){
    const placeholders = [];
    for(const url of urls){
      const placeholder = createLinkCardPlaceholder(url);
      entry.appendChild(placeholder);
      placeholders.push({ placeholder, url });
    }
    
    // Replace placeholders with actual cards as they're generated
    const allCardData = [];
    for(const { placeholder, url } of placeholders){
      const cardData = await generateLinkCard(url);
      if(cardData){
        const card = createLinkCard(cardData);
        placeholder.replaceWith(card);
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
      entryData.element.classList.remove('editing');
    }
  }
  
  editor.textContent = '';
  editor.style.display = 'none';
  editingEntryId = null;
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

function escapeHtml(s){
  return s
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

// URL detection regex
const urlRegex = /(https?:\/\/[^\s]+)/gi;

function extractUrls(text) {
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

// Generate slug from entry text (limit to 17 characters)
function generateEntrySlug(text) {
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
  card.className = cardData.image ? 'link-card' : 'link-card link-card-no-image';
  card.dataset.url = cardData.url;
  card.dataset.title = cardData.title;
  card.dataset.siteName = cardData.siteName;
  card.dataset.description = cardData.description || '';
  
  const cardContent = `
    ${cardData.image ? `<div class="link-card-image" style="background-image: url('${cardData.image}')"></div>` : ''}
    <div class="link-card-content">
      <div class="link-card-site">${escapeHtml(cardData.siteName)}</div>
      <div class="link-card-title">${escapeHtml(cardData.title)}</div>
      ${cardData.description ? `<div class="link-card-description">${escapeHtml(cardData.description)}</div>` : ''}
    </div>
  `;
  
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
    
    // Regular click: create entry and navigate to it
    const entryText = cardData.url;
    
    // Check for duplicate entry at the same directory level
    const duplicateId = findDuplicateEntry(entryText, currentViewEntryId);
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
    // Allow shift+click to propagate for dragging
    if (!e.shiftKey) {
      e.stopPropagation();
    }
  });
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
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

// Click to type / Drag entries
let clickStart = null;
let isClick = false;
let dragThreshold = 5; // Pixels to move before starting drag
let hasMoved = false;

viewport.addEventListener('mousedown', (e) => {
  if(e.target === editor || editor.contains(e.target)) return;
  // Don't handle clicks on breadcrumb
  if(e.target.closest('#breadcrumb')) return;
  
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
  
  if(entryEl) {
    // Only prepare for drag if Shift is held (for shift+drag to move)
    if(e.shiftKey) {
      e.preventDefault();
      e.stopPropagation(); // Stop event from being handled elsewhere
      draggingEntry = entryEl;
      isClick = false;
      hasMoved = false;
      
      // Set cursor to move for the entry and all its children (including link cards)
      entryEl.style.cursor = 'move';
      const linkCards = entryEl.querySelectorAll('.link-card, .link-card-placeholder');
      linkCards.forEach(card => {
        card.style.cursor = 'move';
      });
      
      // Calculate offset from mouse to entry position in world coordinates
      const entryRect = entryEl.getBoundingClientRect();
      const entryWorldPos = screenToWorld(entryRect.left, entryRect.top);
      const mouseWorldPos = screenToWorld(e.clientX, e.clientY);
      dragOffset.x = mouseWorldPos.x - entryWorldPos.x;
      dragOffset.y = mouseWorldPos.y - entryWorldPos.y;
      
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      
      console.log('[SHIFT+DRAG] Starting drag on entry:', entryEl.id, 'from target:', e.target);
    } else {
      // Regular click - just track for potential click action
      clickStart = { x: e.clientX, y: e.clientY, t: performance.now(), entryEl: entryEl, button: e.button };
    }
  } else {
    // Start panning viewport
    dragging = true;
    viewport.classList.add('dragging');
    last = { x: e.clientX, y: e.clientY };
    clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
});

viewport.addEventListener('mousemove', (e) => {
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
  
  // Normal mode: allow entry dragging
  if(draggingEntry) {
    // Only allow dragging if Shift is still held
    if(!e.shiftKey) {
      // Shift was released, cancel drag and reset cursor
      draggingEntry.style.cursor = '';
      const linkCards = draggingEntry.querySelectorAll('.link-card, .link-card-placeholder');
      linkCards.forEach(card => {
        card.style.cursor = '';
      });
      draggingEntry = null;
      hasMoved = false;
      return;
    }
    
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
      
      draggingEntry.style.left = `${newX}px`;
      draggingEntry.style.top = `${newY}px`;
      
      // Update stored position
      const entryId = draggingEntry.id;
      if(entryId === 'anchor') {
        anchorPos.x = newX;
        anchorPos.y = newY;
      } else {
        const entryData = entries.get(entryId);
        if(entryData) {
          entryData.position = { x: newX, y: newY };
          // Save position change to server (debounce this in production)
          updateEntryOnServer(entryData);
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

window.addEventListener('mouseup', (e) => {
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
          else if (entryEl.id !== 'anchor' && entryEl.id) {
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
        
        // Navigate to entry if it was a click (not a drag) AND shift was NOT held
        // If shift was held, it was a drag attempt, so don't navigate
        if(isClick && !e.shiftKey && draggingEntry.id !== 'anchor' && draggingEntry.id) {
          navigateToEntry(draggingEntry.id);
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
    
    draggingEntry = null;
    clickStart = null;
    hasMoved = false;
  } else if(dragging) {
    dragging = false;
    viewport.classList.remove('dragging');
    
    // Check if it was a click (no movement) - place editor
    // Don't place editor if we're navigating or navigation just completed
    if(clickStart && !isNavigating && !navigationJustCompleted) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;
      if(dist < 6 && dt < 350 && !isClick){
        const w = screenToWorld(e.clientX, e.clientY);
        placeEditorAtWorld(w.x, w.y);
      }
    }
    clickStart = null;
  } else if(clickStart && clickStart.entryEl) {
    // Handle click on entry (not dragging)
    // Skip navigation if this was a right-click (button 2) - let contextmenu handle it
    if(e.button !== 2 && clickStart.button !== 2) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;
      const isClick = (dist < dragThreshold && dt < 350);
      
      if(isClick) {
        const entryEl = clickStart.entryEl;
        
        // Command/Ctrl + click: open link in browser
        if((e.metaKey || e.ctrlKey) && entryEl.id !== 'anchor' && entryEl.id) {
          const entryData = entries.get(entryEl.id);
          if(entryData) {
            const urls = extractUrls(entryData.text);
            if(urls.length > 0) {
              window.open(urls[0], '_blank');
            }
          }
        } 
        // Regular click: navigate to entry (open breadcrumb)
        else if(!e.shiftKey && entryEl.id !== 'anchor' && entryEl.id) {
          navigateToEntry(entryEl.id);
        }
      }
    }
    
    clickStart = null;
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
  if(e.key === 'Enter' && !e.shiftKey){
    // Enter without shift: save entry
    e.preventDefault();
    console.log('[ENTER] Committing editor, isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    commitEditor();
    return;
  }
  // Shift+Enter: allow newline (default behavior)

  if(e.key === 'Escape'){
    e.preventDefault();
    
    // Remove editing class from entry
    if(editingEntryId && editingEntryId !== 'anchor'){
      const entryData = entries.get(editingEntryId);
      if(entryData && entryData.element){
        entryData.element.classList.remove('editing');
      }
    }
    
    editor.textContent = '';
    editor.style.display = 'none';
    editingEntryId = null;
    return;
  }
});

// Helper function to calculate width of widest line (accounting for line breaks)
function getWidestLineWidth(element) {
  const text = element.innerText || element.textContent || '';
  if (!text) return 220;
  
  const lines = text.split('\n');
  if (lines.length === 0) return 220;
  
  // Create a temporary element to measure each line's width
  const temp = document.createElement('span');
  temp.style.position = 'absolute';
  temp.style.visibility = 'hidden';
  temp.style.whiteSpace = 'pre';
  temp.style.font = window.getComputedStyle(element).font;
  temp.style.fontSize = window.getComputedStyle(element).fontSize;
  temp.style.fontFamily = window.getComputedStyle(element).fontFamily;
  document.body.appendChild(temp);
  
  let maxWidth = 0;
  for (const line of lines) {
    temp.textContent = line || ' '; // Use space for empty lines
    const width = temp.offsetWidth;
    if (width > maxWidth) {
      maxWidth = width;
    }
  }
  
  document.body.removeChild(temp);
  return Math.max(maxWidth, 220); // min 220px
}

// Update editor width as content changes (for sticky-note-like behavior)
editor.addEventListener('input', () => {
  // Calculate width based on widest line (preserves line structure)
  const contentWidth = getWidestLineWidth(editor);
  editor.style.width = `${contentWidth}px`;
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

// Right-click to edit entry (only if not read-only)
viewport.addEventListener('contextmenu', (e) => {
  if(e.target === editor || editor.contains(e.target)) return;
  if(isReadOnly) return; // Disable editing in read-only mode
  
  const entryEl = findEntryElement(e.target);
  
  // Don't edit if clicking on a link card (handled by card's contextmenu)
  if(e.target.closest('.link-card')) return;
  
  if(entryEl && entryEl.id !== 'anchor' && entryEl.id){
    e.preventDefault();
    e.stopPropagation();
    
    const entryData = entries.get(entryEl.id);
    if(entryData){
      const rect = entryEl.getBoundingClientRect();
      const worldPos = screenToWorld(rect.left, rect.top);
      placeEditorAtWorld(worldPos.x, worldPos.y, entryData.text, entryEl.id);
    }
  }
});

requestAnimationFrame(() => {
  centerAnchor();
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
            const entrySlug = e.text && (typeof e.text === 'string') 
              ? generateEntrySlug(e.text)
              : '';
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
      }
    }
  }
});

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
}

// Keyboard shortcut: Command/Ctrl+Shift+1 to navigate to home page
window.addEventListener('keydown', (e) => {
  // Command+Shift+1 (Mac) or Ctrl+Shift+1 (Windows/Linux)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') {
    e.preventDefault();
    navigateToRoot();
  }
});

bootstrap();