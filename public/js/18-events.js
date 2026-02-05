/**
 * Event Handlers
 * Mouse, keyboard, and other event listeners
 */

// Drag threshold
const dragThreshold = 5;
let clickStart = null;
let isClick = false;
let hasMoved = false;

// Mouse down handler
function handleMouseDown(e) {
  // Track mouse position
  currentMousePos = { x: e.clientX, y: e.clientY };

  // Ignore if in chat panel
  if (isFocusInChatPanel()) return;

  // Check for entry click
  const entryEl = findEntryElement(e.target);

  // Right-click on entry for context menu (edit)
  if (e.button === 2 && entryEl && entryEl.id !== 'anchor') {
    return; // Let contextmenu handler deal with it
  }

  // Shift+click for selection box
  if (e.shiftKey && !entryEl) {
    isSelecting = true;
    selectionStart = { x: e.clientX, y: e.clientY };
    selectionBox = createSelectionBox();
    updateSelectionBox(e.clientX, e.clientY, e.clientX, e.clientY);
    e.preventDefault();
    return;
  }

  // Entry click
  if (entryEl) {
    clickStart = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      entryEl: entryEl,
      button: e.button
    };

    if (e.shiftKey) {
      // Shift+click to toggle selection
      toggleEntrySelection(entryEl.id);
      return;
    }

    // Start dragging entry
    if (entryEl.id !== 'anchor') {
      draggingEntry = entryEl;
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const worldPos = entryData.position || { x: 0, y: 0 };
        const mouseWorld = screenToWorld(e.clientX, e.clientY);
        dragOffset = {
          x: mouseWorld.x - worldPos.x,
          y: mouseWorld.y - worldPos.y
        };

        // Store start positions for undo
        dragStartPositions.clear();
        if (selectedEntries.has(entryEl.id)) {
          selectedEntries.forEach(id => {
            const ed = entries.get(id);
            if (ed) dragStartPositions.set(id, { ...ed.position });
          });
        } else {
          dragStartPositions.set(entryEl.id, { ...worldPos });
        }
      }
      hasMoved = false;
    }

    return;
  }

  // Canvas drag (pan)
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  isClick = false;
}

// Mouse move handler
function handleMouseMove(e) {
  currentMousePos = { x: e.clientX, y: e.clientY };

  // Selection box
  if (isSelecting && selectionStart) {
    updateSelectionBox(selectionStart.x, selectionStart.y, e.clientX, e.clientY);

    // Select entries in box
    const startWorld = screenToWorld(selectionStart.x, selectionStart.y);
    const endWorld = screenToWorld(e.clientX, e.clientY);
    const minX = Math.min(startWorld.x, endWorld.x);
    const minY = Math.min(startWorld.y, endWorld.y);
    const maxX = Math.max(startWorld.x, endWorld.x);
    const maxY = Math.max(startWorld.y, endWorld.y);
    selectEntriesInBox(minX, minY, maxX, maxY);
    return;
  }

  // Entry dragging
  if (draggingEntry) {
    const mouseWorld = screenToWorld(e.clientX, e.clientY);
    const newX = mouseWorld.x - dragOffset.x;
    const newY = mouseWorld.y - dragOffset.y;

    const entryData = entries.get(draggingEntry.id);
    if (entryData) {
      const dx = newX - (entryData.position?.x ?? 0);
      const dy = newY - (entryData.position?.y ?? 0);

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMoved = true;
      }

      // Move entry
      entryData.position = { x: newX, y: newY };
      entryData.element.style.left = `${newX}px`;
      entryData.element.style.top = `${newY}px`;

      // Move selected entries together
      if (selectedEntries.has(draggingEntry.id)) {
        selectedEntries.forEach(id => {
          if (id !== draggingEntry.id) {
            const ed = entries.get(id);
            if (ed) {
              ed.position.x += dx;
              ed.position.y += dy;
              ed.element.style.left = `${ed.position.x}px`;
              ed.element.style.top = `${ed.position.y}px`;
            }
          }
        });
      }
    }
    return;
  }

  // Canvas panning
  if (dragging) {
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      isClick = false;
      viewport.classList.add('dragging');
    }

    cam.x += dx;
    cam.y += dy;
    applyTransform();
    updateCursorPosition();

    last = { x: e.clientX, y: e.clientY };
  }
}

// Mouse up handler
function handleMouseUp(e) {
  // End selection
  if (isSelecting) {
    isSelecting = false;
    removeSelectionBox();
    selectionStart = null;
    return;
  }

  // End entry dragging
  if (draggingEntry) {
    justFinishedDragging = true;
    setTimeout(() => { justFinishedDragging = false; }, 100);

    if (draggingEntry.id !== 'anchor' && hasMoved) {
      const entryData = entries.get(draggingEntry.id);
      if (entryData) {
        // Save undo state
        const moves = [];
        const isEntrySelected = selectedEntries.has(draggingEntry.id);
        const entriesToSave = isEntrySelected
          ? Array.from(selectedEntries).map(id => entries.get(id)).filter(Boolean)
          : [entryData];

        entriesToSave.forEach(ed => {
          const oldPosition = dragStartPositions.get(ed.id);
          if (oldPosition && (oldPosition.x !== ed.position.x || oldPosition.y !== ed.position.y)) {
            moves.push({ entryId: ed.id, oldPosition });
          }
        });

        if (moves.length > 0) {
          saveUndoState('move', { moves });
        }

        // Save positions
        if (entryData.positionSaveTimeout) {
          clearTimeout(entryData.positionSaveTimeout);
        }

        updateEntryOnServer(entryData).catch(err => {
          console.error('Error saving position:', err);
        });

        if (isEntrySelected) {
          selectedEntries.forEach(id => {
            if (id !== draggingEntry.id) {
              const ed = entries.get(id);
              if (ed) {
                updateEntryOnServer(ed).catch(err => {
                  console.error('Error saving position:', err);
                });
              }
            }
          });
        }
      }
    }

    draggingEntry = null;
    clickStart = null;
    hasMoved = false;
    dragStartPositions.clear();
    return;
  }

  // End canvas drag
  if (dragging) {
    dragging = false;
    viewport.classList.remove('dragging');

    // Check if it was a click
    if (clickStart) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;

      if (dist < 6 && dt < 350 && !isClick) {
        // Clear selection if clicking empty space
        if (!e.shiftKey && selectedEntries.size > 0) {
          clearSelection();
        }

        const w = screenToWorld(e.clientX, e.clientY);
        lastClickPos = { x: w.x, y: w.y };
        hasClickedRecently = true;
        cursorPosBeforeEdit = null;

        setTimeout(() => { hasClickedRecently = false; }, 100);

        navigationJustCompleted = false;
        isNavigating = false;

        if (editingEntryId && document.activeElement === editor) {
          // Committing happens via blur
        }

        placeEditorAtWorld(w.x, w.y, '', null, true);

        requestAnimationFrame(() => {
          isProcessingClick = false;
        });
      } else {
        isProcessingClick = false;
      }
    } else {
      isProcessingClick = false;
    }

    clickStart = null;
    return;
  }

  // Click on entry (link/media cards)
  if (clickStart && clickStart.entryEl) {
    if (e.button !== 2 && clickStart.button !== 2) {
      const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
      const dt = performance.now() - clickStart.t;
      const wasClick = (dist < dragThreshold && dt < 350);

      if (wasClick) {
        const entryEl = clickStart.entryEl;

        if (isImageEntry(entryEl)) {
          selectOnlyEntry(entryEl.id);
          clickStart = null;
          return;
        }

        if ((e.metaKey || e.ctrlKey) && entryEl.id !== 'anchor') {
          const entryData = entries.get(entryEl.id);
          if (entryData) {
            const urls = extractUrls(entryData.text);
            if (urls.length > 0) {
              window.open(urls[0], '_blank');
            }
          }
        } else if (entryEl.id !== 'anchor' && !isReadOnly) {
          // Commit current editor (new entry or existing entry) then open clicked entry for edit
          if (editor && (editor.textContent.trim() || editingEntryId)) {
            commitEditor();
          }
          startEditingEntry(entryEl.id);
        }
      }
    }

    clickStart = null;
  }
}

// Double click handler
function handleDoubleClick(e) {
  if (isReadOnly) return;

  if (pendingEditTimeout) {
    clearTimeout(pendingEditTimeout);
    pendingEditTimeout = null;
  }

  const entryEl = findEntryElement(e.target);

  if (e.target.closest('.link-card, .link-card-placeholder, .media-card')) {
    return;
  }

  if (entryEl && entryEl.id !== 'anchor') {
    e.preventDefault();
    e.stopPropagation();
    if (editor && (editor.textContent.trim() || editingEntryId)) {
      commitEditor();
    }
    navigateToEntry(entryEl.id);
  }
}

// Wheel handler (zoom)
function handleWheel(e) {
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
  updateCursorPosition();
}

// Context menu handler
function handleContextMenu(e) {
  if (isReadOnly) return;

  const entryEl = findEntryElement(e.target);
  if (entryEl && entryEl.id !== 'anchor') {
    e.preventDefault();

    // Start editing the entry
    const entryData = entries.get(entryEl.id);
    if (entryData) {
      startEditingEntry(entryEl.id);
    }
  }
}

// Keyboard handler for typing
function handleTypingKeydown(e) {
  // Only when in idle cursor mode
  if (editor.classList.contains('idle-cursor') && !isReadOnly && !isNavigating && !navigationJustCompleted && e.target !== editor) {
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isSpecialStartKey = e.key === 'Backspace' || e.key === 'Delete';

    if (isPrintable || isSpecialStartKey) {
      let targetPos;
      if (lastClickPos && hasClickedRecently) {
        targetPos = lastClickPos;
      } else {
        const w = screenToWorld(currentMousePos.x, currentMousePos.y);
        targetPos = { x: w.x, y: w.y };
      }

      placeEditorAtWorld(targetPos.x, targetPos.y);

      if (isPrintable) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(e.key));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          editor.textContent += e.key;
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }

      e.preventDefault();
      e.stopPropagation();
    }
  }
}

// Keyboard shortcuts handler
async function handleKeyboardShortcuts(e) {
  // Cmd+Z / Ctrl+Z for undo
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    await performUndo();
    return;
  }

  // Delete/Backspace for selected entries
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedEntries.size > 0 && document.activeElement !== editor) {
      e.preventDefault();
      await deleteSelectedEntries();
      return;
    }
  }

  // Cmd+Shift+1 / Ctrl+Shift+1 to go home
  const isOneKey = e.key === '1' || e.key === 'Digit1' || e.code === 'Digit1';
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && isOneKey) {
    e.preventDefault();
    e.stopPropagation();
    navigateToRoot();
  }
}

// Initialize event listeners
function initEventListeners() {
  // Mouse events
  viewport.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  viewport.addEventListener('dblclick', handleDoubleClick);
  viewport.addEventListener('wheel', handleWheel, { passive: false });
  viewport.addEventListener('contextmenu', handleContextMenu);

  // Keyboard events
  window.addEventListener('keydown', handleTypingKeydown, true);
  window.addEventListener('keydown', handleKeyboardShortcuts, true);

  // Track mouse position
  window.addEventListener('mousemove', (e) => {
    currentMousePos = { x: e.clientX, y: e.clientY };
  });

  // Popstate for browser back/forward
  window.addEventListener('popstate', handlePopState);

  // Click outside autocomplete
  document.addEventListener('click', (e) => {
    if (autocomplete && !autocomplete.contains(e.target) && e.target !== editor && !editor.contains(e.target)) {
      hideAutocomplete();
    }
  });

  // Update autocomplete on scroll/resize
  editor.addEventListener('input', () => {
    if (autocomplete && !autocomplete.classList.contains('hidden')) {
      updateAutocompletePosition();
    }
    if (mediaAutocompleteEnabled) {
      handleAutocompleteSearch();
    }
  });

  window.addEventListener('scroll', () => {
    if (autocomplete && !autocomplete.classList.contains('hidden')) {
      updateAutocompletePosition();
    }
  });

  window.addEventListener('resize', () => {
    if (autocomplete && !autocomplete.classList.contains('hidden')) {
      updateAutocompletePosition();
    }
    updateCursorPosition();
  });
}
