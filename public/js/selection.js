// selection.js — Multi-select, undo/redo, and bulk entry deletion
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
