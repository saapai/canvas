// research.js — Research mode: fact generation, web results, and research cards
// ——— Article View Mode ———
let currentViewMode = 'canvas';
const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');
const articleAiSection = document.getElementById('article-ai-section');
const articleAiContent = document.getElementById('article-ai-content');
const viewToggleCanvas = document.getElementById('view-toggle-canvas');
const viewToggleArticle = document.getElementById('view-toggle-article');
const viewToggleResearch = document.getElementById('view-toggle-research');

// ——— Research Mode State ———
let researchModeEnabled = false;
let researchGenerating = false;
// Track thought chain lineage: childEntryId → parentEntryId
const researchChainMap = new Map();
// Track which entries have already been researched to avoid duplicates
const researchedEntries = new Set();
// Track research source → child entry IDs for SVG lines
const researchChildrenMap = new Map();

// ——— Research Mode Functions ———

function buildThoughtChain(entryId) {
  const chain = [];
  let current = entryId;
  while (current) {
    const ed = entries.get(current);
    if (ed && ed.text) chain.unshift(ed.text);
    current = researchChainMap.get(current) || null;
  }
  return chain;
}

// ——— Research v2: Card Renderers ———

function createResearchFactCard(factText) {
  const card = document.createElement('div');
  card.className = 'research-fact-card research-card-animate';
  const icon = document.createElement('span');
  icon.className = 'research-fact-icon';
  icon.textContent = '\u2727';
  card.appendChild(icon);
  const textSpan = document.createElement('span');
  textSpan.textContent = factText;
  card.appendChild(textSpan);
  return card;
}

function createWebResultCard(result) {
  const card = document.createElement('div');
  card.className = 'research-web-card research-card-animate';
  let domain = '';
  try { domain = new URL(result.link).hostname.replace('www.', ''); } catch {}
  const faviconUrl = result.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  card.innerHTML = `<div class="research-web-card-header"><img class="research-web-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'"/><span class="research-web-domain">${escapeHtml(domain)}</span></div><div class="research-web-title">${escapeHtml(result.title)}</div><div class="research-web-snippet">${escapeHtml(result.snippet)}</div>`;
  card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      window.open(result.link, '_blank');
    }
  });
  return card;
}

function createResearchImageCard(imageData) {
  const card = document.createElement('div');
  card.className = 'research-image-card research-card-animate';
  const img = document.createElement('img');
  img.src = imageData.url;
  img.alt = imageData.alt || '';
  img.draggable = false;
  img.loading = 'lazy';
  card.appendChild(img);
  if (imageData.photographer) {
    const credit = document.createElement('div');
    credit.className = 'research-image-credit';
    credit.textContent = imageData.photographer;
    card.appendChild(credit);
  }
  return card;
}

function createFollowUpCard(questionText) {
  const card = document.createElement('div');
  card.className = 'research-followup-card research-card-animate';
  card.innerHTML = `<span class="research-followup-icon">?</span>`;
  const textSpan = document.createElement('span');
  textSpan.textContent = questionText;
  card.appendChild(textSpan);
  return card;
}

// Render a research card inside an entry element based on mediaCardData.researchCardType
function renderResearchCard(entry, entryData) {
  const mcd = entryData.mediaCardData;
  if (!mcd || !mcd.researchCardType) return false;

  entry.classList.add('research-entry');
  // Clear meltified content
  entry.innerHTML = '';

  switch (mcd.researchCardType) {
    case 'fact':
    case 'answer': // backward compat with old answer cards
      entry.appendChild(createResearchFactCard(entryData.text));
      break;
    case 'web': {
      const webData = mcd.webResultData || {};
      entry.appendChild(createWebResultCard({
        title: webData.title || entryData.text,
        link: webData.link || '',
        snippet: webData.snippet || '',
        favicon: webData.favicon || ''
      }));
      break;
    }
    case 'image': {
      const imgData = mcd.imageData || {};
      entry.appendChild(createResearchImageCard({
        url: imgData.url || '',
        alt: imgData.alt || entryData.text,
        photographer: imgData.photographer || ''
      }));
      break;
    }
    case 'followup':
      entry.appendChild(createFollowUpCard(entryData.text));
      break;
    default:
      return false;
  }
  return true;
}

// ——— Research v2: Layout Engine ———

// Card dimension constants
const CARD_DIMS = {
  fact:   { w: 340, h: 64 },
  web:    { w: 340, h: 110 },
  image:  { w: 300, h: 220 },
  followup: { w: 340, h: 44 }
};

function computeResearchLayout(sourceEntryId) {
  const sourceData = entries.get(sourceEntryId);
  if (!sourceData || !sourceData.element) return {};

  const el = sourceData.element;
  const srcX = parseFloat(el.style.left) || 0;
  const srcY = parseFloat(el.style.top) || 0;
  const srcW = el.offsetWidth || 160;
  const srcH = el.offsetHeight || 40;
  const cx = srcX + srcW / 2;
  const cy = srcY + srcH / 2;

  const margin = 30; // gap between cards
  const positions = {};

  // Follow-ups: above source, spread horizontally with gap
  const fuH = CARD_DIMS.followup.h;
  const fuY = cy - srcH / 2 - margin - fuH;
  positions.followUps = [
    { x: cx - CARD_DIMS.followup.w - margin / 2, y: fuY },
    { x: cx + margin / 2, y: fuY }
  ];

  // Web results: right of source, stacked vertically with gaps
  const webX = cx + srcW / 2 + margin + 60;
  const webStartY = cy - (CARD_DIMS.web.h * 1.5 + margin);
  positions.web = [
    { x: webX, y: webStartY },
    { x: webX, y: webStartY + CARD_DIMS.web.h + margin },
    { x: webX, y: webStartY + (CARD_DIMS.web.h + margin) * 2 }
  ];

  // Images: left of source, stacked vertically with gaps
  const imgX = cx - srcW / 2 - margin - CARD_DIMS.image.w - 60;
  const imgStartY = cy - (CARD_DIMS.image.h + margin / 2);
  positions.images = [
    { x: imgX, y: imgStartY },
    { x: imgX, y: imgStartY + CARD_DIMS.image.h + margin }
  ];

  // Facts: below source, stacked vertically, centered
  const factX = cx - CARD_DIMS.fact.w / 2;
  const factStartY = cy + srcH / 2 + margin + 20;
  positions.facts = [
    { x: factX, y: factStartY },
    { x: factX, y: factStartY + CARD_DIMS.fact.h + margin },
    { x: factX, y: factStartY + (CARD_DIMS.fact.h + margin) * 2 }
  ];

  return positions;
}

// Collect bounding boxes of all visible entries on the canvas
function getExistingEntryBounds(excludeSourceId) {
  const bounds = [];
  entries.forEach((ed, id) => {
    if (id === 'anchor' || id === excludeSourceId) return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    if (!ed.element || ed.element.style.display === 'none') return;
    const x = ed.position?.x ?? (parseFloat(ed.element.style.left) || 0);
    const y = ed.position?.y ?? (parseFloat(ed.element.style.top) || 0);
    const w = ed.element.offsetWidth || 160;
    const h = ed.element.offsetHeight || 40;
    bounds.push({ x, y, w, h });
  });
  return bounds;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad) {
  return ax < bx + bw + pad && ax + aw + pad > bx &&
         ay < by + bh + pad && ay + ah + pad > by;
}

// Push a position away from all existing entries and other new positions
function resolveCollisions(positions, sourceEntryId) {
  const existing = getExistingEntryBounds(sourceEntryId);
  const pad = 20; // minimum gap between any two cards

  // Collect all new cards with their dimensions
  const cards = [];
  (positions.facts || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.fact, dir: 'down' }));
  (positions.web || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.web, dir: 'down' }));
  (positions.images || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.image, dir: 'down' }));
  (positions.followUps || []).forEach(p => cards.push({ pos: p, ...CARD_DIMS.followup, dir: 'up' }));

  // Multiple passes to resolve
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      // Check against existing entries
      for (const b of existing) {
        if (rectsOverlap(c.pos.x, c.pos.y, c.w, c.h, b.x, b.y, b.w, b.h, pad)) {
          // Push in the card's primary direction
          if (c.dir === 'down') c.pos.y = b.y + b.h + pad;
          else c.pos.y = b.y - c.h - pad;
        }
      }
      // Check against other new cards
      for (let j = 0; j < i; j++) {
        const o = cards[j];
        if (rectsOverlap(c.pos.x, c.pos.y, c.w, c.h, o.pos.x, o.pos.y, o.w, o.h, pad)) {
          if (c.dir === 'down') c.pos.y = o.pos.y + o.h + pad;
          else c.pos.y = o.pos.y - c.h - pad;
        }
      }
    }
  }
}

// ——— Research v2: SVG Connection Lines ———

function drawResearchLine(svg, sourceId, targetId) {
  const sourceData = entries.get(sourceId);
  const targetData = entries.get(targetId);
  if (!sourceData?.element || !targetData?.element) return;

  const sEl = sourceData.element;
  const tEl = targetData.element;
  const sx = (parseFloat(sEl.style.left) || 0) + (sEl.offsetWidth || 0) / 2;
  const sy = (parseFloat(sEl.style.top) || 0) + (sEl.offsetHeight || 0) / 2;
  const tx = (parseFloat(tEl.style.left) || 0) + (tEl.offsetWidth || 0) / 2;
  const ty = (parseFloat(tEl.style.top) || 0) + (tEl.offsetHeight || 0) / 2;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', sx);
  line.setAttribute('y1', sy);
  line.setAttribute('x2', tx);
  line.setAttribute('y2', ty);
  line.classList.add('research-connection');
  line.dataset.sourceId = sourceId;
  line.dataset.targetId = targetId;
  svg.appendChild(line);
}

function clearResearchLines(sourceId) {
  const svg = document.getElementById('research-lines');
  if (!svg) return;
  const lines = svg.querySelectorAll(`line[data-source-id="${sourceId}"]`);
  lines.forEach(l => l.remove());
}

function updateResearchLinePositions(entryId) {
  const svg = document.getElementById('research-lines');
  if (!svg) return;
  // Update lines where this entry is source or target
  const lines = svg.querySelectorAll(`line[data-source-id="${entryId}"], line[data-target-id="${entryId}"]`);
  lines.forEach(line => {
    const sId = line.dataset.sourceId;
    const tId = line.dataset.targetId;
    const sData = entries.get(sId);
    const tData = entries.get(tId);
    if (!sData?.element || !tData?.element) { line.remove(); return; }
    const sEl = sData.element;
    const tEl = tData.element;
    line.setAttribute('x1', (parseFloat(sEl.style.left) || 0) + (sEl.offsetWidth || 0) / 2);
    line.setAttribute('y1', (parseFloat(sEl.style.top) || 0) + (sEl.offsetHeight || 0) / 2);
    line.setAttribute('x2', (parseFloat(tEl.style.left) || 0) + (tEl.offsetWidth || 0) / 2);
    line.setAttribute('y2', (parseFloat(tEl.style.top) || 0) + (tEl.offsetHeight || 0) / 2);
  });
}

// ——— Research v2: Skeleton Placeholders ———

function createResearchPlaceholder(pos, sizeClass) {
  const el = document.createElement('div');
  el.className = `research-placeholder ${sizeClass || ''}`;
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  world.appendChild(el);
  return el;
}

// ——— Research v2: Main Orchestrator ———

async function spawnResearchEntries(sourceEntryId) {
  if (!researchModeEnabled || isReadOnly || researchGenerating) return;
  if (researchedEntries.has(sourceEntryId)) return;

  const entryData = entries.get(sourceEntryId);
  if (!entryData || !entryData.text || entryData.text.trim().length < 5) return;

  researchGenerating = true;
  researchedEntries.add(sourceEntryId);
  if (entryData.element) entryData.element.classList.add('research-generating');

  const positions = computeResearchLayout(sourceEntryId);
  resolveCollisions(positions, sourceEntryId);

  // Show skeleton placeholders at all positions with staggered timing
  const skeletons = [];
  let skeletonDelay = 0;
  const addSkeleton = (pos, cls) => {
    setTimeout(() => {
      skeletons.push(createResearchPlaceholder(pos, cls));
    }, skeletonDelay);
    skeletonDelay += 80;
  };
  (positions.facts || []).forEach(p => addSkeleton(p, 'research-skeleton-fact'));
  (positions.web || []).forEach(p => addSkeleton(p, 'research-skeleton-web'));
  (positions.images || []).forEach(p => addSkeleton(p, 'research-skeleton-image'));
  (positions.followUps || []).forEach(p => addSkeleton(p, 'research-skeleton-followup'));

  const thoughtChain = buildThoughtChain(sourceEntryId);
  const canvasContext = [];
  const existingFacts = [];
  entries.forEach((ed) => {
    if (ed.id === 'anchor' || ed.id === sourceEntryId) return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    canvasContext.push({ text: ed.text });
    // Collect existing research facts to avoid repetition
    if (ed.mediaCardData && (ed.mediaCardData.researchCardType === 'fact' || ed.mediaCardData.researchCardType === 'answer')) {
      existingFacts.push(ed.text);
    }
  });

  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thoughtChain, canvasContext, existingFacts })
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    await placeResearchResults(sourceEntryId, data, positions, skeletons);
  } catch (err) {
    console.error('[RESEARCH] v2 failed, trying legacy endpoint:', err);
    // Fallback to old endpoint
    try {
      const res = await fetch('/api/research-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thoughtChain, canvasContext })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.entries && data.entries.length > 0) {
          // Legacy placement: use old 4-position radial layout
          const legacyPositions = computeLegacyResearchPositions(sourceEntryId);
          await placeLegacyResearchEntries(sourceEntryId, data.entries, legacyPositions, skeletons);
        }
      }
    } catch (e2) {
      console.error('[RESEARCH] Legacy fallback also failed:', e2);
    }
  } finally {
    skeletons.forEach(s => { if (s.parentNode) s.remove(); });
    researchGenerating = false;
    if (entryData.element) entryData.element.classList.remove('research-generating');
  }
}

// Legacy 4-position layout for fallback
function computeLegacyResearchPositions(sourceEntryId) {
  const sourceData = entries.get(sourceEntryId);
  if (!sourceData || !sourceData.element) return [];
  const el = sourceData.element;
  const srcX = parseFloat(el.style.left) || 0;
  const srcY = parseFloat(el.style.top) || 0;
  const srcW = el.offsetWidth || 160;
  const srcH = el.offsetHeight || 40;
  const cx = srcX + srcW / 2;
  const cy = srcY + srcH / 2;
  const radius = 340;
  const entryW = 200;
  const entryH = 80;
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return angles.map(angle => ({
    x: cx + radius * Math.cos(angle) - entryW / 2,
    y: cy + radius * Math.sin(angle) - entryH / 2,
  }));
}

async function placeLegacyResearchEntries(sourceEntryId, textEntries, positions, skeletons) {
  const svg = document.getElementById('research-lines');
  for (let i = 0; i < Math.min(textEntries.length, positions.length); i++) {
    const text = textEntries[i];
    if (!text || typeof text !== 'string') continue;
    if (skeletons[i] && skeletons[i].parentNode) skeletons[i].remove();
    const pos = positions[i];
    const entryId = generateEntryId();
    const entry = document.createElement('div');
    entry.className = 'entry melt';
    entry.id = entryId;
    entry.style.left = `${pos.x}px`;
    entry.style.top = `${pos.y}px`;
    entry.innerHTML = meltify(text);
    applyEntryFontSize(entry, null);
    world.appendChild(entry);
    setTimeout(() => updateEntryDimensions(entry), 50);
    const entryDataObj = {
      id: entryId, element: entry, text, textHtml: null, latexData: null,
      position: { x: pos.x, y: pos.y }, parentEntryId: currentViewEntryId
    };
    entries.set(entryId, entryDataObj);
    researchChainMap.set(entryId, sourceEntryId);
    updateEntryVisibility();
    await saveEntryToServer(entryDataObj);
    if (svg) drawResearchLine(svg, sourceEntryId, entryId);
    setTimeout(() => {
      entry.classList.remove('melt');
      entry.querySelectorAll('span').forEach(s => {
        s.style.animation = 'none'; s.style.transform = ''; s.style.filter = ''; s.style.opacity = '';
      });
      updateEntryDimensions(entry);
    }, 1500);
  }
}

async function placeResearchResults(sourceEntryId, data, positions, skeletons) {
  const svg = document.getElementById('research-lines');
  const childIds = [];
  let skeletonIdx = 0;
  let placeDelay = 0;

  const placeOne = async (pos, text, cardType, extraMediaData) => {
    // Remove corresponding skeleton
    if (skeletons[skeletonIdx] && skeletons[skeletonIdx].parentNode) skeletons[skeletonIdx].remove();
    skeletonIdx++;

    await new Promise(r => setTimeout(r, placeDelay));
    placeDelay += 120;

    const entryId = generateEntryId();
    const entry = document.createElement('div');
    entry.className = 'entry research-entry';
    entry.id = entryId;
    entry.style.left = `${pos.x}px`;
    entry.style.top = `${pos.y}px`;

    const mediaCardData = { researchCardType: cardType, ...extraMediaData };

    // Build entry data object
    const entryDataObj = {
      id: entryId, element: entry, text, textHtml: null, latexData: null,
      position: { x: pos.x, y: pos.y }, parentEntryId: currentViewEntryId,
      mediaCardData
    };
    entries.set(entryId, entryDataObj);

    // Render the card
    renderResearchCard(entry, entryDataObj);

    world.appendChild(entry);
    setTimeout(() => updateEntryDimensions(entry), 50);

    researchChainMap.set(entryId, sourceEntryId);
    childIds.push(entryId);

    updateEntryVisibility();
    await saveEntryToServer(entryDataObj);

    if (svg) {
      setTimeout(() => drawResearchLine(svg, sourceEntryId, entryId), 50);
    }

    return entryId;
  };

  // Place fact cards
  const facts = data.facts || [];
  const factPositions = positions.facts || [];
  for (let i = 0; i < Math.min(facts.length, factPositions.length); i++) {
    await placeOne(factPositions[i], facts[i], 'fact', {});
  }

  // Place web results
  const webResults = data.webResults || [];
  const webPositions = positions.web || [];
  for (let i = 0; i < Math.min(webResults.length, webPositions.length); i++) {
    const wr = webResults[i];
    await placeOne(webPositions[i], wr.title || '', 'web', {
      webResultData: { title: wr.title, link: wr.link, snippet: wr.snippet, favicon: wr.favicon }
    });
  }

  // Place images
  const images = data.images || [];
  const imgPositions = positions.images || [];
  for (let i = 0; i < Math.min(images.length, imgPositions.length); i++) {
    const img = images[i];
    await placeOne(imgPositions[i], img.alt || '', 'image', {
      imageData: { url: img.url, alt: img.alt, photographer: img.photographer }
    });
  }

  // Place follow-ups
  const followUps = data.followUps || [];
  const fuPositions = positions.followUps || [];
  for (let i = 0; i < Math.min(followUps.length, fuPositions.length); i++) {
    await placeOne(fuPositions[i], followUps[i], 'followup', {});
  }

  researchChildrenMap.set(sourceEntryId, childIds);
}
