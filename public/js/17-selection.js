/**
 * Selection and Undo
 * Entry selection, multi-select, and undo system
 */

// Clear all selected entries
function clearSelection() {
  selectedEntries.forEach(entryId => {
    const entryData = entries.get(entryId);
    if (entryData && entryData.element) {
      entryData.element.classList.remove('selected');
    }
  });
  selectedEntries.clear();

  if (!isReadOnly && !editingEntryId) {
    showCursorInDefaultPosition();
  }
}

// Select entries within a box
function selectEntriesInBox(minX, minY, maxX, maxY) {
  clearSelection();

  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;

    const entry = entryData.element;
    if (!entry || entry.style.display === 'none') return;

    const rect = entry.getBoundingClientRect();
    const entryTopLeft = screenToWorld(rect.left, rect.top);
    const entryBottomRight = screenToWorld(rect.right, rect.bottom);

    // AABB collision
    const overlaps = !(entryBottomRight.x < minX || entryTopLeft.x > maxX ||
                       entryBottomRight.y < minY || entryTopLeft.y > maxY);

    if (overlaps) {
      selectedEntries.add(entryId);
      entry.classList.add('selected');
    }
  });

  if (selectedEntries.size > 0) {
    hideCursor();
  }
}

// Select only a single entry
function selectOnlyEntry(entryId) {
  clearSelection();
  const entryData = entries.get(entryId);
  if (entryData && entryData.element) {
    selectedEntries.add(entryId);
    entryData.element.classList.add('selected');
    hideCursor();
  }
}

// Toggle entry selection
function toggleEntrySelection(entryId) {
  const entryData = entries.get(entryId);
  if (!entryData || !entryData.element) return;

  if (selectedEntries.has(entryId)) {
    selectedEntries.delete(entryId);
    entryData.element.classList.remove('selected');
  } else {
    selectedEntries.add(entryId);
    entryData.element.classList.add('selected');
  }

  if (selectedEntries.size > 0) {
    hideCursor();
  } else {
    showCursorInDefaultPosition();
  }
}

// Delete selected entries
async function deleteSelectedEntries() {
  if (selectedEntries.size === 0) return;

  // Check for children
  let hasChildren = false;
  let totalChildCount = 0;

  for (const entryId of selectedEntries) {
    const childCount = countChildEntries(entryId);
    if (childCount > 0) {
      hasChildren = true;
      totalChildCount += childCount;
    }
  }

  if (hasChildren) {
    const confirmed = await showDeleteConfirmation(null, totalChildCount);
    if (!confirmed) return;
  }

  // Collect all entries for undo
  const allEntriesToDelete = [];

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

    const children = Array.from(entries.values()).filter(e => e.parentEntryId === entryId);
    for (const child of children) {
      collectAllDescendants(child.id);
    }
  }

  for (const entryId of selectedEntries) {
    collectAllDescendants(entryId);
  }

  saveUndoState('delete', { entries: allEntriesToDelete });

  for (const entryId of selectedEntries) {
    await deleteEntryWithConfirmation(entryId, true, true);
  }

  clearSelection();
}

// Save undo state
function saveUndoState(action, data) {
  undoStack.push({ action, data, timestamp: Date.now() });
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
}

// Perform undo
async function performUndo() {
  if (undoStack.length === 0) return;

  const state = undoStack.pop();
  console.log('[Undo] Restoring state:', state.action);

  switch (state.action) {
    case 'delete':
      // Restore deleted entries
      const sortedEntries = [...state.data.entries].sort((a, b) => {
        if (a.parentEntryId === b.id) return 1;
        if (b.parentEntryId === a.id) return -1;
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
          img.src = entryData.mediaCardData.url;
          img.alt = 'Canvas image';
          img.draggable = false;
          entry.appendChild(img);
        } else {
          const { processedText, urls } = processTextWithLinks(entryData.text);
          if (processedText) {
            entry.innerHTML = meltify(processedText);
          }

          if (entryData.linkCardsData && entryData.linkCardsData.length > 0) {
            entryData.linkCardsData.forEach((cardData) => {
              if (cardData) {
                const card = createLinkCard(cardData);
                entry.appendChild(card);
                updateEntryWidthForLinkCard(entry, card);
              }
            });
          }

          if (entryData.mediaCardData) {
            const card = createMediaCard(entryData.mediaCardData);
            entry.appendChild(card);
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

      updateEntryVisibility();
      break;

    case 'move':
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
      const entryData = entries.get(state.data.entryId);
      if (entryData) {
        await deleteEntryWithConfirmation(state.data.entryId, true);
      }
      break;

    case 'edit':
      const editEntryData = entries.get(state.data.entryId);
      if (editEntryData && editEntryData.element) {
        editEntryData.text = state.data.oldText;
        editEntryData.mediaCardData = state.data.oldMediaCardData;
        editEntryData.linkCardsData = state.data.oldLinkCardsData;

        const existingCards = editEntryData.element.querySelectorAll('.link-card, .link-card-placeholder, .media-card');
        existingCards.forEach(card => card.remove());

        const { processedText, urls } = processTextWithLinks(state.data.oldText);
        if (processedText) {
          editEntryData.element.innerHTML = meltify(processedText);
        } else {
          editEntryData.element.innerHTML = '';
        }

        if (state.data.oldLinkCardsData && state.data.oldLinkCardsData.length > 0) {
          state.data.oldLinkCardsData.forEach((cardData) => {
            if (cardData) {
              const card = createLinkCard(cardData);
              editEntryData.element.appendChild(card);
              updateEntryWidthForLinkCard(editEntryData.element, card);
            }
          });
        }

        if (state.data.oldMediaCardData) {
          const card = createMediaCard(state.data.oldMediaCardData);
          editEntryData.element.appendChild(card);
        }

        updateEntryDimensions(editEntryData.element);
        await updateEntryOnServer(editEntryData);
      }
      break;
  }
}

// Create selection box element
function createSelectionBox() {
  const box = document.createElement('div');
  box.className = 'selection-box';
  viewport.appendChild(box);
  return box;
}

// Update selection box position and size
function updateSelectionBox(startX, startY, endX, endY) {
  if (!selectionBox) return;

  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  selectionBox.style.left = `${minX}px`;
  selectionBox.style.top = `${minY}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

// Remove selection box
function removeSelectionBox() {
  if (selectionBox && selectionBox.parentNode) {
    selectionBox.remove();
  }
  selectionBox = null;
}
