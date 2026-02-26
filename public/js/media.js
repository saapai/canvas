// media.js — Image compression, file uploads, and media utility functions

// Compress image files client-side to stay under Vercel's 4.5MB body limit
const MAX_UPLOAD_SIZE = 4 * 1024 * 1024; // 4MB target (leave headroom)
async function compressImageFile(file) {
  if (file.size <= MAX_UPLOAD_SIZE) return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      // Scale down to fit within reasonable dimensions
      const maxDim = 2048;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Try quality levels until under size limit
      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= MAX_UPLOAD_SIZE || quality <= 0.3) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            quality -= 0.15;
            tryCompress();
          }
        }, 'image/jpeg', quality);
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Drag-and-drop files onto canvas
viewport.addEventListener('dragover', (e) => {
  if(isReadOnly) return;
  if(e.dataTransfer.types.includes('Files')){
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
viewport.addEventListener('drop', async (e) => {
  if(isReadOnly) return;
  if(!e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  e.stopPropagation();

  // Check if dropped onto an existing deadline table on the canvas
  const targetTable = e.target.closest ? e.target.closest('.deadline-table') : null;
  const targetEntry = targetTable ? targetTable.closest('.entry') : null;
  if (targetTable && targetEntry && !targetTable.closest('#editor')) {
    const allFiles = Array.from(e.dataTransfer.files);
    await extractDeadlinesIntoEntry(targetEntry, targetTable, allFiles);
    return;
  }

  const files = Array.from(e.dataTransfer.files);
  if(!files.length) return;

  const baseWorldPos = screenToWorld(e.clientX, e.clientY);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const offset = files.length > 1 ? goldenAngleSpiralPosition(i, 60) : { x: 0, y: 0 };
    const pos = { x: baseWorldPos.x + offset.x, y: baseWorldPos.y + offset.y };

    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImageFile(file);
        const form = new FormData();
        form.append('file', compressed);
        const res = await fetch('/api/upload-image', { method: 'POST', credentials: 'include', body: form });
        if(!res.ok){
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Upload failed');
        }
        const { url } = await res.json();
        await createImageEntryAtWorld(pos.x, pos.y, url);
      } catch(err){
        console.error('Image upload failed:', err);
      }
    } else {
      await createFileEntryAtWorld(pos.x, pos.y, file);
    }
  }
});

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimetype) {
  if (mimetype === 'application/pdf') return '📄';
  if (mimetype.includes('word') || mimetype.includes('document')) return '📝';
  if (mimetype.includes('sheet') || mimetype.includes('csv')) return '📊';
  if (mimetype.includes('presentation')) return '📽';
  if (mimetype.startsWith('text/')) return '📃';
  return '📎';
}

async function createFileEntryAtWorld(worldX, worldY, file) {
  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = 'entry canvas-file';
  entry.id = entryId;
  entry.style.left = `${worldX}px`;
  entry.style.top = `${worldY}px`;
  // Show placeholder while uploading
  entry.innerHTML = `<div class="file-card"><div class="file-card-icon">${getFileIcon(file.type)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(file.name)}</div><div class="file-card-meta">Uploading...</div></div></div>`;
  world.appendChild(entry);

  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload-file', { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    const data = await res.json();
    const mediaData = { type: 'file', url: data.url, name: data.name, size: data.size, mimetype: data.mimetype };

    entry.innerHTML = '';
    entry.appendChild(createFileCard(mediaData));
    updateEntryDimensions(entry);

    const entryData = {
      id: entryId,
      element: entry,
      text: data.name,
      position: { x: worldX, y: worldY },
      parentEntryId: currentViewEntryId,
      mediaCardData: mediaData
    };
    entries.set(entryId, entryData);
    updateEntryVisibility();
    await saveEntryToServer(entryData);
  } catch (err) {
    console.error('File upload failed:', err);
    entry.remove();
  }
}

function createFileCard(mediaData) {
  const card = document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = `<div class="file-card-icon">${getFileIcon(mediaData.mimetype || '')}</div>
    <div class="file-card-info"><div class="file-card-name">${escapeHtml(mediaData.name || 'File')}</div><div class="file-card-meta">${formatFileSize(mediaData.size || 0)}</div></div>
    <div class="file-card-actions">
      <a class="file-action-btn" href="${escapeHtml(mediaData.url)}" target="_blank" title="View"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
      <a class="file-action-btn" href="${escapeHtml(mediaData.url)}" download="${escapeHtml(mediaData.name || 'file')}" title="Download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
    </div>`;
  // Prevent clicks on action buttons from triggering entry editing
  card.querySelectorAll('.file-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => e.stopPropagation());
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
  });
  return card;
}

async function extractDeadlinesIntoEntry(entryEl, table, files) {
  // Accept a single file or array of files
  const fileList = Array.isArray(files) ? files : [files];
  entryEl.classList.add('deadline-extracting');

  const promises = fileList.map(file => extractFileIntoTable(table, file));
  await Promise.allSettled(promises);

  entryEl.classList.remove('deadline-extracting');

  // Save updated entry
  const entryData = entries.get(entryEl.id);
  if (entryData) {
    entryData.text = entryEl.innerText;
    entryData.textHtml = entryEl.innerHTML;
    await updateEntryOnServer(entryData);
  }
}

requestAnimationFrame(() => {
  centerAnchor();
  // Show cursor after initial setup
  if (!isReadOnly) {
    setTimeout(() => {
      showCursorInDefaultPosition();
    }, 100);
  }
});

// Handle browser back/forward buttons
window.addEventListener('popstate', (event) => {
  if (window.PAGE_USERNAME) {
    // Extract path from URL
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    if (pathParts.length === 1 && pathParts[0] === window.PAGE_USERNAME) {
      // At root of user page
      navigateToRoot();
    } else if (pathParts.length > 1) {
      // Navigate to the entry based on the URL path
      const slugPath = pathParts.slice(1); // Remove username

      // If we have saved state, use it
      if (event.state && event.state.navigationStack) {
        navigationStack = [...event.state.navigationStack];
        currentViewEntryId = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;
        updateBreadcrumb();
        updateEntryVisibility();
      } else {
        // Otherwise, reconstruct navigation from path
        let currentParent = null;
        navigationStack = [];

        for (const slug of slugPath) {
          const children = Array.from(entries.values()).filter(e => e.parentEntryId === currentParent);
          const targetEntry = children.find(e => {
            // Pass full entry data to generateEntrySlug to handle media cards
            const entrySlug = generateEntrySlug(e.text, e);
            return entrySlug === slug;
          });

          if (targetEntry) {
            navigationStack.push(targetEntry.element.id);
            currentParent = targetEntry.element.id;
          } else {
            break;
          }
        }

        currentViewEntryId = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;
        updateBreadcrumb();
        updateEntryVisibility();

        // Recalculate dimensions and zoom after popstate navigation
        setTimeout(() => {
          entries.forEach((entryData, entryId) => {
            if (entryId === 'anchor') return;
            const entry = entryData.element;
            if (entry && entry.style.display !== 'none') {
              updateEntryDimensions(entry);
            }
          });

          requestAnimationFrame(() => {
            zoomToFitEntries();
          });
        }, 100);
      }
    }
  }
});

// ——— Simplex 2D Noise (deterministic, no dependencies) ———
const _organizeNoise = (function() {
  const perm = new Uint8Array(512);
  const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  let s = 42;
  function rng() { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; }
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function(x, y) {
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
  };
})();

// ——— HSL color distance with hue wraparound ———
function _colorDist(a, b) {
  const dH = Math.min(Math.abs(a.hue - b.hue), 360 - Math.abs(a.hue - b.hue)) / 180;
  const dS = Math.abs((a.sat || 0) / 100 - (b.sat || 0) / 100);
  const dL = Math.abs((a.lum || 50) / 100 - (b.lum || 50) / 100);
  return Math.sqrt(dH * dH * 4.0 + dS * dS * 1.0 + dL * dL * 0.5);
}
