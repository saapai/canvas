// editor.js — Contenteditable editor placement, content commit, and entry dimensions

function placeEditorAtWorld(wx, wy, text = '', entryId = null, force = false){
  // Allow placing editor during navigation if user explicitly clicked (force = true)
  if (!force && (isNavigating || navigationJustCompleted)) {
    return;
  }

  console.log('[EDITOR] placeEditorAtWorld called with entryId:', entryId, 'type:', typeof entryId, 'force:', force);

  // Store cursor position before entering edit mode (if not already editing and we have a valid position)
  // BUT: Don't store if user just clicked (hasClickedRecently) - clicking should override stored position
  if (!editingEntryId && !text && !hasClickedRecently && editorWorldPos && (editorWorldPos.x !== 0 || editorWorldPos.y !== 0)) {
    // Only store if we have a meaningful position (not default 0,0) and user didn't just click
    cursorPosBeforeEdit = { x: editorWorldPos.x, y: editorWorldPos.y };
  }

  editorWorldPos = { x: wx, y: wy };
  editingEntryId = entryId;

  const previousEditing = document.querySelector('.entry.editing, .entry.deadline-editing');
  if (previousEditing) {
    previousEditing.classList.remove('editing', 'deadline-editing');
  }

  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    if(entryData && entryData.element){
      const isDeadline = entryData.textHtml && entryData.textHtml.includes('deadline-table');
      entryData.element.classList.add(isDeadline ? 'deadline-editing' : 'editing');
      if (!isDeadline) {
        setTimeout(() => updateEditingBorderDimensions(entryData.element), 0);
      }
    }
  }

  // Account for editor's left padding (4px) so cursor appears exactly where clicked
  editor.style.left = `${wx - 4}px`;
  editor.style.top  = `${wy}px`;

  // Restore HTML formatting if available, otherwise use plain text
  if(entryId && entryId !== 'anchor'){
    const entryData = entries.get(entryId);
    // LaTeX entries: load original plain text for editing, enable latex toggle
    if(entryData && entryData.latexData && entryData.latexData.enabled){
      editor.textContent = entryData.latexData.originalText || entryData.text;
      latexModeEnabled = true;
      const latexBtn = document.getElementById('latex-toggle-button');
      if (latexBtn) latexBtn.classList.add('active');
    } else if(entryData && entryData.textHtml){
      editor.innerHTML = entryData.textHtml;
      // Re-attach deadline table handlers when editing existing table
      if (entryData.textHtml.includes('deadline-table')) {
        editor.removeEventListener('keydown', handleDeadlineTableKeydown);
        editor.addEventListener('keydown', handleDeadlineTableKeydown);
        const table = editor.querySelector('.deadline-table');
        if (table) setupDeadlineTableHandlers(table);
      }
      if (entryData.textHtml.includes('gcal-card')) {
        const card = editor.querySelector('.gcal-card');
        if (card) setupCalendarCardHandlers(card);
      }
    } else {
      editor.textContent = text;
    }

    // Detect font size from the editor's actual content after loading HTML
    // Walk through the editor's child nodes to find the first text node with styling
    let detectedFontSize = 16;
    const detectFontSizeFromContent = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const parent = node.parentNode;
        if (parent && parent !== editor) {
          const fontSize = parseFloat(window.getComputedStyle(parent).fontSize);
          if (!isNaN(fontSize)) {
            return fontSize;
          }
        }
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        for (let child of node.childNodes) {
          const size = detectFontSizeFromContent(child);
          if (size) return size;
        }
      }
      return null;
    };

    const contentFontSize = detectFontSizeFromContent(editor);
    if (contentFontSize) {
      detectedFontSize = contentFontSize;
    } else if (entryData && entryData.element) {
      // Fallback to entry element's computed style
      const entryStyles = window.getComputedStyle(entryData.element);
      const fontSize = parseFloat(entryStyles.fontSize);
      if (!isNaN(fontSize)) {
        detectedFontSize = fontSize;
      }
    }

    editor.style.fontSize = detectedFontSize + 'px';
  } else {
    editor.textContent = text;
    editor.style.fontSize = '16px';
  }
  // Always remove idle-cursor when placing editor (will be focused, so native caret shows)
  editor.classList.remove('idle-cursor');
  // Ensure editor is visible (in case it was hidden during navigation)
  editor.style.display = 'block';
  if (formatBar) formatBar.classList.remove('hidden');

  // Set editor width based on actual content, not fixed entry width
  // This allows the editor to expand/contract based on text content
  editor.style.width = 'auto';

  if (text) {
    editor.classList.add('has-content');
  } else {
    editor.classList.remove('has-content');
  }

  const isDeadlineTable = entryId && (() => {
    const ed = entries.get(entryId);
    return ed && ed.textHtml && ed.textHtml.includes('deadline-table');
  })();
  const isCalendarCard = entryId && (() => {
    const ed = entries.get(entryId);
    return ed && ed.textHtml && ed.textHtml.includes('gcal-card');
  })();

  if (isDeadlineTable) {
    const firstCell = editor.querySelector('.deadline-table [contenteditable="true"]');
    if (firstCell) {
      firstCell.focus();
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.focus();
    }
  } else if (isCalendarCard) {
    const card = editor.querySelector('.gcal-card');
    if (card) setupCalendarCardHandlers(card);
    editor.focus();
  } else {
    editor.focus();
  }

  requestAnimationFrame(() => {
    const contentWidth = getWidestLineWidth(editor);
    editor.style.width = `${contentWidth}px`;
  });

  if (!isDeadlineTable && !isCalendarCard) {
    const range = document.createRange();
    const sel = window.getSelection();
    if (text) {
      range.selectNodeContents(editor);
      range.collapse(false);
    } else {
      range.setStart(editor, 0);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// Hide cursor (but keep editor visible for smooth transitions)
function hideCursor() {
  editor.classList.remove('idle-cursor', 'has-content');
  editor.textContent = '';
  editor.style.display = 'none'; // Hide editor when hiding cursor
  editor.blur();
  if (formatBar) formatBar.classList.add('hidden');
}

async function commitEditor(){
  // Prevent commits during or right after navigation
  if (isNavigating || navigationJustCompleted) {
    console.log('[COMMIT] Blocked - isNavigating:', isNavigating, 'navigationJustCompleted:', navigationJustCompleted);
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    return;
  }

  // Prevent double commits
  if (isCommitting) {
    console.log('[COMMIT] Already committing, skipping duplicate commit');
    return;
  }

  isCommitting = true;
  console.log('[COMMIT] Processing entry, editingEntryId:', editingEntryId);

  // Get HTML content to preserve formatting (bold, etc.)
  const htmlContent = editor.innerHTML;
  // Get plain text for URL extraction and storage
  const raw = editor.innerText;
  const trimmedRight = raw.replace(/\s+$/g,'');

  // Check if content is a deadline table, calendar card, or has formatting tags
  const isDeadlineTable = htmlContent.includes('deadline-table');
  const isCalendarCard = htmlContent.includes('gcal-card');
  const hasFormatting = isDeadlineTable || isCalendarCard || /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(htmlContent);
  const trimmedHtml = hasFormatting ? htmlContent : null;

  console.log('[COMMIT] HTML content length:', htmlContent.length, 'hasFormatting:', hasFormatting);
  if (hasFormatting) {
    console.log('[COMMIT] HTML sample:', htmlContent.substring(0, 200));
  }

  // If editing an existing entry
  if(editingEntryId && editingEntryId !== 'anchor'){
    console.log('[COMMIT] Editing existing entry:', editingEntryId);
    console.log('[COMMIT] Available entry IDs in Map:', Array.from(entries.keys()));
    const entryData = entries.get(editingEntryId);
    if(!entryData){
      console.warn('[COMMIT] Missing entry data for edit. Aborting edit to avoid duplicate:', editingEntryId);
      console.warn('[COMMIT] Entry not found in Map. Available entries:', Array.from(entries.keys()).filter(id => id.includes('83')));
      // After committing, show cursor in default position (restore previous or find empty space)
      showCursorInDefaultPosition();
      editingEntryId = null;
      isCommitting = false;
      return;
    }
    if(entryData){
      // If editor text is empty, delete the entry
      if(!trimmedRight){
        const deletedEntryId = editingEntryId; // Store before deletion
        const deletedEntryData = entries.get(deletedEntryId);
        let deletedEntryPos = null;
        if (deletedEntryData && deletedEntryData.element) {
          // Store position before deletion - use beginning (top-left) of entry
          const element = deletedEntryData.element;
          const worldX = parseFloat(element.style.left) || 0;
          const worldY = parseFloat(element.style.top) || 0;
          deletedEntryPos = {
            x: worldX,
            y: worldY
          };
        }
        const deleted = await deleteEntryWithConfirmation(editingEntryId);
        if (deleted) {
          // Show cursor at beginning (top-left) of where deleted entry was
          if (deletedEntryPos) {
            showCursorAtWorld(deletedEntryPos.x, deletedEntryPos.y);
          } else {
            showCursorInDefaultPosition();
          }
          editingEntryId = null;
        }
        isCommitting = false;
        return;
      }

      // Save undo state for edit (save old text before changing)
      const oldText = entryData.text;
      const oldMediaCardData = entryData.mediaCardData;
      const oldLinkCardsData = entryData.linkCardsData;

      // Only save undo if text actually changed
      if (oldText !== trimmedRight || oldMediaCardData !== null) {
        saveUndoState('edit', {
          entryId: editingEntryId,
          oldText: oldText,
          oldMediaCardData: oldMediaCardData,
          oldLinkCardsData: oldLinkCardsData
        });
      }

      // Extract URLs and process text
      const { processedText, urls } = processTextWithLinks(trimmedRight);

      // Preserve existing media/link card data - don't clear it
      // Only remove cards from DOM temporarily, we'll restore them after text update
      const existingCards = entryData.element.querySelectorAll('.link-card, .link-card-placeholder, .media-card');
      existingCards.forEach(card => card.remove());

      // Don't clear mediaCardData or linkCardsData - preserve them

      // Update entry text FIRST before any DOM changes
      entryData.text = trimmedRight;
      // Store HTML content to preserve formatting (only if it has formatting)
      entryData.textHtml = trimmedHtml;
      console.log('[COMMIT] Saving entryData.textHtml:', trimmedHtml ? trimmedHtml.substring(0, 200) : 'null');
      console.log('[COMMIT] entryData.textHtml length:', trimmedHtml ? trimmedHtml.length : 0);

      // Remove editing class first so content is visible for melt animation
      entryData.element.classList.remove('editing', 'deadline-editing');

      // LaTeX mode: convert and render
      if (latexModeEnabled) {
        entryData.element.innerHTML = '';
        entryData.element.classList.add('latex-converting');
        const latexResult = await convertToLatex(trimmedRight);
        entryData.element.classList.remove('latex-converting');
        if (latexResult && latexResult.latex) {
          entryData.latexData = {
            enabled: true,
            source: latexResult.latex,
            originalText: trimmedRight
          };
          renderLatex(latexResult.latex, entryData.element);
        } else {
          // Fallback: render as normal text
          entryData.latexData = null;
          entryData.element.innerHTML = meltify(processedText || '');
        }
      } else {
        // Clear latex data when latex mode is off
        entryData.latexData = null;

      if (isDeadlineTable || isCalendarCard) {
        // Deadline tables / calendar cards: use raw HTML directly, no melt animation
        entryData.element.innerHTML = trimmedHtml;
        if (isCalendarCard) {
          const card = entryData.element.querySelector('.gcal-card');
          if (card) setupCalendarCardHandlers(card);
        }
      } else {
        // Add melt class for animation
        entryData.element.classList.add('melt');

        // Update entry content with melt animation, preserving HTML formatting
        if(processedText){
          if (trimmedHtml) {
            // Has formatting, process HTML with formatting preserved
            entryData.element.innerHTML = meltifyHtml(trimmedHtml);
          } else {
            // No formatting, use regular meltify
            entryData.element.innerHTML = meltify(processedText);
          }
        } else {
          entryData.element.innerHTML = '';
        }
        applyEntryFontSize(entryData.element, trimmedHtml);
      }
      } // end else (non-latex)

      // Restore media card if it exists
      if (entryData.mediaCardData) {
        const card = createMediaCard(entryData.mediaCardData);
        entryData.element.appendChild(card);
      }

      // Restore existing link cards from linkCardsData
      if (entryData.linkCardsData && Array.isArray(entryData.linkCardsData)) {
        for (const cardData of entryData.linkCardsData) {
          if (cardData && cardData.url) {
            const card = createLinkCard(cardData);
            entryData.element.appendChild(card);
            updateEntryWidthForLinkCard(entryData.element, card);
          }
        }
      }

      // Generate and add cards for NEW URLs found in text (that aren't already in linkCardsData)
      const existingUrls = entryData.linkCardsData ? entryData.linkCardsData.map(c => c.url).filter(Boolean) : [];
      const newUrls = urls.filter(url => !existingUrls.includes(url));
      if(newUrls.length > 0){
        const placeholders = [];
        for(const url of newUrls){
          const placeholder = createLinkCardPlaceholder(url);
          entryData.element.appendChild(placeholder);
          updateEntryWidthForLinkCard(entryData.element, placeholder);
          placeholders.push({ placeholder, url });
        }

        // Replace placeholders with actual cards as they're generated
        const newLinkCardsData = [];
        for(const { placeholder, url } of placeholders){
          const cardData = await generateLinkCard(url);
          if(cardData){
            const card = createLinkCard(cardData);
            placeholder.replaceWith(card);
            updateEntryWidthForLinkCard(entryData.element, card);
            newLinkCardsData.push(cardData);
          } else {
            placeholder.remove();
          }
        }
        // Update linkCardsData with new cards
        if (!entryData.linkCardsData) entryData.linkCardsData = [];
        entryData.linkCardsData.push(...newLinkCardsData);
      }

      // Update entry dimensions based on actual content
      // Force immediate recalculation, then update again after rendering
      updateEntryDimensions(entryData.element);

      // Also recalculate after a delay to ensure DOM is fully updated
      setTimeout(() => {
        updateEntryDimensions(entryData.element);
        if (urls.length > 0) {
          // Has link cards - update again after cards are loaded
          setTimeout(() => {
            updateEntryDimensions(entryData.element);
          }, 300);
        }
      }, 150);

      // Save to server - ensure update completes before clearing editing state
      // This prevents duplicates if page reloads before update completes
      try {
        console.log('[COMMIT] About to updateEntryOnServer, entryData.textHtml:', entryData.textHtml ? entryData.textHtml.substring(0, 100) : 'null');
        await updateEntryOnServer(entryData);
        console.log('[COMMIT] Entry updated successfully:', entryData.id);
      } catch (error) {
        console.error('[COMMIT] Failed to update entry:', error);
        // Don't clear editing state on error - let user retry
        isCommitting = false;
        return;
      }

      // Remove melt class after animation completes and reset styles
      const maxDuration = 1500; // Maximum animation duration
      setTimeout(() => {
        entryData.element.classList.remove('melt');
        // Reset any inline styles from animation
        const spans = entryData.element.querySelectorAll('span');
        spans.forEach(span => {
          span.style.animation = 'none';
          span.style.transform = '';
          span.style.filter = '';
          span.style.opacity = '';
        });
      }, maxDuration);

      // Clear editor content BEFORE showing cursor to prevent stale content
      // from being committed as a new entry if commitEditor is triggered again
      const committedEntryId = editingEntryId;
      editingEntryId = null;
      editor.removeEventListener('keydown', handleDeadlineTableKeydown);
      editor.textContent = '';
      editor.innerHTML = '';

      // After committing, show cursor at bottom-right of edited entry
      showCursorInDefaultPosition(committedEntryId);
      isCommitting = false;
      return;
    }
  }

  // Create new entry
  // Safety check: if we somehow got here while editing, abort
  if (editingEntryId && editingEntryId !== 'anchor') {
    console.error('[COMMIT] ERROR: Attempted to create new entry while editingEntryId is set:', editingEntryId);
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }

  // Extract URLs and process text
  const { processedText, urls } = processTextWithLinks(trimmedRight);

  // Allow entry if there's text OR URLs
  if(!processedText && urls.length === 0){
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }

  // Check for duplicate entry at the same directory level
  // BUT: If we're editing an existing entry, exclude it from duplicate check
  const duplicateId = findDuplicateEntry(trimmedRight, currentViewEntryId, editingEntryId);
  if (duplicateId) {
    // Don't create duplicate - just clear editor
    // After committing, show cursor in default position (restore previous or find empty space)
    showCursorInDefaultPosition();
    editingEntryId = null;
    isCommitting = false;
    return;
  }

  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = (isDeadlineTable || isCalendarCard) ? 'entry' : 'entry melt';
  entry.id = entryId;

  entry.style.left = `${editorWorldPos.x}px`;
  entry.style.top  = `${editorWorldPos.y}px`;

  let newEntryLatexData = null;

  // LaTeX mode for new entries
  if (latexModeEnabled && !isDeadlineTable && !isCalendarCard) {
    entry.classList.remove('melt');
    entry.classList.add('latex-converting');
    world.appendChild(entry);
    const latexResult = await convertToLatex(trimmedRight);
    entry.classList.remove('latex-converting');
    if (latexResult && latexResult.latex) {
      newEntryLatexData = {
        enabled: true,
        source: latexResult.latex,
        originalText: trimmedRight
      };
      renderLatex(latexResult.latex, entry);
    } else {
      entry.innerHTML = meltify(processedText || '');
    }
  } else {
  // Only render text if there is any
  if (isDeadlineTable) {
    entry.innerHTML = trimmedHtml;
  } else if (isCalendarCard) {
    entry.innerHTML = trimmedHtml;
    world.appendChild(entry);
    const card = entry.querySelector('.gcal-card');
    if (card) setupCalendarCardHandlers(card);
  } else if(processedText){
    if (trimmedHtml) {
      // Has formatting, process HTML with formatting preserved
      entry.innerHTML = meltifyHtml(trimmedHtml);
    } else {
      // No formatting, use regular meltify
      entry.innerHTML = meltify(processedText);
    }
  } else {
    entry.innerHTML = '';
  }
  applyEntryFontSize(entry, trimmedHtml);
  if (!isCalendarCard) world.appendChild(entry);
  }

  // Update entry dimensions based on actual content after rendering
  // Wait a bit for DOM to update
  setTimeout(() => {
    updateEntryDimensions(entry);
  }, 50);

  // Store entry data
  const entryData = {
    id: entryId,
    element: entry,
    text: trimmedRight,
    textHtml: trimmedHtml || null, // Store HTML to preserve formatting (null if no formatting)
    latexData: newEntryLatexData,
    position: { x: editorWorldPos.x, y: editorWorldPos.y },
    parentEntryId: currentViewEntryId
  };
  entries.set(entryId, entryData);

  // Ensure entry is in the DOM (defensive check)
  if (!entry.parentElement) {
    world.appendChild(entry);
  }

  // Update visibility - new entry should be visible in current view
  updateEntryVisibility();

  // Save to server (await to ensure it completes)
  console.log('[COMMIT] Saving new text entry:', entryData.id, entryData.text.substring(0, 50));
  await saveEntryToServer(entryData);

  // Generate and add cards for URLs (async, after text is rendered)
  if(urls.length > 0){
    const placeholders = [];
    for(const url of urls){
      const placeholder = createLinkCardPlaceholder(url);
      entry.appendChild(placeholder);
      updateEntryWidthForLinkCard(entry, placeholder);
      placeholders.push({ placeholder, url });
    }

    // Replace placeholders with actual cards as they're generated
    const allCardData = [];
    for(const { placeholder, url } of placeholders){
      const cardData = await generateLinkCard(url);
      if(cardData){
        const card = createLinkCard(cardData);
        placeholder.replaceWith(card);
        updateEntryWidthForLinkCard(entry, card);
        allCardData.push(cardData);
      } else {
        placeholder.remove();
      }
    }

    // Save card data to entry for future loads
    if (allCardData.length > 0 && !editingEntryId) {
      const entryData = entries.get(entry.id);
      if (entryData) {
        entryData.cardData = allCardData[0]; // Store first card data
        await updateEntryOnServer(entryData);
      }
    } else if (allCardData.length > 0 && editingEntryId && editingEntryId !== 'anchor') {
      const entryData = entries.get(editingEntryId);
      if (entryData) {
        entryData.cardData = allCardData[0]; // Store first card data
        await updateEntryOnServer(entryData);
      }
    }
  }

  // Remove melt class after animation completes
  const maxDuration = 1500; // Maximum animation duration
  setTimeout(() => {
    entry.classList.remove('melt');
    // Reset any inline styles from animation
    const spans = entry.querySelectorAll('span');
    spans.forEach(span => {
      span.style.animation = 'none';
      span.style.transform = '';
      span.style.filter = '';
      span.style.opacity = '';
    });
  }, maxDuration);

  // Remove editing class if any
  if(editingEntryId && editingEntryId !== 'anchor'){
    const entryData = entries.get(editingEntryId);
    if(entryData && entryData.element){
      entryData.element.classList.remove('editing', 'deadline-editing');
    }
  }

  // After committing, show cursor at bottom-right of created/edited entry
  // Use the newly created entryId (entry was just created above)
  showCursorInDefaultPosition(entryId);
  editingEntryId = null;
  isCommitting = false;
}

function updateEntryDimensions(entry) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Research cards: use auto dimensions based on card content
      if (entry.classList.contains('research-entry')) {
        const card = entry.firstElementChild;
        if (card) {
          const w = Math.max(card.scrollWidth, card.offsetWidth);
          const h = Math.max(card.scrollHeight, card.offsetHeight);
          entry.style.setProperty('width', `${w}px`, 'important');
          entry.style.setProperty('height', `${h}px`, 'important');
          entry.style.setProperty('min-height', 'auto', 'important');
          entry.style.setProperty('min-width', 'auto', 'important');
        }
        return;
      }
      // Deadline tables: use actual DOM dimensions
      const deadlineTable = entry.querySelector('.deadline-table');
      if (deadlineTable) {
        const tableWidth = Math.max(deadlineTable.scrollWidth, deadlineTable.offsetWidth);
        const tableHeight = Math.max(deadlineTable.scrollHeight, deadlineTable.offsetHeight);
        entry.style.setProperty('width', `${tableWidth}px`, 'important');
        entry.style.setProperty('height', `${tableHeight}px`, 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        entry.style.setProperty('min-width', 'auto', 'important');
        return;
      }
      const gcalCard = entry.querySelector('.gcal-card');
      if (gcalCard) {
        const w = Math.max(gcalCard.scrollWidth, gcalCard.offsetWidth);
        const h = Math.max(gcalCard.scrollHeight, gcalCard.offsetHeight);
        entry.style.setProperty('width', `${w}px`, 'important');
        entry.style.setProperty('height', `${h}px`, 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        entry.style.setProperty('min-width', 'auto', 'important');
        return;
      }
      if (entry.classList.contains('canvas-file')) {
        // Use fixed dimensions — DOM measurement is unreliable when entry is hidden
        entry.style.setProperty('width', 'auto', 'important');
        entry.style.setProperty('height', 'auto', 'important');
        entry.style.setProperty('min-width', '200px', 'important');
        entry.style.setProperty('min-height', 'auto', 'important');
        return;
      }
      if (entry.classList.contains('canvas-image')) {
        const img = entry.querySelector('img');
        if (img) {
          // Check for persisted custom size
          const entryData = entries.get(entry.id);
          const cw = entryData && entryData.mediaCardData && entryData.mediaCardData.customWidth;
          const ch = entryData && entryData.mediaCardData && entryData.mediaCardData.customHeight;
          if (cw && ch) {
            img.style.width = `${cw}px`;
            img.style.height = `${ch}px`;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            entry.style.setProperty('width', `${cw}px`, 'important');
            entry.style.setProperty('height', `${ch}px`, 'important');
            entry.style.setProperty('min-width', 'auto', 'important');
            entry.style.setProperty('min-height', 'auto', 'important');
            return;
          }
          const maxW = 320;
          const maxH = 240;
          let w = img.naturalWidth || img.offsetWidth || 0;
          let h = img.naturalHeight || img.offsetHeight || 0;
          if (w <= 0 || h <= 0) {
            w = w || 200;
            h = h || 150;
          }
          const scale = Math.min(1, maxW / w, maxH / h);
          const contentWidth = Math.round(Math.min(w * scale, maxW));
          const contentHeight = Math.round(Math.min(h * scale, maxH));
          entry.style.setProperty('width', `${contentWidth}px`, 'important');
          entry.style.setProperty('height', `${contentHeight}px`, 'important');
          entry.style.setProperty('min-width', 'auto', 'important');
          entry.style.setProperty('min-height', 'auto', 'important');
          return;
        }
      }
      let contentWidth = 0;
      const linkCards = entry.querySelectorAll('.link-card, .link-card-placeholder');
      const mediaCards = entry.querySelectorAll('.media-card');
    // Handle media cards first (they have different padding)
    if (mediaCards.length > 0) {
      const desiredPadding = 2; // Minimal padding for media cards

      mediaCards.forEach(card => {
        // Don't reset styles for media cards - they have fixed dimensions from CSS
        // Just measure their natural width including any existing margins
        const cardStyles = window.getComputedStyle(card);
        const cardWidth = card.offsetWidth;
        const currentMarginLeft = parseFloat(cardStyles.marginLeft) || 0;
        const currentMarginRight = parseFloat(cardStyles.marginRight) || 0;

        // Set consistent margins
        card.style.marginTop = `${desiredPadding}px`;
        card.style.marginBottom = `${desiredPadding}px`;
        card.style.marginLeft = `${desiredPadding}px`;
        card.style.marginRight = `${desiredPadding}px`;

        // Calculate entry width based on card width plus padding
        const entryWidth = cardWidth + (desiredPadding * 2);
        contentWidth = Math.max(contentWidth, entryWidth);
      });

      const minCardWidth = 280;
      const minWidthWithPadding = minCardWidth + (desiredPadding * 2);
      contentWidth = Math.max(contentWidth, minWidthWithPadding);
    } else if (linkCards.length > 0) {
      // If there are link cards, calculate width with symmetric padding
      // Use consistent padding for all link cards (same as height calculation)
      const desiredPadding = 12; // Fixed 12px padding for symmetry

      linkCards.forEach(card => {
        // Reset margins to get natural dimensions
        card.style.marginTop = '0';
        card.style.marginBottom = '0';
        card.style.marginLeft = '0';
        card.style.marginRight = '0';
        card.style.width = 'auto';
        card.style.maxWidth = 'none';

        // Force a layout recalculation
        void card.offsetWidth;

        const cardStyles = window.getComputedStyle(card);
        const cardMinWidth = parseFloat(cardStyles.minWidth) || 360;
        const cardNaturalWidth = Math.max(card.offsetWidth, cardMinWidth);

        // Set equal margins on all sides
        card.style.marginTop = `${desiredPadding}px`;
        card.style.marginBottom = `${desiredPadding}px`;
        card.style.marginLeft = `${desiredPadding}px`;
        card.style.marginRight = `${desiredPadding}px`;

        // Set the card's width explicitly to its natural width
        card.style.width = `${cardNaturalWidth}px`;

        // Entry width = card natural width + left padding + right padding
        const entryWidth = cardNaturalWidth + (desiredPadding * 2);
        contentWidth = Math.max(contentWidth, entryWidth);
      });

      // Ensure minimum width with padding (min card 360px + padding)
      const minCardWidth = 360;
      const minWidthWithPadding = minCardWidth + (desiredPadding * 2);
      contentWidth = Math.max(contentWidth, minWidthWithPadding);
    } else {
      // For text-only entries, calculate width from text content
      // Always use the stored entry text if available, as it's the source of truth
      let textContent = '';
      const entryId = entry.id;
      const entryData = entries.get(entryId);
      if (entryData && entryData.text) {
        // Use the stored raw text - this is always up-to-date
        textContent = entryData.text;
      } else {
        // Fall back to reading from DOM (strips HTML tags), but prefer entry text
        // Note: DOM reading might not be accurate if text has been melted/animated
        textContent = entry.innerText || entry.textContent || '';
      }

      // Calculate one character width as the minimum
      const entryStyles = window.getComputedStyle(entry);
      const tempChar = document.createElement('div');
      tempChar.style.position = 'absolute';
      tempChar.style.visibility = 'hidden';
      tempChar.style.whiteSpace = 'pre';
      tempChar.style.font = entryStyles.font;
      tempChar.style.fontSize = entryStyles.fontSize;
      tempChar.style.fontFamily = entryStyles.fontFamily;
      tempChar.textContent = 'M'; // Use 'M' as a typical wide character
      document.body.appendChild(tempChar);
      const oneCharWidth = tempChar.offsetWidth;
      document.body.removeChild(tempChar);

      if (textContent && textContent.trim()) {
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre';
        temp.style.font = entryStyles.font;
        temp.style.fontSize = entryStyles.fontSize;
        temp.style.fontFamily = entryStyles.fontFamily;
        temp.style.lineHeight = entryStyles.lineHeight;
        temp.textContent = textContent;
        document.body.appendChild(temp);

        // Force layout calculation
        void temp.offsetWidth;

        contentWidth = getWidestLineWidth(temp);
        document.body.removeChild(temp);

        // Use one character width as minimum, or actual width if larger
        contentWidth = Math.max(oneCharWidth, contentWidth);
      } else {
        contentWidth = oneCharWidth; // Default to one character width
      }
    }

    // Height: calculate based on actual rendered content
    // Don't set width yet - we'll set it at the end after all calculations
    entry.style.height = 'auto';
    entry.style.minHeight = 'auto';

    // Force a layout recalculation
    void entry.offsetHeight;

    // Use the entry's natural scrollHeight which includes all content and margins
    let contentHeight = entry.scrollHeight;

    // But we need to measure more accurately to ensure it includes all children properly
    // Get the actual bounding box of all content including margins
    if (entry.children.length > 0) {
      // Get the first and last child positions relative to entry
      const firstChild = entry.children[0];
      const lastChild = entry.children[entry.children.length - 1];

      if (firstChild && lastChild) {
        const firstRect = firstChild.getBoundingClientRect();
        const lastRect = lastChild.getBoundingClientRect();
        const entryRect = entry.getBoundingClientRect();
        const firstStyles = window.getComputedStyle(firstChild);
        const lastStyles = window.getComputedStyle(lastChild);

        // Calculate from first child's top margin to last child's bottom margin
        const firstMarginTop = parseFloat(firstStyles.marginTop) || 0;
        const lastMarginBottom = parseFloat(lastStyles.marginBottom) || 0;

        const relativeFirstTop = firstRect.top - entryRect.top - firstMarginTop;
        const relativeLastBottom = lastRect.bottom - entryRect.top + lastMarginBottom;

        const calculatedHeight = relativeLastBottom - relativeFirstTop;

        // For media cards or link cards, ensure symmetric visual padding
        // If we have only a card, adjust entry height to provide equal padding
        const mediaCard = entry.querySelector('.media-card');
        const linkCard = entry.querySelector('.link-card, .link-card-placeholder');

        if (mediaCard && entry.children.length === 1) {
          // Single media card - calculate height with equal top/bottom margins
          mediaCard.style.marginTop = '0';
          mediaCard.style.marginBottom = '0';
          mediaCard.style.marginLeft = '0';
          mediaCard.style.marginRight = '0';

          void mediaCard.offsetHeight;

          const cardNaturalHeight = mediaCard.offsetHeight;
          const desiredPadding = 2; // Minimal padding for media cards

          mediaCard.style.marginTop = `${desiredPadding}px`;
          mediaCard.style.marginBottom = `${desiredPadding}px`;
          mediaCard.style.marginLeft = `${desiredPadding}px`;
          mediaCard.style.marginRight = `${desiredPadding}px`;

          contentHeight = cardNaturalHeight + (desiredPadding * 2);
        } else if (linkCard && entry.children.length === 1) {
          // Single link card - calculate height with equal top/bottom margins
          // First, reset any existing margins to get the card's natural height
          linkCard.style.marginTop = '0';
          linkCard.style.marginBottom = '0';
          linkCard.style.marginLeft = '0';
          linkCard.style.marginRight = '0';

          // Force a reflow to get accurate measurements
          void linkCard.offsetHeight;

          // Get the card's natural height (without margins)
          const cardNaturalHeight = linkCard.offsetHeight;

          // Calculate desired padding - use a consistent padding value
          // This ensures equal top and bottom padding
          const desiredPadding = 12; // Fixed 12px padding for symmetry

          // Set equal margins on all sides to create symmetric padding
          linkCard.style.marginTop = `${desiredPadding}px`;
          linkCard.style.marginBottom = `${desiredPadding}px`;
          linkCard.style.marginLeft = `${desiredPadding}px`;
          linkCard.style.marginRight = `${desiredPadding}px`;

          // Entry height = card natural height + top margin + bottom margin
          // This ensures the card is perfectly centered vertically
          contentHeight = cardNaturalHeight + (desiredPadding * 2);
        } else {
          contentHeight = Math.max(contentHeight, calculatedHeight);
        }
      }
    }

    // Reset width first to allow contraction, then set new width
    entry.style.width = 'auto';
    entry.style.minWidth = 'auto';
    entry.style.maxWidth = 'none';

    // Force a reflow to ensure reset is applied
    void entry.offsetWidth;

    // Now set the calculated width - this allows both expansion and contraction
    entry.style.setProperty('width', `${contentWidth}px`, 'important');
    entry.style.setProperty('height', `${Math.max(contentHeight, 0)}px`, 'important');
    entry.style.setProperty('min-height', 'auto', 'important');
    entry.style.setProperty('max-width', 'none', 'important');
    entry.style.setProperty('min-width', 'auto', 'important');

    // Force a reflow to ensure width is applied
    void entry.offsetWidth;
    });
  });
}

function updateEntryWidthForLinkCard(entry, card) {
  // Update entry dimensions to account for link card
  updateEntryDimensions(entry);
}
