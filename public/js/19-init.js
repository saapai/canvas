/**
 * Initialization
 * Bootstrap function and application startup
 */

// Render entries from server data
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
  console.log('[BOOT] Starting bootstrap...');

  // Check authentication
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include'
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      console.log('[BOOT] Authenticated as:', currentUser.username);

      // Check if viewing another user's canvas
      const path = window.location.pathname;
      const pathParts = path.split('/').filter(Boolean);

      if (pathParts.length > 0) {
        const viewingUsername = pathParts[0];
        if (viewingUsername !== currentUser.username) {
          // Viewing someone else's canvas - read-only mode
          isReadOnly = true;
          console.log('[BOOT] Read-only mode for:', viewingUsername);

          // Load that user's entries
          const viewRes = await fetch(`/api/entries?username=${viewingUsername}`, {
            method: 'GET',
            credentials: 'include'
          });

          if (viewRes.ok) {
            const viewData = await viewRes.json();
            renderEntries(viewData.entries || []);
          }
        } else {
          // Viewing own canvas
          const serverEntries = await loadEntriesFromServer();
          renderEntries(serverEntries);
        }
      } else {
        // At root - redirect to user's canvas
        window.location.href = '/' + currentUser.username;
        return;
      }

      // Update user menu
      const userNameEl = document.querySelector('.user-name');
      if (userNameEl && currentUser.username) {
        userNameEl.textContent = currentUser.username;
      }
    } else {
      // Not authenticated
      console.log('[BOOT] Not authenticated');

      const path = window.location.pathname;
      const pathParts = path.split('/').filter(Boolean);

      if (pathParts.length > 0) {
        // Viewing a public canvas
        const viewingUsername = pathParts[0];
        isReadOnly = true;
        console.log('[BOOT] Public view for:', viewingUsername);

        const viewRes = await fetch(`/api/entries?username=${viewingUsername}`, {
          method: 'GET'
        });

        if (viewRes.ok) {
          const viewData = await viewRes.json();
          renderEntries(viewData.entries || []);
        }
      } else {
        // At root - show auth overlay
        showAuthOverlay();
      }
    }
  } catch (err) {
    console.error('[BOOT] Auth check failed:', err);
    showAuthOverlay();
  }

  // Initialize all listeners
  initAuthListeners();
  initEventListeners();
  initChatListeners();
  initSpacesListeners();
  initAutocompleteToggle();
  initImageDropListeners();
  initHelpModal();

  // Parse URL and navigate if needed
  if (!isReadOnly && currentUser) {
    await parseUrlAndNavigate();
  }

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
  if (!currentUser && userMenu) {
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
