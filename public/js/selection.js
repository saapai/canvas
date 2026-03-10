// selection.js — Multi-select, undo/redo, and bulk entry deletion
// Selection helper functions

function positionSelectionToolbar() {
  const toolbar = document.getElementById('selection-toolbar');
  if (!toolbar) return;
  if (selectedEntries.size === 0) {
    toolbar.classList.add('hidden');
    return;
  }
  // Find the bounding box of all selected entries in screen coordinates
  let minTop = Infinity, maxRight = -Infinity;
  selectedEntries.forEach(entryId => {
    let el = null;
    if (entryId === 'anchor') {
      el = anchor;
    } else {
      const entryData = entries.get(entryId);
      if (entryData && entryData.element) el = entryData.element;
    }
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.top < minTop) minTop = rect.top;
      if (rect.right > maxRight) maxRight = rect.right;
    }
  });
  if (minTop === Infinity) {
    toolbar.classList.add('hidden');
    return;
  }
  // Position at top-right of bounding box, offset slightly
  toolbar.style.left = `${maxRight + 4}px`;
  toolbar.style.top = `${minTop - 4}px`;
  toolbar.classList.remove('hidden');
}

function clearSelection() {
  selectedEntries.forEach(entryId => {
    if (entryId === 'anchor') {
      anchor.classList.remove('selected');
      return;
    }
    const entryData = entries.get(entryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('selected');
    }
  });
  selectedEntries.clear();
  hideTrashButton();
  if (!editingEntryId && formatBar) {
    formatBar.classList.add('hidden');
  }

  // Invalidate cached dimensions so next selection picks up fresh sizes
  entries.forEach(entryData => {
    delete entryData._cachedWidth;
    delete entryData._cachedHeight;
  });

  // Hide selection toolbar
  positionSelectionToolbar();

  // Show cursor again when selection is cleared (if not in read-only mode and not editing)
  if (!isReadOnly && !editingEntryId) {
    showCursorInDefaultPosition();
  }
}

function showTrashOnlyFormatBar() {
  if (!formatBar) return;
  formatBar.classList.remove('hidden');
  // Hide all children except the trash button and its divider
  formatBar.querySelectorAll('.format-btn, .format-font-size-wrap, .format-divider:not(.format-divider-trash), .template-menu').forEach(el => {
    if (el.id !== 'format-trash') {
      el.style.display = 'none';
    }
  });
  const trashBtn = document.getElementById('format-trash');
  const trashDivider = document.querySelector('.format-divider-trash');
  if (trashBtn) trashBtn.classList.add('visible');
  if (trashDivider) trashDivider.classList.add('visible');
}

function showTrashButton() {
  const trashBtn = document.getElementById('format-trash');
  const trashDivider = document.querySelector('.format-divider-trash');
  if (trashBtn) trashBtn.classList.add('visible');
  if (trashDivider) trashDivider.classList.add('visible');
  if (formatBar) formatBar.classList.remove('hidden');
}

function hideTrashButton() {
  const trashBtn = document.getElementById('format-trash');
  const trashDivider = document.querySelector('.format-divider-trash');
  if (trashBtn) trashBtn.classList.remove('visible');
  if (trashDivider) trashDivider.classList.remove('visible');
}

function resetFormatBar() {
  if (!formatBar) return;
  // Restore visibility of all format bar children
  formatBar.querySelectorAll('.format-btn, .format-font-size-wrap, .format-divider:not(.format-divider-trash), .template-menu').forEach(el => {
    el.style.display = '';
  });
  // Hide trash button (it uses .visible class, not inline style)
  hideTrashButton();
  // Only hide the format bar if not currently editing (editor manages its own visibility)
  if (!editingEntryId) {
    formatBar.classList.add('hidden');
  }
}

function selectEntriesInBox(minX, minY, maxX, maxY) {
  // Compute new selection set using cached positions/dimensions (no layout reads)
  const newSelection = new Set();

  entries.forEach((entryData, entryId) => {
    const entry = entryData.element;
    if (!entry || entry.style.display === 'none') return;
    if (!entryData.position) return;

    // Cache dimensions on first access to avoid reading layout every frame
    if (!entryData._cachedWidth) {
      entryData._cachedWidth = entry.offsetWidth;
      entryData._cachedHeight = entry.offsetHeight;
    }

    // Use stored world-coordinate position + cached dimensions for hit testing
    const ex = entryData.position.x;
    const ey = entryData.position.y;
    const ew = entryData._cachedWidth;
    const eh = entryData._cachedHeight;

    // AABB overlap check in world coordinates
    const overlaps = !(ex + ew < minX || ex > maxX ||
                       ey + eh < minY || ey > maxY);

    if (overlaps) {
      newSelection.add(entryId);
    }
  });

  // Include anchor in lasso selection (it's not in the entries Map)
  if (anchor && anchor.style.display !== 'none' && currentViewEntryId === null) {
    const ax = anchorPos.x;
    const ay = anchorPos.y;
    const aw = anchor.offsetWidth || 100;
    const ah = anchor.offsetHeight || 40;
    const anchorOverlaps = !(ax + aw < minX || ax > maxX ||
                             ay + ah < minY || ay > maxY);
    if (anchorOverlaps) {
      newSelection.add('anchor');
    }
  }

  // Diff: remove 'selected' class only from entries that are no longer selected
  selectedEntries.forEach(entryId => {
    if (entryId === 'anchor') {
      if (!newSelection.has('anchor')) anchor.classList.remove('selected');
      return;
    }
    const entryData = entries.get(entryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('selected');
    }
  });

  // Diff: add 'selected' class only to entries that are newly selected
  newSelection.forEach(entryId => {
    if (entryId === 'anchor') {
      if (!selectedEntries.has('anchor')) anchor.classList.add('selected');
      return;
    }
    const entryData = entries.get(entryId);
    if (entryData && entryData.element) {
      entryData.element.classList.add('selected');
    }
  });

  // Replace the selection set
  selectedEntries = newSelection;

  // Hide cursor when entries are selected (no showCursorInDefaultPosition call)
  if (selectedEntries.size > 0) {
    hideCursor();
  }

  positionSelectionToolbar();
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
          img.src = fullUrl;
          img.dataset.fullSrc = fullUrl;
          img.alt = 'Canvas image';
          img.draggable = false;
          img.decoding = 'async';
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
            entry.innerHTML = `<span>${meltify(processedText)}</span>`;
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
        if (editEntryData.textHtml && editEntryData.textHtml.includes('deadline-table')) {
          editEntryData.element.innerHTML = editEntryData.textHtml;
        } else if (editEntryData.textHtml && editEntryData.textHtml.includes('gcal-card')) {
          editEntryData.element.innerHTML = editEntryData.textHtml;
          const card = editEntryData.element.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        } else if (processedText) {
          editEntryData.element.innerHTML = `<span>${meltify(processedText)}</span>`;
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
  console.log('[DELETE-SELECTED] called, selectedEntries.size:', selectedEntries.size);
  if (selectedEntries.size === 0) { console.log('[DELETE-SELECTED] No entries selected, returning'); return; }

  // Handle anchor deletion — hide it and persist state
  if (selectedEntries.has('anchor')) {
    anchor.style.display = 'none';
    anchor.classList.remove('selected');
    selectedEntries.delete('anchor');
    const username = window.PAGE_USERNAME || (currentUser && currentUser.username);
    if (username) {
      localStorage.setItem('anchorDeleted_' + username, 'true');
    }
    if (selectedEntries.size === 0) {
      clearSelection();
      return;
    }
  }

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

  // Batch UI removal: remove ALL entries (selected + descendants) from DOM and Map at once
  for (const entryState of allEntriesToDelete) {
    const entryData = entries.get(entryState.id);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('editing', 'deadline-editing');
      entryData.element.remove();
    }
    entries.delete(entryState.id);
  }

  // Fire all server delete calls in parallel
  await Promise.all(allEntriesToDelete.map(e => deleteEntryFromServer(e.id)));

  clearSelection();
}

// Handle typing without clicking - start typing at hover position if editor is in idle mode
window.addEventListener('keydown', (e) => {
  // Only handle if editor is in idle mode (showing cursor but not actively editing) and we're in edit mode
  // Also check that the event target is not the editor (to avoid double-handling)
  // Skip if focus is in any input, textarea, select, or contenteditable outside the canvas editor
  const activeEl = document.activeElement;
  const isInFormField = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || (activeEl.isContentEditable && activeEl !== editor));
  if (isInFormField) return;
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
  // Skip canvas shortcuts if focus is in any form field (input, textarea, select, or non-editor contenteditable)
  const _activeEl = document.activeElement;
  const _isInFormField = _activeEl && (_activeEl.tagName === 'INPUT' || _activeEl.tagName === 'TEXTAREA' || _activeEl.tagName === 'SELECT' || (_activeEl.isContentEditable && _activeEl !== editor));

  // Command+Z / Ctrl+Z for undo — when editor focused, let browser handle (typing, formatting)
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    if (document.activeElement === editor || _isInFormField) return;
    e.preventDefault();
    await performUndo();
    return;
  }
  // Command+Shift+Z / Ctrl+Y for redo — when editor focused, let browser handle
  if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') || ((e.metaKey || e.ctrlKey) && e.key === 'y')) {
    if (document.activeElement === editor || _isInFormField) return;
  }

  // Delete key for selected entries
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedEntries.size > 0 && document.activeElement !== editor && !_isInFormField) {
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

// Wire selection toolbar delete button
document.addEventListener('DOMContentLoaded', () => {
  const selDeleteBtn = document.getElementById('selection-delete-btn');
  if (selDeleteBtn) {
    selDeleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSelectedEntries();
    });
  }
});
