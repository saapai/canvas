// camera.js — Camera state, coordinate transforms, and viewport controls

// Navigation state
let currentViewEntryId = null;
let navigationStack = [];
let isNavigating = false;
let navigationJustCompleted = false;

// Track mouse position for typing without clicking
let currentMousePos = { x: 0, y: 0 };
let lastClickPos = null; // Track last click position for typing

// Drag-to-pan
let dragging = false;
let draggingEntry = null;
let dragOffset = { x: 0, y: 0 };
let last = { x: 0, y: 0 };
let justFinishedDragging = false;
let dragStartPositions = new Map(); // Track initial positions for undo

// Where the editor is placed in WORLD coordinates
let editorWorldPos = { x: 80, y: 80 };
let editingEntryId = null;
let isCommitting = false;
let pendingEditTimeout = null; // Track pending edit to allow double-click detection
let hasClickedRecently = false; // Track if user clicked somewhere (so we don't use hover position)
let cursorPosBeforeEdit = null; // Store cursor position before entering edit mode
let isProcessingClick = false; // Flag to prevent cursor updates during click handling

function applyTransform(){
  world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.z})`;
  world.style.transformOrigin = '0 0';
}
applyTransform();

function screenToWorld(sx, sy){
  return {
    x: (sx - cam.x) / cam.z,
    y: (sy - cam.y) / cam.z
  };
}

function worldToScreen(wx, wy){
  return {
    x: wx * cam.z + cam.x,
    y: wy * cam.z + cam.y
  };
}

function centerAnchor(){
  const viewportRect = viewport.getBoundingClientRect();
  const centerX = viewportRect.width / 2;
  const centerY = viewportRect.height / 2;

  const worldCenter = screenToWorld(centerX, centerY);

  const textRect = anchor.getBoundingClientRect();
  const worldTextRect = {
    width: textRect.width / cam.z,
    height: textRect.height / cam.z
  };

  anchorPos.x = worldCenter.x - worldTextRect.width / 2;
  anchorPos.y = worldCenter.y - worldTextRect.height / 2;

  anchor.style.left = `${anchorPos.x}px`;
  anchor.style.top = `${anchorPos.y}px`;
}

function zoomToFitEntries() {
  const visibleEntries = Array.from(entries.values()).filter(entryData => {
    const element = entryData.element;
    if (!element) return false;
    // Only include root entries (those without parent or those visible in current view)
    if (currentViewEntryId === null) {
      // Root view - include only root entries
      return !entryData.parentEntryId && element.style.display !== 'none';
    } else {
      // Subdirectory view - include entries visible in current navigation
      return element.style.display !== 'none';
    }
  });

  if (visibleEntries.length === 0) {
    // No entries to fit - center anchor and show cursor
    centerAnchor();

    // Always show cursor after navigation or initial load when there are no entries
    if (!isReadOnly) {
      setTimeout(() => {
        if (navigationJustCompleted) {
          navigationJustCompleted = false;
        }
        showCursorInDefaultPosition();
      }, 100);
    }
    return;
  }

  // Calculate bounding box of all visible entries in world coordinates
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  visibleEntries.forEach(entryData => {
    const element = entryData.element;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const worldX = parseFloat(element.style.left) || 0;
    const worldY = parseFloat(element.style.top) || 0;
    const worldWidth = rect.width / cam.z;
    const worldHeight = rect.height / cam.z;

    minX = Math.min(minX, worldX);
    minY = Math.min(minY, worldY);
    maxX = Math.max(maxX, worldX + worldWidth);
    maxY = Math.max(maxY, worldY + worldHeight);
  });

  // On home page, include anchor in bounding box
  // Use stored anchorPos instead of recalculating from style to prevent drift
  if (currentViewEntryId === null && anchor) {
    const anchorWorldX = anchorPos.x;
    const anchorWorldY = anchorPos.y;
    // Get dimensions in world coordinates (accounting for current zoom)
    const anchorRect = anchor.getBoundingClientRect();
    const anchorWorldWidth = anchorRect.width / cam.z;
    const anchorWorldHeight = anchorRect.height / cam.z;

    minX = Math.min(minX, anchorWorldX);
    minY = Math.min(minY, anchorWorldY);
    maxX = Math.max(maxX, anchorWorldX + anchorWorldWidth);
    maxY = Math.max(maxY, anchorWorldY + anchorWorldHeight);
  }

  // Add padding around entries
  const padding = 80;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  // Get viewport dimensions
  const viewportRect = viewport.getBoundingClientRect();
  const viewportWidth = viewportRect.width;
  const viewportHeight = viewportRect.height;

  // Calculate zoom to fit content
  const scaleX = viewportWidth / contentWidth;
  const scaleY = viewportHeight / contentHeight;
  const newZoom = Math.min(scaleX, scaleY, 2.0); // Cap zoom at 2x to avoid too much zoom in
  // Zoom out to add breathing room - 1.25x for spacing (0.8x of previous 1.56x)
  const zoomWithPadding = newZoom / 1.25;
  const clampedZoom = clamp(zoomWithPadding, 0.12, 2.0);

  // Never zoom in - only zoom out or stay at current zoom
  const finalZoom = Math.min(clampedZoom, cam.z);

  // Calculate target camera position
  const screenCenterX = viewportWidth / 2;
  const screenCenterY = viewportHeight / 2;

  // If there's only one entry, add slight offset to keep it off-center
  // Otherwise, center normally
  let offsetX = 0;
  let offsetY = 0;
  if (visibleEntries.length === 1) {
    // Offset by 10% of viewport size for single entry
    offsetX = viewportWidth * 0.1;
    offsetY = viewportHeight * 0.1;
  }

  const targetX = screenCenterX - contentCenterX * finalZoom + offsetX;
  const targetY = screenCenterY - contentCenterY * finalZoom + offsetY;

  // If zoom doesn't change and position is already correct, still show cursor after traversal
  const zoomChanged = Math.abs(finalZoom - cam.z) > 0.001;
  const positionChanged = Math.abs(targetX - cam.x) > 1 || Math.abs(targetY - cam.y) > 1;
  const needsAnimation = zoomChanged || positionChanged;

  console.log('[ZOOM] needsAnimation:', needsAnimation, 'zoomChanged:', zoomChanged, 'positionChanged:', positionChanged, 'navigationJustCompleted:', navigationJustCompleted);

  // Store starting values for animation
  const startX = cam.x;
  const startY = cam.y;
  const startZ = cam.z;

  // Target values
  const targetZ = finalZoom;

  // Animation parameters
  const duration = 800; // milliseconds
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Use ease-out easing for smooth deceleration
    const easeOut = 1 - Math.pow(1 - progress, 3);

    // Interpolate camera values
    cam.x = startX + (targetX - startX) * easeOut;
    cam.y = startY + (targetY - startY) * easeOut;
    cam.z = startZ + (targetZ - startZ) * easeOut;

    applyTransform();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation completed - clear navigation flags to allow clicking
      // This happens after ~800ms, allowing immediate interaction after zoom
      const wasNavigating = navigationJustCompleted;
      if (navigationJustCompleted) {
        navigationJustCompleted = false;
      }
      // Clear isNavigating flag immediately so user can interact
      isNavigating = false;

      // Always show cursor after animation completes (whether from navigation or initial load)
      if (!isReadOnly) {
        // Show cursor immediately and also with delay as fallback
        console.log('[ZOOM] Animation completed, showing cursor immediately. wasNavigating:', wasNavigating);
        // Immediate attempt
        requestAnimationFrame(() => {
          showCursorInDefaultPosition();
        });
        // Delayed attempt to ensure entries are dimensioned
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              console.log('[ZOOM] Fallback cursor display after delay');
              showCursorInDefaultPosition();
            });
          });
        }, 200); // Fallback delay
      }
    }
  }

  if (needsAnimation) {
    console.log('[ZOOM] Starting animation');
    requestAnimationFrame(animate);
  } else {
    // No animation needed, but still show cursor after traversal
    console.log('[ZOOM] No animation needed, showing cursor immediately');
    if (navigationJustCompleted) {
      navigationJustCompleted = false;
    }
    // Clear isNavigating flag immediately so user can interact
    isNavigating = false;

    if (!isReadOnly) {
      // Show cursor immediately and with delay as fallback
      console.log('[ZOOM] Showing cursor (no animation path)');
      // Immediate attempt
      requestAnimationFrame(() => {
        showCursorInDefaultPosition();
      });
      // Delayed attempt to ensure entries are dimensioned
      setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            console.log('[ZOOM] Fallback cursor display (no animation path)');
            showCursorInDefaultPosition();
          });
        });
      }, 300); // Fallback delay
    }
  }
}
