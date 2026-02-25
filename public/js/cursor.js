// cursor.js — Cursor placement and positioning logic

// Check if a position overlaps with any entry (requires 5px empty space in all directions)
function positionOverlapsEntry(wx, wy) {
  const requiredClearance = 5; // Required empty space in all directions (in world coordinates)
  const cursorWidth = 4; // Approximate cursor width in world coordinates
  const cursorHeight = 20; // Approximate cursor height in world coordinates (line height)

  // Calculate the bounding box of the cursor area (with required clearance)
  // Account for editor padding offset (4px) - cursor appears 4px to the right of editor.left
  const cursorX = wx + 4; // Actual cursor X position (accounting for editor padding)
  const cursorLeft = cursorX - requiredClearance;
  const cursorRight = cursorX + cursorWidth + requiredClearance;
  const cursorTop = wy - requiredClearance;
  const cursorBottom = wy + cursorHeight + requiredClearance;

  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;
    const element = entryData.element;
    if (!element || element.style.display === 'none') continue;

    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;

    // Use getBoundingClientRect for accurate dimensions, but ensure it's valid
    const rect = element.getBoundingClientRect();
    // Only check if element has valid dimensions (not collapsed)
    if (rect.width === 0 || rect.height === 0) continue;

    // Get world dimensions accounting for zoom
    // Use Math.max to ensure we have at least some minimum dimensions
    const worldWidth = Math.max(rect.width / cam.z, 50); // Minimum 50px world width
    const worldHeight = Math.max(rect.height / cam.z, 20); // Minimum 20px world height

    // Check if cursor area (with clearance) overlaps with entry
    // Check for any overlap between cursor area and entry using bounding box intersection
    if (!(cursorRight < worldX || cursorLeft > worldX + worldWidth ||
          cursorBottom < worldY || cursorTop > worldY + worldHeight)) {
      return true; // Overlaps
    }
  }

  // Also check anchor if on home page
  if (anchor && currentViewEntryId === null) {
    const anchorX = anchorPos.x;
    const anchorY = anchorPos.y;
    const anchorRect = anchor.getBoundingClientRect();
    // Only check if anchor has valid dimensions
    if (anchorRect.width > 0 && anchorRect.height > 0) {
      const anchorWorldWidth = anchorRect.width / cam.z;
      const anchorWorldHeight = anchorRect.height / cam.z;

      // Check if cursor area overlaps with anchor
      if (!(cursorRight < anchorX || cursorLeft > anchorX + anchorWorldWidth ||
            cursorBottom < anchorY || cursorTop > anchorY + anchorWorldHeight)) {
        return true; // Overlaps
      }
    }
  }

  return false;
}

// Check if a position is within the viewport (at 0.75x zoom level)
function isPositionInViewport(wx, wy) {
  const viewportRect = viewport.getBoundingClientRect();
  // Calculate viewport bounds in world coordinates at 0.75x zoom
  const viewportWorldWidth = viewportRect.width / 0.75;
  const viewportWorldHeight = viewportRect.height / 0.75;
  const viewportCenter = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);

  const viewportLeft = viewportCenter.x - viewportWorldWidth / 2;
  const viewportRight = viewportCenter.x + viewportWorldWidth / 2;
  const viewportTop = viewportCenter.y - viewportWorldHeight / 2;
  const viewportBottom = viewportCenter.y + viewportWorldHeight / 2;

  return wx >= viewportLeft && wx <= viewportRight &&
         wy >= viewportTop && wy <= viewportBottom;
}

// Find a random empty space next to an entry that doesn't overlap with entries
// Prefers positions within viewport (0.75x zoom)
function findRandomEmptySpaceNextToEntry() {
  const visibleEntries = Array.from(entries.values()).filter(entryData => {
    const element = entryData.element;
    if (!element) return false;
    if (currentViewEntryId === null) {
      return !entryData.parentEntryId && element.style.display !== 'none';
    } else {
      return element.style.display !== 'none';
    }
  });

  if (visibleEntries.length === 0) {
    // No entries - place cursor in center of viewport for empty pages
    const viewportRect = viewport.getBoundingClientRect();
    const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);

    // For empty pages, always use center so it's clear where user is typing
    console.log('[CURSOR] Empty page - placing cursor in center:', center);
    return { x: center.x, y: center.y };
  }

  // Try multiple positions until we find one that doesn't overlap and is in viewport
  const maxAttempts = 50; // Increased attempts to find viewport position
  let bestPosition = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Pick a random entry
    const randomEntry = visibleEntries[Math.floor(Math.random() * visibleEntries.length)];
    const element = randomEntry.element;
    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    // Convert screen dimensions to world dimensions (accounting for zoom)
    const worldWidth = rect.width / cam.z;
    const worldHeight = rect.height / cam.z;

    // Choose a random side (right, bottom, left, top)
    const side = Math.floor(Math.random() * 4);
    const padding = (40 + 5) / cam.z; // Space between entry and cursor (40px + 5px clearance in world coordinates)

    let x, y;
    switch (side) {
      case 0: // Right
        x = worldX + worldWidth + padding;
        y = worldY + Math.random() * worldHeight;
        break;
      case 1: // Bottom
        x = worldX + Math.random() * worldWidth;
        y = worldY + worldHeight + padding;
        break;
      case 2: // Left
        x = worldX - padding;
        y = worldY + Math.random() * worldHeight;
        break;
      case 3: // Top
        x = worldX + Math.random() * worldWidth;
        y = worldY - padding;
        break;
    }

    // Check if this position overlaps with any entry
    if (!positionOverlapsEntry(x, y)) {
      // Prefer positions within viewport
      if (isPositionInViewport(x, y)) {
        return { x, y };
      }
      // Store as fallback if we don't have one yet
      if (!bestPosition) {
        bestPosition = { x, y };
      }
    }
  }

  // If we found a non-overlapping position (even if outside viewport), use it
  if (bestPosition) {
    return bestPosition;
  }

  // If we couldn't find a non-overlapping position after maxAttempts, try systematic search
  // Try positions in a grid pattern around the viewport center (preferring viewport)
  const viewportRect = viewport.getBoundingClientRect();
  const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
  const step = 50 / cam.z; // Smaller step for finer search
  const maxRadius = (viewportRect.width / 0.75) / 2; // Limit to viewport at 0.75x zoom

  // First, try positions within viewport
  for (let radius = step; radius <= maxRadius; radius += step) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const testX = center.x + Math.cos(rad) * radius;
      const testY = center.y + Math.sin(rad) * radius;
      if (!positionOverlapsEntry(testX, testY) && isPositionInViewport(testX, testY)) {
        return { x: testX, y: testY };
      }
    }
  }

  // If nothing in viewport, try outside viewport
  for (let radius = step; radius <= maxRadius * 2; radius += step) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const testX = center.x + Math.cos(rad) * radius;
      const testY = center.y + Math.sin(rad) * radius;
      if (!positionOverlapsEntry(testX, testY)) {
        return { x: testX, y: testY };
      }
    }
  }

  // Last resort: return center position (should be visible)
  return { x: center.x, y: center.y };
}

// Show cursor at a position (idle mode - not actively editing)
function showCursorAtWorld(wx, wy, force = false) {
  if (isReadOnly) {
    return;
  }
  if (isFocusInDropDialog()) {
    return;
  }

  // Don't show cursor if there are selected entries (user might want to delete them)
  if (selectedEntries.size > 0 && !force) {
    return;
  }

  // Don't update cursor if we're processing a click - wait for click handler to set position
  if (isProcessingClick && !force) {
    return;
  }

  console.log('[CURSOR] showCursorAtWorld at', wx, wy);

  editorWorldPos = { x: wx, y: wy };
  // Account for editor's left padding (4px) so cursor appears exactly where clicked
  editor.style.left = `${wx - 4}px`;
  editor.style.top = `${wy}px`;

  // CRITICAL: Clear editor content completely to prevent stale content
  editor.textContent = '';
  editor.innerHTML = '';
  editor.value = ''; // Also clear value just in case

  editor.style.width = '4px';
  // Reset font size to default for new entries
  editor.style.fontSize = '16px';
  // Ensure editor is visible
  editor.style.display = 'block';
  if (formatBar) formatBar.classList.remove('hidden');
  // Focus the editor so user can type immediately
  // The focus event will remove idle-cursor class and show native caret
  editor.classList.add('idle-cursor');
  editor.classList.remove('has-content');
  // Focus editor so typing works immediately
  requestAnimationFrame(() => {
    editor.focus();
    // Set cursor position at the start
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// Get bottom-right position of an entry (or where it was)
function getEntryBottomRightPosition(entryId) {
  if (!entryId) return null;

  const entryData = entries.get(entryId);
  if (entryData && entryData.element) {
    const element = entryData.element;
    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    const worldWidth = rect.width;
    const worldHeight = rect.height;

    // Position cursor at bottom-right with some padding
    const padding = 40;
    return {
      x: worldX + worldWidth + padding,
      y: worldY + worldHeight + padding
    };
  }

  // If entry doesn't exist anymore (was deleted), use stored position if available
  // Otherwise return null to fall back to random position
  return null;
}

// Show cursor in a good default position
// RULE: Cursor should ALWAYS be visible unless something is in edit mode (typing)
function showCursorInDefaultPosition(entryId = null) {
  console.log('[CURSOR] showCursorInDefaultPosition called. isReadOnly:', isReadOnly, 'entryId:', entryId, 'hasClickedRecently:', hasClickedRecently);

  if (isReadOnly) {
    return;
  }
  if (isFocusInDropDialog()) {
    return;
  }

  // Don't show cursor if there are selected entries (user might want to delete them)
  if (selectedEntries.size > 0) {
    console.log('[CURSOR] Entries are selected, hiding cursor');
    hideCursor();
    return;
  }

  // Don't show idle cursor if user is actively editing (typing in editor)
  if (editingEntryId && document.activeElement === editor && editor.textContent.trim().length > 0) {
    console.log('[CURSOR] User is actively editing, not showing idle cursor');
    return;
  }

  // PRIORITY 1: If user just clicked, use that click position (superceding rule)
  // Check lastClickPos first - if user clicked, always use that position
  // Note: We don't check for overlaps here because user explicitly clicked there
  if (lastClickPos && hasClickedRecently) {
    console.log('[CURSOR] Using last click position:', lastClickPos);
    showCursorAtWorld(lastClickPos.x, lastClickPos.y, true); // force = true to override isProcessingClick
    return;
  }

  // PRIORITY 2: If we have an entry ID, place cursor at bottom-right of that entry
  if (entryId) {
    const pos = getEntryBottomRightPosition(entryId);
    if (pos) {
      // Check if position overlaps with any entry, if so find a new empty space
      if (positionOverlapsEntry(pos.x, pos.y)) {
        // Position overlaps, find a new empty space
        const newPos = findRandomEmptySpaceNextToEntry();
        console.log('[CURSOR] Position overlaps, using new position:', newPos);
        showCursorAtWorld(newPos.x, newPos.y);
      } else {
        console.log('[CURSOR] Using entry bottom-right position:', pos);
        showCursorAtWorld(pos.x, pos.y);
      }
      return;
    }
  }

  // PRIORITY 3: If we have a stored position from before edit mode, use it
  // BUT: Only if user didn't click (hasClickedRecently would be true if they did)
  if (cursorPosBeforeEdit && !hasClickedRecently) {
    // Check if stored position overlaps with any entry
    if (positionOverlapsEntry(cursorPosBeforeEdit.x, cursorPosBeforeEdit.y)) {
      // Position overlaps, find a new empty space
      const newPos = findRandomEmptySpaceNextToEntry();
      console.log('[CURSOR] Stored position overlaps, using new position:', newPos);
      showCursorAtWorld(newPos.x, newPos.y);
    } else {
      console.log('[CURSOR] Using stored cursor position:', cursorPosBeforeEdit);
      showCursorAtWorld(cursorPosBeforeEdit.x, cursorPosBeforeEdit.y);
    }
    cursorPosBeforeEdit = null; // Clear after using
    return;
  }

  // PRIORITY 4: Otherwise, find a random empty space (or center for empty pages)
  // Keep trying until we find a position that doesn't overlap
  let attempts = 0;
  const maxAttempts = 10;
  let pos = null;
  let foundNonOverlapping = false;

  while (attempts < maxAttempts && !foundNonOverlapping) {
    pos = findRandomEmptySpaceNextToEntry();
    // Verify the position doesn't overlap with any entry
    if (!positionOverlapsEntry(pos.x, pos.y)) {
      foundNonOverlapping = true;
    } else {
      attempts++;
    }
  }

  if (foundNonOverlapping && pos) {
    console.log('[CURSOR] Using random empty space:', pos);
    showCursorAtWorld(pos.x, pos.y);
  } else {
    // If we still couldn't find a non-overlapping position, try systematic search
    // Try positions around the viewport center
    const viewportRect = viewport.getBoundingClientRect();
    const center = screenToWorld(viewportRect.width / 2, viewportRect.height / 2);
    let found = false;
    // Adjust offsets for zoom level
    const baseOffset = 100 / cam.z;
    const offsets = [0, baseOffset, -baseOffset, baseOffset * 2, -baseOffset * 2, baseOffset * 1.5, -baseOffset * 1.5];
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const testX = center.x + offsetX;
        const testY = center.y + offsetY;
        if (!positionOverlapsEntry(testX, testY)) {
          console.log('[CURSOR] Using systematic search position:', { x: testX, y: testY });
          showCursorAtWorld(testX, testY);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      // Last resort: use center position (should be visible even if it overlaps slightly)
      console.log('[CURSOR] Using center position (last resort):', center);
      showCursorAtWorld(center.x, center.y);
    }
  }
}
