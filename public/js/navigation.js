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

  // Show anchor only on home page (when currentViewEntryId is null) and not deleted
  if (anchor) {
    const _anchorUsername = window.PAGE_USERNAME || (currentUser && currentUser.username);
    const anchorIsDeleted = _anchorUsername && localStorage.getItem('anchorDeleted_' + _anchorUsername) === 'true';
    if (currentViewEntryId === null && !anchorIsDeleted) {
      anchor.style.display = '';
      // During navigation, hide anchor until camera is repositioned
      if (isNavigating) {
        anchor.classList.add('nav-entering');
      }
    } else {
      anchor.style.display = 'none';
      anchor.classList.remove('nav-entering', 'nav-leaving');
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
      // During navigation, hide entries until camera is repositioned
      if (isNavigating) {
        entryData.element.classList.add('nav-entering');
      }
    } else {
      hiddenCount++;
      entryData.element.classList.remove('nav-entering', 'nav-leaving');
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

// Add .nav-leaving to all currently visible entries and anchor to trigger fade-out
function fadeOutVisibleEntries() {
  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;
    if (entryData && entryData.element && entryData.element.style.display !== 'none') {
      entryData.element.classList.add('nav-leaving');
    }
  });
  if (anchor && anchor.style.display !== 'none') {
    anchor.classList.add('nav-leaving');
  }
}

function navigateToEntry(entryId) {
  const entryData = entries.get(entryId);
  if (!entryData) return;

  isNavigating = true;

  // Hide and blur editor to prevent paste behavior
  if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
    hideCursor();
    editor.blur();
  }
  if (editingEntryId && editingEntryId !== 'anchor') {
    const editData = entries.get(editingEntryId);
    if (editData && editData.element) {
      editData.element.classList.remove('editing', 'deadline-editing');
    }
    editingEntryId = null;
  }

  // Phase 1: Fade out all currently visible entries
  fadeOutVisibleEntries();

  // Phase 2: After fade-out completes, snap camera and show new entries
  setTimeout(() => {
    // Get current username from page context or current user
    const pageUsername = window.PAGE_USERNAME;
    const username = pageUsername || (currentUser && currentUser.username);

    // Navigate locally with URL path update
    navigationStack.push(entryId);
    currentViewEntryId = entryId;
    updateBreadcrumb();
    updateEntryVisibility();
    updateSmsManageButton();

    // Load per-page background
    if (window._loadPageBg) window._loadPageBg(entryId);

    // Recalculate dimensions for all visible entries after navigation
    setTimeout(() => {
      entries.forEach((data, id) => {
        if (id === 'anchor') return;
        const entry = data.element;
        if (entry && entry.style.display !== 'none') {
          updateEntryDimensions(entry);
        }
      });

      // Zoom to fit all visible entries (instant snap, then revealNavEntries fades in)
      requestAnimationFrame(() => {
        zoomToFitEntries({ instant: true });
      });
    }, 100);

    // Reset navigation flag - will be cleared by zoomToFitEntries animation completion
    navigationJustCompleted = true;
    console.log('[NAV] Set navigationJustCompleted = true for navigateToEntry');

    // Safety fallback for isNavigating
    setTimeout(() => {
      console.log('[NAV] Fallback timeout (1000ms) - isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
      isNavigating = false;
      if (editor.classList.contains('idle-cursor') ||
          (document.activeElement === editor && editor.textContent.trim().length > 0)) {
        // User has placed cursor/editor - keep it visible
      } else if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
        hideCursor();
        editor.blur();
        editingEntryId = null;
      }
      setTimeout(() => {
        if (navigationJustCompleted) {
          navigationJustCompleted = false;
          if (!isReadOnly) {
            console.log('[NAV] Showing cursor from final fallback');
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                showCursorInDefaultPosition();
              });
            });
          }
        }
      }, 1200);
    }, 1000);

    // Update URL if we're on a user page
    if (username && pageUsername) {
      const pathParts = [pageUsername];
      let currentParentId = null;

      navigationStack.forEach(stackEntryId => {
        const stackEntryData = entries.get(stackEntryId);
        if (stackEntryData) {
          let slug = generateEntrySlug(stackEntryData.text, stackEntryData);

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

      window.history.pushState({ entryId, navigationStack: [...navigationStack] }, '', `/${pathParts.join('/')}`);
    }
  }, 150); // Wait for fade-out transition (matches .nav-leaving 0.15s)
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

  // Phase 1: Fade out all currently visible entries
  fadeOutVisibleEntries();

  // Phase 2: After fade-out completes, snap camera and show new entries
  setTimeout(() => {
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
    updateSmsManageButton();

    // Load per-page background (or user-level if at root)
    if (window._loadPageBg) window._loadPageBg(currentViewEntryId);

    // Recalculate dimensions for all visible entries after navigation
    setTimeout(() => {
      entries.forEach((data, id) => {
        if (id === 'anchor') return;
        const entry = data.element;
        if (entry && entry.style.display !== 'none') {
          updateEntryDimensions(entry);
        }
      });

      // Zoom to fit all visible entries (instant snap, then revealNavEntries fades in)
      requestAnimationFrame(() => {
        zoomToFitEntries({ instant: true });
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
        const pathParts = [pageUsername];
        let currentParentId = null;

        navigationStack.forEach(navEntryId => {
          const navEntryData = entries.get(navEntryId);
          if (navEntryData) {
            let slug = generateEntrySlug(navEntryData.text, navEntryData);

            const siblings = Array.from(entries.values()).filter(e =>
              e.parentEntryId === currentParentId && e.id !== navEntryId
            );

            const existingSlugs = siblings.map(e => generateEntrySlug(e.text, e));
            let counter = 1;
            let uniqueSlug = slug;

            while (existingSlugs.includes(uniqueSlug)) {
              counter++;
              uniqueSlug = `${slug}-${counter}`;
            }

            pathParts.push(uniqueSlug);
            currentParentId = navEntryId;
          }
        });
        window.history.pushState({ navigationStack: [...navigationStack] }, '', `/${pathParts.join('/')}`);
      }
    }

    // Safety fallback for isNavigating
    setTimeout(() => {
      isNavigating = false;
      if (editor.classList.contains('idle-cursor') ||
          (document.activeElement === editor && editor.textContent.trim().length > 0)) {
        // User has placed cursor/editor - keep it visible
      } else if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
        hideCursor();
        editor.blur();
        editingEntryId = null;
      }
      setTimeout(() => {
        if (navigationJustCompleted) {
          navigationJustCompleted = false;
          if (!isReadOnly) {
            showCursorInDefaultPosition();
          }
        }
      }, 500);
    }, 1000);
  }, 150); // Wait for fade-out transition (matches .nav-leaving 0.15s)
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

  // Phase 1: Fade out all currently visible entries
  fadeOutVisibleEntries();

  // Phase 2: After fade-out completes, snap camera and show new entries
  setTimeout(() => {
    navigationStack = [];
    currentViewEntryId = null;
    updateBreadcrumb();
    updateEntryVisibility();
    updateSmsManageButton();

    // Load user-level background (root page)
    if (window._loadPageBg) window._loadPageBg(null);

    // Don't recenter anchor — let zoomToFitEntries handle camera positioning
    // The anchor keeps its stored world position (anchorPos.x, anchorPos.y)

    // Recalculate dimensions for all visible entries after navigation
    setTimeout(() => {
      entries.forEach((data, id) => {
        if (id === 'anchor') return;
        const entry = data.element;
        if (entry && entry.style.display !== 'none') {
          updateEntryDimensions(entry);
        }
      });

      // Zoom to fit all visible entries (instant snap, then revealNavEntries fades in)
      requestAnimationFrame(() => {
        zoomToFitEntries({ instant: true });
      });
    }, 100);

    // Update URL to root user page
    const pageUsername = window.PAGE_USERNAME;
    if (pageUsername) {
      window.history.pushState({ navigationStack: [] }, '', `/${pageUsername}`);
    }

    // Reset navigation flag
    navigationJustCompleted = true;

    // Safety fallback for isNavigating
    setTimeout(() => {
      isNavigating = false;
      if (!editor.classList.contains('idle-cursor') && document.activeElement === editor) {
        hideCursor();
        editor.blur();
        editingEntryId = null;
      }
      setTimeout(() => {
        if (navigationJustCompleted) {
          navigationJustCompleted = false;
        }
      }, 500);
    }, 1000);
  }, 150); // Wait for fade-out transition (matches .nav-leaving 0.15s)
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
