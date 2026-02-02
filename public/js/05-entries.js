/**
 * Entry Persistence
 * Saving, updating, and deleting entries on the server
 */

// Save entry to server (create new)
async function saveEntryToServer(entryData) {
  if (!currentUser) {
    console.log('[SAVE] Not saving - no current user');
    return;
  }

  console.log('[SAVE] Saving entry to server:', entryData.id);

  try {
    const payload = {
      id: entryData.id,
      text: entryData.text || '',
      positionX: entryData.position?.x ?? 0,
      positionY: entryData.position?.y ?? 0,
      parentEntryId: entryData.parentEntryId || null,
      linkCardsData: entryData.linkCardsData || null,
      mediaCardData: entryData.mediaCardData || null
    };

    const res = await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[SAVE] Server error:', err);
      throw new Error(err.error || 'Failed to save entry');
    }

    const data = await res.json();
    console.log('[SAVE] Entry saved successfully:', data);
    return data;
  } catch (err) {
    console.error('[SAVE] Error saving entry:', err);
    throw err;
  }
}

// Update entry on server
async function updateEntryOnServer(entryData) {
  if (!currentUser) {
    console.log('[UPDATE] Not updating - no current user');
    return;
  }

  console.log('[UPDATE] Updating entry on server:', entryData.id);

  try {
    const payload = {
      text: entryData.text || '',
      positionX: entryData.position?.x ?? 0,
      positionY: entryData.position?.y ?? 0,
      parentEntryId: entryData.parentEntryId || null,
      linkCardsData: entryData.linkCardsData || null,
      mediaCardData: entryData.mediaCardData || null
    };

    const res = await fetch(`/api/entries/${entryData.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[UPDATE] Server error:', err);
      throw new Error(err.error || 'Failed to update entry');
    }

    const data = await res.json();
    console.log('[UPDATE] Entry updated successfully:', data);
    return data;
  } catch (err) {
    console.error('[UPDATE] Error updating entry:', err);
    throw err;
  }
}

// Delete entry from server
async function deleteEntryFromServer(entryId) {
  if (!currentUser) {
    console.log('[DELETE] Not deleting - no current user');
    return;
  }

  console.log('[DELETE] Deleting entry from server:', entryId);

  try {
    const res = await fetch(`/api/entries/${entryId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[DELETE] Server error:', err);
      throw new Error(err.error || 'Failed to delete entry');
    }

    console.log('[DELETE] Entry deleted successfully');
    return true;
  } catch (err) {
    console.error('[DELETE] Error deleting entry:', err);
    throw err;
  }
}

// Show delete confirmation modal
function showDeleteConfirmation(entryId, childCount = 0) {
  return new Promise((resolve) => {
    const modal = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('delete-confirm-cancel');
    const deleteBtn = document.getElementById('delete-confirm-delete');
    const messageEl = modal?.querySelector('p');

    if (!modal || !cancelBtn || !deleteBtn) {
      resolve(true); // Fallback: proceed without confirmation
      return;
    }

    // Update message based on child count
    if (messageEl) {
      if (childCount > 0) {
        messageEl.innerHTML = `This will delete the entry and <strong>${childCount} nested ${childCount === 1 ? 'entry' : 'entries'}</strong>. This cannot be undone.`;
      } else {
        messageEl.textContent = 'Are you sure you want to delete this entry? This cannot be undone.';
      }
    }

    // Show modal
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', handleCancel);
      deleteBtn.removeEventListener('click', handleDelete);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const handleDelete = () => {
      cleanup();
      resolve(true);
    };

    cancelBtn.addEventListener('click', handleCancel);
    deleteBtn.addEventListener('click', handleDelete);
  });
}

// Delete entry with confirmation (handles children recursively)
async function deleteEntryWithConfirmation(entryId, skipConfirmation = false, skipUndo = false) {
  const entryData = entries.get(entryId);
  if (!entryData) return;

  // Check for children
  const children = Array.from(entries.values()).filter(e => e.parentEntryId === entryId);
  const totalChildCount = countAllDescendants(entryId);

  // Show confirmation if has children and not skipping
  if (!skipConfirmation && totalChildCount > 0) {
    const confirmed = await showDeleteConfirmation(entryId, totalChildCount);
    if (!confirmed) return;
  }

  // Collect entries for undo before deleting
  if (!skipUndo) {
    const entriesToDelete = collectDescendantsForUndo(entryId);
    saveUndoState('delete', { entries: entriesToDelete });
  }

  // Delete children first (recursive)
  for (const child of children) {
    await deleteEntryWithConfirmation(child.id, true, true); // Skip confirmation and undo for children
  }

  // Delete from server
  await deleteEntryFromServer(entryId);

  // Remove from DOM
  if (entryData.element && entryData.element.parentNode) {
    entryData.element.remove();
  }

  // Remove from entries map
  entries.delete(entryId);

  // Update visibility
  updateEntryVisibility();
}

// Count all descendants recursively
function countAllDescendants(entryId) {
  let count = 0;
  const children = Array.from(entries.values()).filter(e => e.parentEntryId === entryId);
  for (const child of children) {
    count += 1 + countAllDescendants(child.id);
  }
  return count;
}

// Collect all descendant entries for undo
function collectDescendantsForUndo(entryId) {
  const result = [];
  const entryData = entries.get(entryId);

  if (entryData) {
    result.push({
      id: entryData.id,
      text: entryData.text,
      position: { ...entryData.position },
      parentEntryId: entryData.parentEntryId,
      mediaCardData: entryData.mediaCardData,
      linkCardsData: entryData.linkCardsData
    });

    const children = Array.from(entries.values()).filter(e => e.parentEntryId === entryId);
    for (const child of children) {
      result.push(...collectDescendantsForUndo(child.id));
    }
  }

  return result;
}

// Load entries from server for current user
async function loadEntriesFromServer() {
  if (!currentUser) {
    console.log('[LOAD] Not loading - no current user');
    return [];
  }

  console.log('[LOAD] Loading entries from server');

  try {
    const res = await fetch('/api/entries', {
      method: 'GET',
      credentials: 'include'
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[LOAD] Server error:', err);
      throw new Error(err.error || 'Failed to load entries');
    }

    const data = await res.json();
    console.log('[LOAD] Loaded', data.entries?.length || 0, 'entries');
    return data.entries || [];
  } catch (err) {
    console.error('[LOAD] Error loading entries:', err);
    return [];
  }
}

// Debounced save for position updates during drag
function debouncedSavePosition(entryData) {
  if (entryData.positionSaveTimeout) {
    clearTimeout(entryData.positionSaveTimeout);
  }

  entryData.positionSaveTimeout = setTimeout(() => {
    updateEntryOnServer(entryData).catch(err => {
      console.error('Error in debounced position save:', err);
    });
    entryData.positionSaveTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}
