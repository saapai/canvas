/**
 * Editor Operations
 * Handles placing the editor, editing entries, and committing text
 */

// Place editor at world position (ready for input)
function placeEditorAtWorld(wx, wy, initialText = '', existingEntryId = null, force = false) {
  if (!editor) return;

  // Don't place during navigation unless forced
  if (!force && (isNavigating || navigationJustCompleted)) {
    console.log('[EDITOR] Skipping place during navigation');
    return;
  }

  // If we're already editing a different entry, commit it first
  if (editingEntryId && editingEntryId !== existingEntryId) {
    commitEditor();
  }

  console.log('[EDITOR] Placing editor at', wx, wy, 'existing:', existingEntryId);

  const screen = worldToScreen(wx, wy);
  editor.style.left = `${screen.x}px`;
  editor.style.top = `${screen.y}px`;
  editor.style.display = 'block';
  editor.classList.remove('idle-cursor');

  if (initialText) {
    editor.textContent = initialText;
    editor.classList.add('has-content');
  } else {
    editor.textContent = '';
    editor.classList.remove('has-content');
  }

  editorWorldPos = { x: wx, y: wy };
  editingEntryId = existingEntryId;

  // If editing existing entry, add editing class to it
  if (existingEntryId) {
    const entryData = entries.get(existingEntryId);
    if (entryData && entryData.element) {
      entryData.element.classList.add('editing');
      updateEntryDimensionsForEdit(entryData.element);
    }
  }

  // Focus editor
  editor.focus();

  // Move cursor to end
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// Update entry dimensions while editing
function updateEntryDimensionsForEdit(element) {
  if (!element) return;

  const text = editor.textContent || '';
  const lines = text.split('\n');
  const lineCount = lines.length || 1;

  // Calculate width based on longest line
  const widestWidth = getWidestLineWidth(editor);
  const minWidth = 60;
  const padding = 48; // 16px left + 32px right

  element.style.width = Math.max(widestWidth + padding, minWidth) + 'px';
  element.style.height = (lineCount * 26 + 16) + 'px'; // line height + padding
}

// Commit editor content (save entry)
function commitEditor() {
  if (isCommitting) return;
  if (!editor) return;

  const text = (editor.textContent || '').trim();

  // If editing existing entry
  if (editingEntryId) {
    const entryData = entries.get(editingEntryId);
    if (entryData) {
      entryData.element.classList.remove('editing');

      if (text === '') {
        // Empty text - delete the entry
        deleteEntryWithConfirmation(editingEntryId, true);
      } else {
        if (text !== entryData.text) {
          // Text changed - save undo state and update
          saveUndoState('edit', {
            entryId: editingEntryId,
            oldText: entryData.text,
            oldMediaCardData: entryData.mediaCardData,
            oldLinkCardsData: entryData.linkCardsData
          });

          // Clear media card if text is now a URL or regular text
          entryData.mediaCardData = null;

          // Update entry
          entryData.text = text;

          // Process text and update DOM
          const { processedText, urls } = processTextWithLinks(text);
          entryData.element.innerHTML = meltify(processedText);

          // Handle link cards
          if (urls.length > 0) {
            handleLinkCardsForEntry(entryData, urls);
          } else {
            entryData.linkCardsData = null;
          }

          // Update dimensions
          updateEntryDimensions(entryData.element);
        }
        // Save to server (whether changed or not, so "save as is" when switching entries)
        updateEntryOnServer(entryData);
      }
    }

    editingEntryId = null;
    clearEditorAndShowCursor();
    return;
  }

  // Creating new entry
  if (text === '') {
    clearEditorAndShowCursor();
    return;
  }

  // Check for duplicate
  const duplicateId = findDuplicateEntry(text, currentViewEntryId);
  if (duplicateId) {
    console.log('[EDITOR] Duplicate entry found, navigating to it');
    navigateToEntry(duplicateId);
    clearEditorAndShowCursor();
    return;
  }

  isCommitting = true;

  // Create new entry
  createNewEntry(text, editorWorldPos);

  isCommitting = false;
  clearEditorAndShowCursor();
}

// Create a new entry
function createNewEntry(text, position) {
  const entryId = generateEntryId();

  const entry = document.createElement('div');
  entry.className = 'entry melt';
  entry.id = entryId;
  entry.style.left = `${position.x}px`;
  entry.style.top = `${position.y}px`;

  // Process text
  const { processedText, urls } = processTextWithLinks(text);
  entry.innerHTML = meltify(processedText);

  world.appendChild(entry);

  // Create entry data
  const entryData = {
    id: entryId,
    element: entry,
    text: text,
    position: { x: position.x, y: position.y },
    parentEntryId: currentViewEntryId,
    linkCardsData: null,
    mediaCardData: null
  };

  entries.set(entryId, entryData);

  // Handle link cards
  if (urls.length > 0) {
    handleLinkCardsForEntry(entryData, urls);
  }

  // Update dimensions
  updateEntryDimensions(entry);

  // Save to server
  saveEntryToServer(entryData);

  // Save undo state
  saveUndoState('create', { entryId: entryId });

  // Update visibility
  updateEntryVisibility();

  return entryData;
}

// Clear editor and show cursor
function clearEditorAndShowCursor() {
  if (!editor) return;

  editor.textContent = '';
  editor.classList.remove('has-content');

  // Show cursor at current position or find new position
  if (editorWorldPos) {
    showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
  } else {
    showCursorInDefaultPosition();
  }
}

// Update entry dimensions after content change
function updateEntryDimensions(element) {
  if (!element) return;

  // Reset any editing dimensions
  element.style.width = '';
  element.style.height = '';
}

// Handle link cards for an entry
async function handleLinkCardsForEntry(entryData, urls) {
  if (!entryData || !entryData.element) return;

  // Remove existing link cards
  const existingCards = entryData.element.querySelectorAll('.link-card, .link-card-placeholder');
  existingCards.forEach(card => card.remove());

  entryData.linkCardsData = [];

  for (const url of urls) {
    // Add placeholder
    const placeholder = createLinkCardPlaceholder(url);
    entryData.element.appendChild(placeholder);

    // Generate link card
    const cardData = await generateLinkCard(url);

    // Remove placeholder
    placeholder.remove();

    if (cardData) {
      const card = createLinkCard(cardData);
      entryData.element.appendChild(card);
      entryData.linkCardsData.push(cardData);
      updateEntryWidthForLinkCard(entryData.element, card);
    }
  }

  // Update on server with link card data
  updateEntryOnServer(entryData);
}

// Start editing an existing entry
function startEditingEntry(entryId) {
  const entryData = entries.get(entryId);
  if (!entryData) return;

  const position = entryData.position || { x: 0, y: 0 };
  const text = entryData.text || '';

  placeEditorAtWorld(position.x, position.y, text, entryId);
}
