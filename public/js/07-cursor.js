/**
 * Cursor Positioning
 * Handles the visual cursor display and positioning
 */

// Show cursor at world position (idle state)
function showCursorAtWorld(wx, wy) {
  if (!editor) return;

  // Editor is inside #world, so use world coordinates directly
  editor.style.left = `${wx}px`;
  editor.style.top = `${wy}px`;
  editor.style.display = 'block';
  editor.textContent = '';
  editor.classList.add('idle-cursor');
  editor.classList.remove('has-content');

  editorWorldPos = { x: wx, y: wy };
}

// Show cursor in default position (center or last position)
function showCursorInDefaultPosition() {
  if (isReadOnly) return;

  // Use last click position if available
  if (lastClickPos) {
    showCursorAtWorld(lastClickPos.x, lastClickPos.y);
    return;
  }

  // Otherwise center of viewport
  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
  showCursorAtWorld(center.x, center.y);
}

// Hide cursor
function hideCursor() {
  if (!editor) return;

  editor.style.display = 'none';
  editor.textContent = '';
  editor.classList.remove('idle-cursor', 'has-content');
}

// Update cursor position based on camera transform
function updateCursorPosition() {
  if (!editor || editor.style.display === 'none') return;

  if (editorWorldPos) {
    const screen = worldToScreen(editorWorldPos.x, editorWorldPos.y);
    editor.style.left = `${screen.x}px`;
    editor.style.top = `${screen.y}px`;
  }
}

// Find random empty space for new entry
function findRandomEmptySpace(minDist = 150) {
  const maxAttempts = 50;
  const viewBounds = {
    minX: (0 - cam.x) / cam.z + 50,
    maxX: (window.innerWidth - cam.x) / cam.z - 200,
    minY: (80 - cam.y) / cam.z + 50, // Account for topbar
    maxY: (window.innerHeight - cam.y) / cam.z - 100
  };

  for (let i = 0; i < maxAttempts; i++) {
    const x = viewBounds.minX + Math.random() * (viewBounds.maxX - viewBounds.minX);
    const y = viewBounds.minY + Math.random() * (viewBounds.maxY - viewBounds.minY);

    // Check distance to all visible entries
    let tooClose = false;
    entries.forEach((entryData, entryId) => {
      if (entryId === 'anchor') return;
      if ((entryData.parentEntryId ?? null) !== currentViewEntryId) return;

      const dx = (entryData.position?.x ?? 0) - x;
      const dy = (entryData.position?.y ?? 0) - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        tooClose = true;
      }
    });

    if (!tooClose) {
      return { x, y };
    }
  }

  // Fallback: return center of view
  return {
    x: (viewBounds.minX + viewBounds.maxX) / 2,
    y: (viewBounds.minY + viewBounds.maxY) / 2
  };
}
