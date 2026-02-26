// navigation.js — Trench navigation, breadcrumb, and entry visibility

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

  // Rebuild navigator list when entry visibility changes
  if (typeof buildNavigatorList === 'function') {
    buildNavigatorList();
  }
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
