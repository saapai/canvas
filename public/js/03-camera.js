/**
 * Camera and Viewport Functions
 * Handles canvas transformations, coordinate conversions, and zooming
 */

// Apply camera transform to world
function applyTransform() {
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
}

// Convert screen coordinates to world coordinates
function screenToWorld(sx, sy) {
  return {
    x: (sx - cam.x) / cam.z,
    y: (sy - cam.y) / cam.z
  };
}

// Convert world coordinates to screen coordinates
function worldToScreen(wx, wy) {
  return {
    x: wx * cam.z + cam.x,
    y: wy * cam.z + cam.y
  };
}

// Center viewport on world position
function centerOnWorldPos(wx, wy, animate = true) {
  const targetX = window.innerWidth / 2 - wx * cam.z;
  const targetY = window.innerHeight / 2 - wy * cam.z;

  if (animate) {
    animateCameraTo(targetX, targetY, cam.z);
  } else {
    cam.x = targetX;
    cam.y = targetY;
    applyTransform();
  }
}

// Animate camera to target position
function animateCameraTo(targetX, targetY, targetZ, duration = 400) {
  const startX = cam.x;
  const startY = cam.y;
  const startZ = cam.z;
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    cam.x = startX + (targetX - startX) * eased;
    cam.y = startY + (targetY - startY) * eased;
    cam.z = startZ + (targetZ - startZ) * eased;

    applyTransform();

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

// Zoom to fit all visible entries in viewport
function zoomToFitEntries() {
  const visibleEntries = Array.from(entries.values()).filter(e => {
    if (e.id === 'anchor') return false;
    const parent = e.parentEntryId ?? null;
    return parent === currentViewEntryId;
  });

  if (visibleEntries.length === 0) {
    // No entries, center on anchor
    cam.z = 1;
    centerOnWorldPos(anchorPos.x, anchorPos.y, false);
    return;
  }

  // Calculate bounding box of all entries
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  visibleEntries.forEach(e => {
    const el = e.element;
    if (!el) return;

    const x = e.position?.x ?? 0;
    const y = e.position?.y ?? 0;
    const w = el.offsetWidth || 100;
    const h = el.offsetHeight || 30;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  if (minX === Infinity) {
    cam.z = 1;
    centerOnWorldPos(anchorPos.x, anchorPos.y, false);
    return;
  }

  // Add padding
  const padding = 100;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;

  // Calculate zoom to fit
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight - 80; // Account for topbar

  const zoomX = viewWidth / bboxWidth;
  const zoomY = viewHeight / bboxHeight;
  let targetZoom = Math.min(zoomX, zoomY, 1.5); // Cap at 1.5x
  targetZoom = clamp(targetZoom, 0.3, 1.5);

  // Center on bounding box
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  cam.z = targetZoom;
  centerOnWorldPos(centerX, centerY, false);
}

// Update camera position to keep specific point fixed during zoom
function zoomAroundPoint(screenX, screenY, newZoom) {
  const before = screenToWorld(screenX, screenY);

  cam.z = clamp(newZoom, 0.12, 8);

  const after = screenToWorld(screenX, screenY);

  cam.x += (after.x - before.x) * cam.z;
  cam.y += (after.y - before.y) * cam.z;

  applyTransform();
}
