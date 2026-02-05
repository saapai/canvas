/**
 * Initialization
 * Bootstrap function and application startup
 */

// Load entries for a specific user (public or owner view)
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

      // Initially hide all entries - visibility will be set after navigation state is determined
      entry.style.display = 'none';

      // Process text with links (skip for image-only entries)
      const isImageOnly = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
      if (isImageOnly) {
        entry.classList.add('canvas-image');
        entry.innerHTML = '';
        const img = document.createElement('img');
        img.src = entryData.mediaCardData.url;
        img.alt = 'Canvas image';
        img.draggable = false;
        entry.appendChild(img);
      } else {
        const { processedText, urls } = processTextWithLinks(entryData.text);
        if (processedText) {
          if (entryData.textHtml && /<(strong|b|em|i|u)>/i.test(entryData.textHtml)) {
            entry.innerHTML = typeof meltifyHtml === 'function' ? meltifyHtml(entryData.textHtml) : meltify(processedText);
          } else {
            entry.innerHTML = meltify(processedText);
          }
        } else {
          entry.innerHTML = '';
        }

        // Add link cards
        if (urls.length > 0) {
          const cachedLinkCardsData = entryData.linkCardsData || [];
          urls.forEach((url, index) => {
            const cachedCardData = cachedLinkCardsData[index];
            if (cachedCardData) {
              const card = createLinkCard(cachedCardData);
              entry.appendChild(card);
              updateEntryWidthForLinkCard(entry, card);
            } else if (typeof createLinkCardPlaceholder === 'function') {
              const placeholder = createLinkCardPlaceholder(url);
              entry.appendChild(placeholder);
              if (typeof generateLinkCard === 'function') {
                generateLinkCard(url).then(cardData => {
                  if (cardData) {
                    const card = createLinkCard(cardData);
                    placeholder.replaceWith(card);
                    updateEntryWidthForLinkCard(entry, card);
                  } else {
                    placeholder.remove();
                  }
                });
              }
            }
          });
        }
      }

      if (!editable) {
        entry.style.cursor = 'pointer';
      }

      world.appendChild(entry);
      updateEntryDimensions(entry);

      const storedEntryData = {
        id: entryData.id,
        element: entry,
        text: entryData.text,
        textHtml: entryData.textHtml,
        position: entryData.position,
        parentEntryId: entryData.parentEntryId,
        linkCardsData: entryData.linkCardsData || [],
        mediaCardData: entryData.mediaCardData || null
      };
      entries.set(entryData.id, storedEntryData);

      // Add media card if present (and not an image)
      if (!isImageOnly && entryData.mediaCardData && entryData.mediaCardData.type !== 'image') {
        const card = createMediaCard(entryData.mediaCardData);
        entry.appendChild(card);
        setTimeout(() => updateEntryDimensions(entry), 100);
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

    // Recalculate dimensions for all existing entries
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
      setTimeout(() => {
        zoomToFitEntries();
      }, 200);
    }

  } catch (error) {
    console.error('Error loading user entries:', error);
  }
}

// Render entries from server data (for authenticated user's own entries)
function renderEntries(serverEntries) {
  serverEntries.forEach(e => {
    const entry = document.createElement('div');
    entry.id = e.id;

    const isImage = e.mediaCardData && e.mediaCardData.type === 'image';

    if (isImage) {
      entry.className = 'entry canvas-image';
      const img = document.createElement('img');
      img.src = e.mediaCardData.url;
      img.alt = 'Canvas image';
      img.draggable = false;
      entry.appendChild(img);
    } else {
      entry.className = 'entry';

      const { processedText, urls } = processTextWithLinks(e.text || '');
      if (processedText) {
        entry.innerHTML = meltify(processedText);
      }

      // Add link cards
      if (e.linkCardsData && e.linkCardsData.length > 0) {
        e.linkCardsData.forEach(cardData => {
          if (cardData) {
            const card = createLinkCard(cardData);
            entry.appendChild(card);
            updateEntryWidthForLinkCard(entry, card);
          }
        });
      }

      // Add media card
      if (e.mediaCardData && !isImage) {
        const card = createMediaCard(e.mediaCardData);
        entry.appendChild(card);
      }
    }

    entry.style.left = `${e.positionX || 0}px`;
    entry.style.top = `${e.positionY || 0}px`;

    world.appendChild(entry);

    // Store entry data
    const entryData = {
      id: e.id,
      element: entry,
      text: e.text || '',
      position: { x: e.positionX || 0, y: e.positionY || 0 },
      parentEntryId: e.parentEntryId || null,
      linkCardsData: e.linkCardsData || [],
      mediaCardData: e.mediaCardData || null
    };

    entries.set(e.id, entryData);
    entryIdCounter = Math.max(entryIdCounter, parseInt(e.id.split('-').pop()) + 1 || entryIdCounter);

    updateEntryDimensions(entry);
  });

  updateEntryVisibility();
}

// Bootstrap function - main entry point
async function bootstrap() {
  // Check if we're on a user page FIRST, before anything else runs
  const pageUsername = window.PAGE_USERNAME;
  const isOwner = window.PAGE_IS_OWNER === true;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const isUserPage = !!pageUsername || (pathParts.length > 0 && pathParts[0] !== 'index.html' && pathParts[0] !== '');
  const isLoginPage = window.SHOW_LOGIN_PAGE === true;

  console.log('[BOOT] Starting bootstrap...', { pageUsername, isOwner, isUserPage, isLoginPage });

  // CRITICAL: Hide auth overlay IMMEDIATELY if on a user page - do this BEFORE initAuthUI
  if (isUserPage && authOverlay) {
    authOverlay.classList.add('hidden');
    authOverlay.style.display = 'none'; // Force hide with inline style
  }

  // Only initialize auth UI if NOT on a user page
  if (!isUserPage) {
    initAuthListeners();
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
      console.log('[BOOT] Authenticated as:', currentUser.username);

      // If on root and logged in, redirect to their page
      if (!isUserPage && user.username) {
        window.location.href = `/${user.username}`;
        return;
      }
    } else {
      console.log('[BOOT] Not authenticated');
    }

    // If on a user page, load entries (editable if owner, read-only otherwise)
    if (isUserPage) {
      const targetUsername = pageUsername || decodeURIComponent(pathParts[0] || '');
      // Only editable if logged in AND is the owner
      const editable = isLoggedIn && isOwner;
      console.log('[BOOT] Loading entries for:', targetUsername, 'editable:', editable);
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
    console.error('[BOOT] Error checking auth:', error);
    if (isUserPage) {
      // On user page - load public entries (read-only) even if auth check fails
      const targetUsername = pageUsername || pathParts[0];
      console.log('[BOOT] Loading public entries for:', targetUsername);
      await loadUserEntries(targetUsername, false);
      // Ensure auth overlay stays hidden
      hideAuthOverlay();
    } else {
      // On root - show auth
      showAuthOverlay();
    }
  }

  // Initialize all listeners (only after initial load)
  initEventListeners();
  initChatListeners();
  initSpacesListeners();
  initAutocompleteToggle();
  initImageDropListeners();
  initHelpModal();

  // Initial camera setup
  if (!hasZoomedToFit) {
    zoomToFitEntries();
    hasZoomedToFit = true;
  }

  // Show cursor if not read-only
  if (!isReadOnly) {
    showCursorInDefaultPosition();
  }

  // Hide user menu if not logged in
  if (!currentUser && typeof userMenu !== 'undefined' && userMenu) {
    userMenu.style.display = 'none';
  }

  console.log('[BOOT] Bootstrap complete');
}

// Initialize help modal
function initHelpModal() {
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
}

// Editor keydown handler (for autocomplete and special keys)
function initEditorKeydown() {
  editor.addEventListener('keydown', (e) => {
    // Autocomplete keyboard navigation
    if (autocomplete && !autocomplete.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteKeyboardNavigation = true;
        autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, autocompleteResults.length - 1);
        updateAutocompleteSelection();
        const selectedItem = autocomplete.querySelector(`[data-index="${autocompleteSelectedIndex}"]`);
        if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest' });
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteKeyboardNavigation = true;
        autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, -1);
        updateAutocompleteSelection();
        return;
      } else if (e.key === 'Enter' && autocompleteSelectedIndex >= 0 && !e.shiftKey && autocompleteKeyboardNavigation) {
        e.preventDefault();
        selectAutocompleteResult(autocompleteResults[autocompleteSelectedIndex]);
        return;
      } else if (e.key === 'Escape') {
        hideAutocomplete();
        return;
      }
    }

    // Cmd+B for bold
    if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('bold', false, null);
      return;
    }

    // Cmd+Shift+1 to navigate home
    const isOneKey = e.key === '1' || e.key === 'Digit1' || e.code === 'Digit1';
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && isOneKey) {
      e.preventDefault();
      e.stopPropagation();
      navigateToRoot();
      return;
    }

    // Handle Enter key
    if (e.key === 'Enter') {
      if (autocomplete && !autocomplete.classList.contains('hidden') && autocompleteSelectedIndex >= 0 && autocompleteKeyboardNavigation) {
        return;
      }

      clearTimeout(autocompleteSearchTimeout);
      hideAutocomplete();
      autocompleteIsShowing = false;

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        commitEditor();
        return;
      }

      if (e.shiftKey) {
        return; // Allow newline
      }

      // Check if on bullet line
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const fullText = editor.innerText || editor.textContent || '';
        const range = selection.getRangeAt(0);
        let cursorPos = 0;

        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
          let node;
          while (node = walker.nextNode()) {
            if (node === range.startContainer) {
              cursorPos += range.startOffset;
              break;
            }
            cursorPos += node.textContent.length;
          }
        } else {
          cursorPos = fullText.length;
        }

        let lineStart = 0;
        for (let i = cursorPos - 1; i >= 0; i--) {
          if (fullText[i] === '\n') {
            lineStart = i + 1;
            break;
          }
        }

        const lineEnd = fullText.indexOf('\n', cursorPos);
        const lineText = fullText.substring(lineStart, lineEnd >= 0 ? lineEnd : fullText.length);

        if (lineText.trim().startsWith('\u2022')) {
          e.preventDefault();
          const beforeText = fullText.substring(0, cursorPos);
          const afterText = fullText.substring(cursorPos);
          editor.textContent = beforeText + '\n\u2022 ' + afterText;

          const newCursorPos = cursorPos + 3;
          setTimeout(() => {
            const newRange = document.createRange();
            const sel = window.getSelection();
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
            let node;
            let pos = 0;
            while (node = walker.nextNode()) {
              const nodeLength = node.textContent.length;
              if (pos + nodeLength >= newCursorPos) {
                newRange.setStart(node, newCursorPos - pos);
                newRange.setEnd(node, newCursorPos - pos);
                sel.removeAllRanges();
                sel.addRange(newRange);
                return;
              }
              pos += nodeLength;
            }
          }, 0);

          editor.dispatchEvent(new Event('input'));
          return;
        }
      }

      e.preventDefault();
      commitEditor();
      return;
    }

    // Escape key
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editingEntryId && editingEntryId !== 'anchor') {
        const entryData = entries.get(editingEntryId);
        if (entryData && entryData.element) {
          entryData.element.classList.remove('editing');
        }
      }
      editingEntryId = null;
      clearEditorAndShowCursor();
    }
  });

  // Editor blur handler
  editor.addEventListener('blur', () => {
    setTimeout(() => {
      if (isSelectingAutocomplete) {
        isSelectingAutocomplete = false;
        return;
      }

      if (isNavigating || navigationJustCompleted) {
        return;
      }

      if (editor.textContent.trim() || editingEntryId) {
        commitEditor();
      }
    }, 100);
  });
}

// Start the application
document.addEventListener('DOMContentLoaded', () => {
  initEditorKeydown();
  bootstrap();
});
