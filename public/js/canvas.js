// canvas.js — Canvas interaction: pan, zoom, click, drag, resize, and event listeners

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
  img.src = imageUrl;
  img.dataset.fullSrc = imageUrl;
  img.alt = 'Canvas image';
  img.draggable = false;
  img.decoding = 'async';
  img.onload = () => updateEntryDimensions(entry);
  img.onerror = () => updateEntryDimensions(entry);
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

// ——— Two-finger touch: pan + pinch-to-zoom ———
let touchState = { active: false, lastX: 0, lastY: 0, lastDist: 0 };

viewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t0 = e.touches[0], t1 = e.touches[1];
    touchState.active = true;
    touchState.lastX = (t0.clientX + t1.clientX) / 2;
    touchState.lastY = (t0.clientY + t1.clientY) / 2;
    touchState.lastDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  if (!touchState.active || e.touches.length !== 2) return;
  e.preventDefault();

  const t0 = e.touches[0], t1 = e.touches[1];
  const midX = (t0.clientX + t1.clientX) / 2;
  const midY = (t0.clientY + t1.clientY) / 2;
  const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

  // Pan: delta of midpoint
  const dx = midX - touchState.lastX;
  const dy = midY - touchState.lastY;
  cam.x += dx;
  cam.y += dy;

  // Pinch zoom centered on midpoint
  if (touchState.lastDist > 0) {
    const ratio = dist / touchState.lastDist;
    const before = screenToWorld(midX, midY);
    cam.z = clamp(cam.z * ratio, 0.12, 8);
    const after = screenToWorld(midX, midY);
    cam.x += (after.x - before.x) * cam.z;
    cam.y += (after.y - before.y) * cam.z;
  }

  touchState.lastX = midX;
  touchState.lastY = midY;
  touchState.lastDist = dist;

  applyTransform();
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    touchState.active = false;
  }
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
    // Capture editingEntryId at blur time to detect if commitEditor already ran
    const entryIdAtBlur = editingEntryId;
    setTimeout(() => {
      const active = document.activeElement;
      const focusInFormatBar = formatBar && formatBar.contains(active);
      // Skip if commitEditor already ran (e.g. from ENTER key) - detected by editingEntryId changing or isCommitting still active
      if (isCommitting) return;
      // If we were editing an entry at blur time but editingEntryId is now null, commitEditor already handled it
      if (entryIdAtBlur && !editingEntryId) return;
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
