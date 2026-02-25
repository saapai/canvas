// entries.js — Entry loading, saving, deleting, and bootstrap initialization
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
        img.src = fullUrl;
        img.dataset.fullSrc = fullUrl;
        img.alt = 'Canvas image';
        img.draggable = false;
        img.loading = 'lazy';
        img.decoding = 'async';
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
