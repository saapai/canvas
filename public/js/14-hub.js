/**
 * Hub Organization
 * LLM-powered semantic organization of entries into hubs
 */

// Organize entries into hubs using LLM
async function organizeEntriesIntoHubs() {
  const visibleEntries = Array.from(entries.values()).filter(e => {
    if (e.id === 'anchor') return false;
    const parent = e.parentEntryId ?? null;
    return parent === currentViewEntryId;
  });

  if (visibleEntries.length < 2) {
    console.log('[HUB] Not enough entries to organize');
    return;
  }

  console.log('[HUB] Organizing', visibleEntries.length, 'entries');

  try {
    const entryData = visibleEntries.map(e => ({
      id: e.id,
      text: e.text,
      position: e.position,
      mediaCardData: e.mediaCardData,
      linkCardsData: e.linkCardsData
    }));

    const res = await fetch('/api/organize-hubs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: entryData })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[HUB] Organization failed:', err);
      return;
    }

    const data = await res.json();
    console.log('[HUB] Received organization:', data);

    if (data.groups && Array.isArray(data.groups)) {
      applyHubOrganization(data.groups, visibleEntries);
    }
  } catch (err) {
    console.error('[HUB] Organization error:', err);
  }
}

// Apply hub organization to entries
function applyHubOrganization(groups, visibleEntries) {
  if (!groups || groups.length === 0) return;

  const alignedEntries = [];

  // Process each group
  groups.forEach(group => {
    if (!group.entryIds || group.entryIds.length < 2) return;

    const groupEntries = group.entryIds
      .map(id => visibleEntries.find(e => e.id === id))
      .filter(Boolean);

    if (groupEntries.length < 2) return;

    // Calculate layout direction
    const dominantDir = group.direction || [1, 0];
    const perpDir = [-dominantDir[1], dominantDir[0]];

    // Compute bounding box
    const xs = groupEntries.map(e => (e.position || { x: 0 }).x);
    const ys = groupEntries.map(e => (e.position || { y: 0 }).y);
    const bboxWidth = Math.max(...xs) - Math.min(...xs);
    const bboxHeight = Math.max(...ys) - Math.min(...ys);

    const isHorizontal = bboxWidth > bboxHeight;
    const layoutAxis = isHorizontal ? dominantDir : perpDir;
    const layoutPerp = isHorizontal ? perpDir : dominantDir;

    // Text-aware sizing
    const CHAR_WIDTH = 9;
    const LINE_HEIGHT = 24;

    const entryBboxes = groupEntries.map(e => {
      const text = e.text || '';
      const lines = text.split('\n');
      const maxLineLength = Math.max(...lines.map(l => l.length), 0);

      const width = Math.max(maxLineLength * CHAR_WIDTH, 60);
      const height = lines.length * LINE_HEIGHT;

      const pos = e.position || { x: 0, y: 0 };

      return {
        id: e.id,
        x: pos.x,
        y: pos.y,
        width,
        height,
        text,
        original: { x: pos.x, y: pos.y }
      };
    });

    // Order entries along axis
    const projected = entryBboxes.map(bbox => ({
      ...bbox,
      projection: bbox.x * layoutAxis[0] + bbox.y * layoutAxis[1]
    }));

    projected.sort((a, b) => a.projection - b.projection);

    // Enforce minimum spacing
    const MIN_GAP = 22;
    const workingPositions = [];
    let prevEnd = projected[0].projection;

    projected.forEach((bbox, index) => {
      let currentPos;

      if (index === 0) {
        currentPos = bbox.projection;
      } else {
        const entrySize = isHorizontal ? bbox.width : bbox.height;
        const minPos = prevEnd + MIN_GAP;
        currentPos = Math.max(bbox.projection, minPos);
      }

      const entrySize = isHorizontal ? bbox.width : bbox.height;
      const newX = currentPos * layoutAxis[0] + (bbox.x - bbox.projection * layoutAxis[0]);
      const newY = currentPos * layoutAxis[1] + (bbox.y - bbox.projection * layoutAxis[1]);

      workingPositions.push({
        id: bbox.id,
        x: newX,
        y: newY,
        width: bbox.width,
        height: bbox.height,
        original: bbox.original
      });

      prevEnd = currentPos + entrySize;
    });

    // Add organic jitter
    const perpJitterDir = Math.random() > 0.5 ? 1 : -1;

    workingPositions.forEach(pos => {
      const jitterAmount = (Math.random() * 6 + 8) * perpJitterDir;
      pos.x += layoutPerp[0] * jitterAmount;
      pos.y += layoutPerp[1] * jitterAmount;
    });

    // Movement caps
    const MAX_MOVEMENT = 120;

    workingPositions.forEach(pos => {
      const dx = pos.x - pos.original.x;
      const dy = pos.y - pos.original.y;
      const totalDist = Math.sqrt(dx * dx + dy * dy);

      if (totalDist > MAX_MOVEMENT) {
        const scale = MAX_MOVEMENT / totalDist;
        pos.x = pos.original.x + dx * scale;
        pos.y = pos.original.y + dy * scale;
      }

      alignedEntries.push({
        id: pos.id,
        position: { x: pos.x, y: pos.y },
        original: pos.original
      });
    });
  });

  if (alignedEntries.length === 0) return;

  // Animate position changes
  alignedEntries.forEach(({ id, position, original }) => {
    const entryData = entries.get(id);
    if (!entryData) return;

    const element = entryData.element;
    const startX = original.x;
    const startY = original.y;
    const endX = position.x;
    const endY = position.y;

    const duration = 700 + Math.random() * 200;
    const startTime = performance.now();

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const eased = 1 - Math.pow(1 - progress, 3);

      const currentX = startX + (endX - startX) * eased;
      const currentY = startY + (endY - startY) * eased;

      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        entryData.position = { x: endX, y: endY };
      }
    }

    requestAnimationFrame(animate);
  });

  // Save updated positions
  setTimeout(async () => {
    const entriesToSave = alignedEntries.map(e => {
      const entryData = entries.get(e.id);
      return {
        id: e.id,
        text: entryData.text,
        position: e.position,
        parentEntryId: entryData.parentEntryId || null
      };
    });

    try {
      await fetch('/api/entries/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave })
      });
    } catch (error) {
      console.error('Error saving aligned positions:', error);
    }
  }, 950);
}
