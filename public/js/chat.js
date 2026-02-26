// chat.js — Canvas chat (trenches + proactive bot), content organization, and drag-drop handling

// ——— Canvas chat (trenches + proactive bot) ———
function entryTitle(ed) {
  if (!ed) return 'Untitled';
  if (ed.mediaCardData && ed.mediaCardData.title) return ed.mediaCardData.title;
  const first = (ed.text || '').split('\n')[0].trim();
  return first ? first.substring(0, 80) : 'Untitled';
}

function dataPointsFromEntry(ed) {
  const out = [];
  const base = { id: ed.id, position: ed.position };
  if (ed.mediaCardData) {
    out.push({
      ...base,
      type: ed.mediaCardData.type === 'song' ? 'song' : ed.mediaCardData.type === 'movie' ? 'movie' : 'media',
      title: ed.mediaCardData.title,
      artist: ed.mediaCardData.artist,
      year: ed.mediaCardData.year,
      url: ed.mediaCardData.url
    });
  } else if (ed.linkCardsData && ed.linkCardsData.length) {
    for (const l of ed.linkCardsData) {
      if (!l) continue;
      out.push({
        ...base,
        type: 'link',
        title: l.title,
        url: l.url,
        description: l.description || null,
        siteName: l.siteName || null
      });
    }
  }
  if (out.length === 0) {
    out.push({
      ...base,
      type: 'text',
      text: (ed.text || '').trim().slice(0, 500)
    });
  }
  return out;
}

function dist(a, b) {
  const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
  const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function buildTrenchesPayload() {
  const all = Array.from(entries.values()).filter(e => e.id);
  const roots = all.filter(e => !e.parentEntryId);
  const k = 4;

  // Recursively build a trench with all nested sub-trenches; traverse fully
  function buildTrenchRecursive(entry, allEntries, depth = 0) {
    const children = allEntries.filter(e => e.parentEntryId === entry.id);
    const hasChild = (e) => allEntries.some(c => c.parentEntryId === e.id);
    const directDataPoints = children.filter(e => !hasChild(e));
    const subTrenches = children.filter(hasChild);

    const trench = {
      id: entry.id,
      title: entryTitle(entry),
      position: entry.position,
      dataPoints: directDataPoints.flatMap(dataPointsFromEntry),
      subTrenches: subTrenches.map(st => buildTrenchRecursive(st, allEntries, depth + 1))
    };

    // Calculate nearby IDs (spatial proximity)
    const others = allEntries.filter(x => x.id !== entry.id && x.position);
    const sorted = others.map(o => ({ id: o.id, d: dist(entry, o) })).sort((a, b) => a.d - b.d);
    trench.nearbyIds = sorted.slice(0, k).map(x => x.id);

    return trench;
  }

  const payload = [];
  for (const r of roots) {
    payload.push(buildTrenchRecursive(r, all));
  }

  // If we're inside a specific trench, also include it and all its descendants
  let focusedTrench = null;
  if (currentViewEntryId) {
    const focusedEntry = all.find(e => e.id === currentViewEntryId);
    if (focusedEntry) {
      focusedTrench = buildTrenchRecursive(focusedEntry, all);
    }
  }

  return { trenches: payload, currentViewEntryId, focusedTrench };
}

// Golden angle spiral layout
const GOLDEN_ANGLE_DEG = 137.508;

function goldenAngleSpiralPosition(n, baseRadius = 80) {
  const angle = n * GOLDEN_ANGLE_DEG * (Math.PI / 180);
  const r = baseRadius * Math.sqrt(n + 1);
  const jitterX = (Math.random() - 0.5) * 30;
  const jitterY = (Math.random() - 0.5) * 30;
  return { x: Math.cos(angle) * r + jitterX, y: Math.sin(angle) * r + jitterY };
}

function computeSpiralCenter(targetPageId) {
  let sumX = 0, sumY = 0, count = 0;
  for (const [, ed] of entries) {
    if ((ed.parentEntryId || null) === (targetPageId || null)) {
      if (ed.position) { sumX += ed.position.x; sumY += ed.position.y; count++; }
    }
  }
  if (count > 0) return { x: sumX / count, y: sumY / count };
  // Fallback: viewport center in world coords
  const rect = viewport.getBoundingClientRect();
  const wc = screenToWorld(rect.width / 2, rect.height / 2);
  return { x: wc.x, y: wc.y };
}

function findNonOverlappingPosition(baseX, baseY) {
  let x = baseX, y = baseY;
  let attempts = 0;
  while (positionOverlapsEntry(x, y) && attempts < 20) {
    x += 40 + Math.random() * 20;
    y += 20 + Math.random() * 10;
    attempts++;
  }
  return { x, y };
}

// Collect dropped items from DataTransfer
async function collectDroppedItems(dataTransfer) {
  const items = [];
  // Check files first
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of dataTransfer.files) {
      if (file.type.startsWith('image/')) {
        try {
          const compressed = await compressImageFile(file);
          const form = new FormData();
          form.append('file', compressed);
          const res = await fetch('/api/upload-image', { method: 'POST', credentials: 'include', body: form });
          if (res.ok) {
            const data = await res.json();
            items.push({ type: 'image', url: data.url, name: file.name });
          }
        } catch (e) { console.error('Image upload failed:', e); }
      } else {
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/upload-file', { method: 'POST', credentials: 'include', body: form });
          if (res.ok) {
            const data = await res.json();
            items.push({ type: 'file', url: data.url, name: data.name, size: data.size, mimetype: data.mimetype });
          }
        } catch (e) { console.error('File upload failed:', e); }
      }
    }
  }
  // Check text/URI
  if (items.length === 0) {
    const uriList = dataTransfer.getData('text/uri-list');
    const plainText = dataTransfer.getData('text/plain');
    const textToCheck = uriList || plainText || '';
    if (textToCheck) {
      // Check if it's a URL
      const lines = textToCheck.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      for (const line of lines) {
        try {
          new URL(line);
          items.push({ type: 'link', url: line });
        } catch {
          items.push({ type: 'text', text: line });
        }
      }
    }
  }
  return items;
}

// Create a new trench (parent entry) and place items inside it
async function createTrenchAndPlace(trenchName, placements) {
  // Create the trench entry at a good spot on the current page
  const rect = viewport.getBoundingClientRect();
  const wc = screenToWorld(rect.width / 2, rect.height / 2);
  const pos = findNonOverlappingPosition(wc.x, wc.y);

  const trenchId = generateEntryId();
  const trenchEl = document.createElement('div');
  trenchEl.className = 'entry';
  trenchEl.id = trenchId;
  trenchEl.style.left = `${pos.x}px`;
  trenchEl.style.top = `${pos.y}px`;
  trenchEl.innerHTML = meltify(trenchName);
  world.appendChild(trenchEl);

  const trenchData = {
    id: trenchId,
    element: trenchEl,
    text: trenchName,
    position: { x: pos.x, y: pos.y },
    parentEntryId: currentViewEntryId
  };
  entries.set(trenchId, trenchData);
  updateEntryDimensions(trenchEl);
  await saveEntryToServer(trenchData);

  // Now place items inside this trench
  const placementsWithTarget = placements.map(p => ({
    targetPageId: trenchId,
    content: p.content || p
  }));
  executePlacements(placementsWithTarget);
}

// Execute placements from the LLM
function executePlacements(placements) {
  const grouped = {};
  for (const p of placements) {
    const target = p.targetPageId || null;
    if (!grouped[target]) grouped[target] = [];
    grouped[target].push(p.content);
  }

  for (const [targetPageId, contentItems] of Object.entries(grouped)) {
    const resolvedTarget = targetPageId === 'null' ? null : targetPageId;
    const center = computeSpiralCenter(resolvedTarget);

    contentItems.forEach((item, i) => {
      const offset = goldenAngleSpiralPosition(i, 80);
      const base = { x: center.x + offset.x, y: center.y + offset.y };
      const pos = findNonOverlappingPosition(base.x, base.y);

      if (item.type === 'image' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry canvas-image';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.style.width = '200px';
        entry.style.height = '150px';
        const img = document.createElement('img');
        img.src = item.url;
        img.dataset.fullSrc = item.url;
        img.alt = 'Canvas image';
        img.draggable = false;
        img.decoding = 'async';
        img.onload = () => updateEntryDimensions(entry);
        img.onerror = () => updateEntryDimensions(entry);
        entry.appendChild(img);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: '',
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget,
          mediaCardData: { type: 'image', url: item.url }
        };
        entries.set(entryId, entryData);
        saveEntryToServer(entryData);
      } else if (item.type === 'file' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry canvas-file';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        const mediaData = { type: 'file', url: item.url, name: item.name || 'File', size: item.size || 0, mimetype: item.mimetype || '' };
        entry.appendChild(createFileCard(mediaData));
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: item.name || 'File',
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget,
          mediaCardData: mediaData
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
      } else if (item.type === 'link' && item.url) {
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.innerHTML = meltify(item.url);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: item.url,
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
        generateLinkCard(item.url).then(cardData => {
          if (cardData) {
            entryData.linkCardsData = [cardData];
            entry.appendChild(createLinkCard(cardData));
            updateEntryDimensions(entry);
            saveEntryToServer(entryData);
          }
        }).catch(() => {});
      } else {
        // Text entry
        const text = item.text || item.url || '';
        if (!text) return;
        const entryId = generateEntryId();
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.id = entryId;
        entry.style.left = `${pos.x}px`;
        entry.style.top = `${pos.y}px`;
        entry.innerHTML = meltify(text);
        world.appendChild(entry);
        const entryData = {
          id: entryId, element: entry, text: text,
          position: { x: pos.x, y: pos.y },
          parentEntryId: resolvedTarget
        };
        entries.set(entryId, entryData);
        updateEntryDimensions(entry);
        saveEntryToServer(entryData);
      }
    });
  }

  updateEntryVisibility();
}

// Organize button
const organizeButton = document.getElementById('organize-button');
if (organizeButton) {
  organizeButton.addEventListener('click', () => {
    if (isReadOnly) return;
    organizeCanvasLayout();
  });
}
