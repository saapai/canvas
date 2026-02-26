// organize.js — Canvas layout organization and entry alignment

// ——— Organize Canvas Layout: Force-directed + Multi-spiral ———
async function organizeCanvasLayout() {
  const organizeBtn = document.getElementById('organize-button');
  if (organizeBtn) organizeBtn.classList.add('organizing');

  try {
    console.log('[ORGANIZE] Starting organizeCanvasLayout');
    // Step 1: Collect visible entries
    const visibleEntries = Array.from(entries.values()).filter(e => {
      if (e.id === 'anchor') return false;
      return e.element && e.element.style.display !== 'none';
    });
    console.log('[ORGANIZE] Visible entries:', visibleEntries.length);
    if (visibleEntries.length === 0) {
      console.log('[ORGANIZE] No visible entries, returning');
      return;
    }

    // Step 2: Measure each entry and extract dominant color
    // Batch getBoundingClientRect to minimize forced reflows
    const rects = visibleEntries.map(ed => ed.element.getBoundingClientRect());
    const items = [];
    const linkColorPromises = [];
    for (let idx = 0; idx < visibleEntries.length; idx++) {
      const ed = visibleEntries[idx];
      const el = ed.element;
      const rect = rects[idx];
      const w = rect.width / cam.z;
      const h = rect.height / cam.z;
      let hue = 0, sat = 0, lum = 50;
      let hasColor = false;
      let type = 'text';

      if (el.classList.contains('canvas-image')) {
        type = 'image';
        const img = el.querySelector('img');
        if (img && img.complete && img.naturalWidth > 0) {
          const hsl = extractDominantHSL(img);
          hue = hsl.h; sat = hsl.s; lum = hsl.l; hasColor = true;
        }
      } else if (el.querySelector('.link-card')) {
        type = 'link';
        const thumb = el.querySelector('.link-card-image, .link-card-yt-thumb');
        if (thumb) {
          const bg = thumb.style.backgroundImage;
          const urlMatch = bg && bg.match(/url\(["']?(.+?)["']?\)/);
          if (urlMatch) {
            // Collect promise — resolve all link colors in parallel below
            linkColorPromises.push({ idx: items.length, src: urlMatch[1] });
          }
        }
      } else if (el.querySelector('.media-card')) {
        type = 'media';
      }

      // Store positions as centers (not top-left) for correct overlap math
      const topLeftX = parseFloat(el.style.left) || 0;
      const topLeftY = parseFloat(el.style.top) || 0;
      items.push({
        id: ed.id, element: el, data: ed, w, h, type,
        hue, sat, lum, hasColor,
        oldX: topLeftX + w / 2,
        oldY: topLeftY + h / 2,
        x: 0, y: 0, vx: 0, vy: 0
      });
    }
    // Resolve all link-card colors in parallel
    if (linkColorPromises.length > 0) {
      const results = await Promise.allSettled(
        linkColorPromises.map(p => loadImageForColor(p.src).then(img => ({ idx: p.idx, hsl: extractDominantHSL(img) })))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const item = items[r.value.idx];
          item.hue = r.value.hsl.h; item.sat = r.value.hsl.s; item.lum = r.value.hsl.l; item.hasColor = true;
        }
      }
    }

    const n = items.length;
    console.log('[ORGANIZE] Items measured:', n);
    if (n === 0) {
      console.log('[ORGANIZE] No items after measurement, returning');
      return;
    }

    // Step 3: Cluster by color similarity using simple greedy clustering
    // Group items whose colors are within threshold into the same cluster
    const COLOR_THRESHOLD = 0.45;
    const clusters = [];
    const assigned = new Set();
    // Sort items with color first, then without
    const colorItems = items.filter(m => m.hasColor).sort((a, b) => a.hue - b.hue);
    const noColorItems = items.filter(m => !m.hasColor);

    for (const item of colorItems) {
      if (assigned.has(item.id)) continue;
      const cluster = [item];
      assigned.add(item.id);
      for (const other of colorItems) {
        if (assigned.has(other.id)) continue;
        if (_colorDist(item, other) < COLOR_THRESHOLD) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }
      clusters.push(cluster);
    }
    // Non-color items form their own cluster
    if (noColorItems.length > 0) {
      clusters.push(noColorItems);
      noColorItems.forEach(m => assigned.add(m.id));
    }

    // Step 4–6: Heavy packing computation — run in Web Worker to avoid UI freeze
    console.log('[ORGANIZE] Clusters:', clusters.length, 'sizes:', clusters.map(c => c.length));
    const vpRect = viewport.getBoundingClientRect();
    const center = screenToWorld(vpRect.width / 2, vpRect.height / 2);
    const avgDiag = items.reduce((s, m) => s + Math.sqrt(m.w * m.w + m.h * m.h), 0) / n;
    const PAD = 22;

    // Serialize item data for the worker (no DOM refs)
    const workerItems = items.map(it => ({ id: it.id, w: it.w, h: it.h, oldX: it.oldX, oldY: it.oldY }));

    const positions = await new Promise((resolve, reject) => {
      const workerCode = `
        self.onmessage = function(e) {
          const { items, center, PAD, avgDiag } = e.data;
          const n = items.length;
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));

          // Inline simplex noise
          const perm = new Uint8Array(512);
          const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
          let s = 42;
          function rng() { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; }
          const p = Array.from({ length: 256 }, (_, i) => i);
          for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
          for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
          const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
          function noise(x, y) {
            const sk = (x + y) * F2, i = Math.floor(x + sk), j = Math.floor(y + sk);
            const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
            const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
            const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
            const ii = i & 255, jj = j & 255;
            const gi0 = perm[ii + perm[jj]] % 8, gi1 = perm[ii + i1 + perm[jj + j1]] % 8, gi2 = perm[ii + 1 + perm[jj + 1]] % 8;
            let n0 = 0, n1 = 0, n2 = 0;
            let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(grad[gi0][0]*x0+grad[gi0][1]*y0); }
            let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(grad[gi1][0]*x1+grad[gi1][1]*y1); }
            let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(grad[gi2][0]*x2+grad[gi2][1]*y2); }
            return 70 * (n0 + n1 + n2);
          }

          // Sort by area descending
          items.sort((a, b) => (b.w * b.h) - (a.w * a.h));

          // Place first item at center
          items[0].x = center.x;
          items[0].y = center.y;

          // Greedy tight-packing
          for (let i = 1; i < n; i++) {
            const item = items[i];
            let bestX = center.x, bestY = center.y, bestScore = Infinity;
            const angleOffset = i * goldenAngle;
            for (let j = 0; j < i; j++) {
              const p = items[j];
              const gapX = p.w / 2 + item.w / 2 + PAD;
              const gapY = p.h / 2 + item.h / 2 + PAD;
              for (let a = 0; a < 20; a++) {
                const angle = angleOffset + (a / 20) * Math.PI * 2;
                const dx = Math.cos(angle), dy = Math.sin(angle);
                const tX = Math.abs(dx) > 0.01 ? gapX / Math.abs(dx) : 1e9;
                const tY = Math.abs(dy) > 0.01 ? gapY / Math.abs(dy) : 1e9;
                const t = Math.min(tX, tY);
                const cx = p.x + t * dx, cy = p.y + t * dy;
                let valid = true;
                for (let k = 0; k < i; k++) {
                  if ((item.w/2 + items[k].w/2 + PAD) - Math.abs(cx - items[k].x) > 0 &&
                      (item.h/2 + items[k].h/2 + PAD) - Math.abs(cy - items[k].y) > 0) {
                    valid = false; break;
                  }
                }
                if (valid) {
                  const dist = Math.sqrt((cx - center.x) ** 2 + (cy - center.y) ** 2);
                  const noiseBias = noise(i * 2.7 + a * 0.4, j * 1.9) * avgDiag * 0.35;
                  const jitter = (Math.random() - 0.5) * avgDiag * 0.3;
                  const score = dist + noiseBias + jitter;
                  if (score < bestScore) { bestScore = score; bestX = cx; bestY = cy; }
                }
              }
            }
            if (bestScore === Infinity) {
              const angle = i * goldenAngle;
              const radius = avgDiag * 0.5 * Math.sqrt(i);
              bestX = center.x + radius * Math.cos(angle);
              bestY = center.y + radius * Math.sin(angle);
            }
            item.x = bestX; item.y = bestY;
          }

          // Overlap resolution — push overlapping items apart
          for (let pass = 0; pass < 30; pass++) {
            let hasOverlap = false;
            for (let i = 0; i < n; i++) {
              for (let j = i + 1; j < n; j++) {
                const ox = (items[i].w/2 + items[j].w/2 + PAD) - Math.abs(items[i].x - items[j].x);
                const oy = (items[i].h/2 + items[j].h/2 + PAD) - Math.abs(items[i].y - items[j].y);
                if (ox > 0 && oy > 0) {
                  hasOverlap = true;
                  const ai = items[i].w * items[i].h || 1, aj = items[j].w * items[j].h || 1;
                  const total = ai + aj, wi = aj / total, wj = ai / total;
                  // Push apart by 110% of overlap to escape deadlocks
                  const push = 1.1;
                  if (ox < oy) {
                    const sign = items[i].x > items[j].x ? 1 : (items[i].x < items[j].x ? -1 : (Math.random() > 0.5 ? 1 : -1));
                    items[i].x += sign * ox * wi * push; items[j].x -= sign * ox * wj * push;
                  } else {
                    const sign = items[i].y > items[j].y ? 1 : (items[i].y < items[j].y ? -1 : (Math.random() > 0.5 ? 1 : -1));
                    items[i].y += sign * oy * wi * push; items[j].y -= sign * oy * wj * push;
                  }
                }
              }
            }
            if (!hasOverlap) break;
          }

          // Re-center on viewport
          let cx2 = 0, cy2 = 0;
          for (let i = 0; i < n; i++) { cx2 += items[i].x; cy2 += items[i].y; }
          cx2 /= n; cy2 /= n;
          const sx = center.x - cx2, sy = center.y - cy2;
          for (let i = 0; i < n; i++) { items[i].x += sx; items[i].y += sy; }

          self.postMessage(items.map(it => ({ id: it.id, x: it.x, y: it.y })));
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      worker.onmessage = (e) => { URL.revokeObjectURL(url); worker.terminate(); resolve(e.data); };
      worker.onerror = (e) => { URL.revokeObjectURL(url); worker.terminate(); reject(e); };
      worker.postMessage({ items: workerItems, center, PAD, avgDiag });
    });
    console.log('[ORGANIZE] Worker computed positions for', positions.length, 'items');

    // Map worker results back to items
    const posMap = new Map(positions.map(p => [p.id, p]));
    for (const item of items) {
      const pos = posMap.get(item.id);
      if (pos) { item.x = pos.x; item.y = pos.y; }
    }

    // Step 7: Animate using CSS transitions (GPU-accelerated, no rAF jank)
    for (const item of items) {
      item.element.style.transition = 'left 0.7s cubic-bezier(0.22, 1, 0.36, 1), top 0.7s cubic-bezier(0.22, 1, 0.36, 1)';
    }
    // Force a style flush so transitions apply from current positions
    void items[0].element.offsetLeft;
    for (const item of items) {
      const newLeft = item.x - item.w / 2;
      const newTop = item.y - item.h / 2;
      item.element.style.left = `${newLeft}px`;
      item.element.style.top = `${newTop}px`;
      item.data.position = { x: newLeft, y: newTop };
    }
    // Clean up transitions after animation completes
    await new Promise(resolve => setTimeout(resolve, 750));
    for (const item of items) {
      item.element.style.transition = '';
    }
    console.log('[ORGANIZE] Animation complete');

    // Step 8: Batch save positions (convert centers to top-left for storage)
    // IMPORTANT: include all entry metadata to prevent ON CONFLICT from wiping it
    const entriesToSave = items.map(item => ({
      id: item.id,
      text: item.data.text,
      position: { x: item.x - item.w / 2, y: item.y - item.h / 2 },
      parentEntryId: item.data.parentEntryId || null,
      mediaCardData: item.data.mediaCardData || null,
      linkCardsData: item.data.linkCardsData || null,
      latexData: item.data.latexData || null
    }));
    try {
      await fetch('/api/entries/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave, pageOwnerId: window.PAGE_OWNER_ID })
      });
    } catch (err) {
      console.error('[ORGANIZE] Error saving organized positions:', err);
    }
    console.log('[ORGANIZE] Batch save sent for', entriesToSave.length, 'entries');

    // Step 9: Zoom to fit
    console.log('[ORGANIZE] Calling zoomToFitEntries');
    setTimeout(() => zoomToFitEntries(), 150);

  } catch (err) {
    console.error('[ORGANIZE] Error during organize:', err);
  } finally {
    if (organizeBtn) organizeBtn.classList.remove('organizing');
    console.log('[ORGANIZE] Done');
  }
}

function extractDominantHSL(img) {
  try {
    const c = document.createElement('canvas');
    const size = 32;
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
      rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; count++;
    }
    const r = rSum / count / 255, g = gSum / count / 255, b = bSum / count / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  } catch(e) { return { h: 0, s: 0, l: 50 }; }
}

function loadImageForColor(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Gentle alignment algorithm - local, visual-only refinement
async function organizeEntriesIntoHubs() {
  // Get all visible entries (current view level)
  const visibleEntries = Array.from(entries.values()).filter(e => {
    if (e.id === 'anchor') return false;
    const entry = e.element;
    return entry && entry.style.display !== 'none';
  });

  if (visibleEntries.length === 0) return;

  // Get viewport bounds in world coordinates
  const viewportRect = viewport.getBoundingClientRect();
  const margin = 0.2; // 20% margin
  const marginX = viewportRect.width * margin;
  const marginY = viewportRect.height * margin;

  // Convert viewport bounds to world coordinates
  // Viewport screen coordinates (0,0) to (width, height) map to world coordinates
  const topLeft = screenToWorld(-marginX, -marginY);
  const bottomRight = screenToWorld(viewportRect.width + marginX, viewportRect.height + marginY);

  // Filter entries to only those in viewport + margin
  const localEntries = visibleEntries.filter(e => {
    const pos = e.position || { x: 0, y: 0 };
    return pos.x >= topLeft.x && pos.x <= bottomRight.x &&
           pos.y >= topLeft.y && pos.y <= bottomRight.y;
  });

  if (localEntries.length < 4) return; // Need at least 4 entries to form a group

  // Step 1: Detect local neighborhoods (purely spatial)
  const NEIGHBOR_RADIUS = 400;
  const groups = [];
  const processed = new Set();

  localEntries.forEach(entry => {
    if (processed.has(entry.id)) return;

    const entryPos = entry.position || { x: 0, y: 0 };
    const neighbors = localEntries.filter(other => {
      if (other.id === entry.id || processed.has(other.id)) return false;
      const otherPos = other.position || { x: 0, y: 0 };
      const dx = otherPos.x - entryPos.x;
      const dy = otherPos.y - entryPos.y;
      return Math.sqrt(dx * dx + dy * dy) <= NEIGHBOR_RADIUS;
    });

    if (neighbors.length >= 4) {
      const group = [entry, ...neighbors];
      groups.push(group);
      group.forEach(e => processed.add(e.id));
    }
  });

  if (groups.length === 0) return;

  // Step 2: Infer natural alignment axis using PCA for each group
  const alignedEntries = [];

  groups.forEach(group => {
    if (group.length < 4) return;

    // Get positions
    const positions = group.map(e => {
      const pos = e.position || { x: 0, y: 0 };
      return [pos.x, pos.y];
    });

    // Compute centroid
    const centroid = [
      positions.reduce((sum, p) => sum + p[0], 0) / positions.length,
      positions.reduce((sum, p) => sum + p[1], 0) / positions.length
    ];

    // Center positions
    const centered = positions.map(p => [p[0] - centroid[0], p[1] - centroid[1]]);

    // Compute covariance matrix
    const cov = [
      [0, 0],
      [0, 0]
    ];

    centered.forEach(p => {
      cov[0][0] += p[0] * p[0];
      cov[0][1] += p[0] * p[1];
      cov[1][0] += p[1] * p[0];
      cov[1][1] += p[1] * p[1];
    });

    const n = centered.length;
    cov[0][0] /= n;
    cov[0][1] /= n;
    cov[1][0] /= n;
    cov[1][1] /= n;

    // Compute eigenvalues and eigenvectors (simplified 2x2 PCA)
    const trace = cov[0][0] + cov[1][1];
    const det = cov[0][0] * cov[1][1] - cov[0][1] * cov[1][0];
    const discriminant = trace * trace - 4 * det;

    if (discriminant < 0) return; // Skip if degenerate

    const sqrtDisc = Math.sqrt(discriminant);
    const eigenval1 = (trace + sqrtDisc) / 2;
    const eigenval2 = (trace - sqrtDisc) / 2;

    // Get dominant eigenvector (larger eigenvalue)
    let dominantDir;
    if (Math.abs(eigenval1) > Math.abs(eigenval2)) {
      // Solve (cov - eigenval1 * I) * v = 0
      const a = cov[0][0] - eigenval1;
      const b = cov[0][1];
      if (Math.abs(b) > 0.001) {
        dominantDir = [1, -a / b];
      } else {
        dominantDir = [0, 1];
      }
    } else {
      const a = cov[0][0] - eigenval2;
      const b = cov[0][1];
      if (Math.abs(b) > 0.001) {
        dominantDir = [1, -a / b];
      } else {
        dominantDir = [0, 1];
      }
    }

    // Normalize direction vector
    const dirLen = Math.sqrt(dominantDir[0] * dominantDir[0] + dominantDir[1] * dominantDir[1]);
    if (dirLen < 0.001) return;
    dominantDir[0] /= dirLen;
    dominantDir[1] /= dirLen;

    // Perpendicular direction
    const perpDir = [-dominantDir[1], dominantDir[0]];

    // POST-PROCESSING: Local Hub Decluttering & Alignment (MANDATORY)

    // Step A: Choose dominant layout axis per hub
    // Compute bounding box for group
    const xs = group.map(e => (e.position || { x: 0 }).x);
    const ys = group.map(e => (e.position || { y: 0 }).y);
    const bboxWidth = Math.max(...xs) - Math.min(...xs);
    const bboxHeight = Math.max(...ys) - Math.min(...ys);

    // Determine if horizontal or vertical alignment
    const isHorizontal = bboxWidth > bboxHeight;
    const layoutAxis = isHorizontal ? dominantDir : perpDir;
    const layoutPerp = isHorizontal ? perpDir : dominantDir;

    // Step B: Text-aware sizing
    const CHAR_WIDTH = 9; // Approximate character width in pixels
    const LINE_HEIGHT = 24; // Approximate line height

    const entryBboxes = group.map(e => {
      const text = e.text || '';
      const lines = text.split('\n');
      const maxLineLength = Math.max(...lines.map(l => l.length), 0);

      // Estimate dimensions
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

    // Step C: Order entries along the axis
    // Project onto layout axis and sort
    const projected = entryBboxes.map(bbox => ({
      ...bbox,
      projection: bbox.x * layoutAxis[0] + bbox.y * layoutAxis[1]
    }));

    projected.sort((a, b) => a.projection - b.projection);

    // Step D: Enforce minimum spacing (no overlap allowed)
    const MIN_GAP = 22; // Average of 18-28px
    const workingPositions = [];

    // Position first entry at its projected location
    let prevEnd = projected[0].projection;

    projected.forEach((bbox, index) => {
      let currentPos;

      if (index === 0) {
        // Keep first entry at original projection
        currentPos = bbox.projection;
      } else {
        // Ensure minimum spacing from previous entry
        const entrySize = isHorizontal ? bbox.width : bbox.height;
        const desiredPos = bbox.projection;
        const minPos = prevEnd + MIN_GAP;

        currentPos = Math.max(desiredPos, minPos);
      }

      // Calculate new world coordinates
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

    // Step E: Organic variation (small perpendicular jitter)
    const perpJitter = (Math.random() - 0.5) * 20; // 10-14px range, shared direction
    const perpJitterDir = Math.random() > 0.5 ? 1 : -1;

    workingPositions.forEach(pos => {
      const jitterAmount = (Math.random() * 6 + 8) * perpJitterDir; // 8-14px in same direction
      pos.x += layoutPerp[0] * jitterAmount;
      pos.y += layoutPerp[1] * jitterAmount;
    });

    // Step F: Movement caps
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

    // Step G: Animate over 700-900ms with ease-out
    const duration = 700 + Math.random() * 200;
    const startTime = performance.now();

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentX = startX + (endX - startX) * eased;
      const currentY = startY + (endY - startY) * eased;

      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Update stored position
        entryData.position = { x: endX, y: endY };
      }
    }

    requestAnimationFrame(animate);
  });

  // Save updated positions after animation completes
  setTimeout(async () => {
    const entriesToSave = alignedEntries.map(e => {
      const entryData = entries.get(e.id);
      return {
        id: e.id,
        text: entryData.text,
        position: e.position,
        parentEntryId: entryData.parentEntryId || null,
        mediaCardData: entryData.mediaCardData || null,
        linkCardsData: entryData.linkCardsData || null,
        latexData: entryData.latexData || null
      };
    });

    try {
      await fetch('/api/entries/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave, pageOwnerId: window.PAGE_OWNER_ID })
      });
    } catch (error) {
      console.error('Error saving aligned positions:', error);
    }
  }, 950); // Slightly after animation completes (max 900ms + buffer)
}
