// article.js — Google Calendar integration, Share UI, Shared pages, Live sync, and final initialization

// ——— Google Calendar Integration ———
const googleConnectBtn = document.getElementById('google-connect-btn');
const googleConnectLabel = document.getElementById('google-connect-label');
const googleConnectDesc = document.getElementById('google-connect-desc');

let gcalConnected = false;
let gcalCalendarSettings = {};

// Check Google connection on load
async function checkGoogleStatus() {
  try {
    const res = await fetch('/api/oauth/google/status', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    gcalConnected = data.connected;
    gcalCalendarSettings = data.calendarSettings || {};
    updateGoogleConnectButton();
    // Pre-fetch calendar data so new cards populate instantly
    if (gcalConnected) {
      fetchGcalCalendars();
      fetchGcalEventsForMonth(new Date());
    }
  } catch(e) { /* not connected */ }
}

function updateGoogleConnectButton() {
  if (!googleConnectLabel) return;
  const gcalCardBtn = document.querySelector('.gcal-card-btn');
  if (gcalConnected) {
    googleConnectLabel.innerHTML = 'Google Connected <span class="google-connected-badge"></span>';
    if (googleConnectDesc) googleConnectDesc.textContent = 'GCal, Sheets, Docs';
    if (gcalCardBtn) gcalCardBtn.classList.remove('hidden');
  } else {
    googleConnectLabel.textContent = 'Google Connection';
    if (googleConnectDesc) googleConnectDesc.textContent = 'GCal, Sheets, Docs';
    if (gcalCardBtn) gcalCardBtn.classList.add('hidden');
  }
}

async function handleGoogleConnection() {
  if (!currentUser) return;
  if (gcalConnected) return;
  try {
    const res = await fetch('/api/oauth/google/auth', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    window.location.href = data.url;
  } catch (e) {
    console.error('Google auth error:', e);
  }
}

function formatDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Post-OAuth redirect: clean URL and refresh connection status
if (window.location.search.includes('google=connected')) {
  const url = new URL(window.location);
  url.searchParams.delete('google');
  window.history.replaceState({}, '', url.pathname);
  setTimeout(() => checkGoogleStatus(), 500);
}

// ——— Collaborative editing: Share UI ———

const shareButton = document.getElementById('share-button');
const sharePopover = document.getElementById('share-popover');
const sharePopoverClose = document.getElementById('share-popover-close');
const sharePhoneInput = document.getElementById('share-phone-input');
const shareAddBtn = document.getElementById('share-add-btn');
const shareError = document.getElementById('share-error');
const shareEditorsList = document.getElementById('share-editors-list');

if (shareButton) {
  shareButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sharePopover) {
      sharePopover.classList.toggle('hidden');
      if (!sharePopover.classList.contains('hidden')) {
        loadEditorsList();
        setTimeout(() => { if (sharePhoneInput) sharePhoneInput.focus(); }, 50);
      }
    }
  });
}

if (sharePopoverClose) {
  sharePopoverClose.addEventListener('click', () => {
    if (sharePopover) sharePopover.classList.add('hidden');
  });
}

// Prevent clicks/mousedown inside popover from bubbling to viewport (fixes input focus stealing)
if (sharePopover) {
  sharePopover.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  sharePopover.addEventListener('mouseup', (e) => {
    e.stopPropagation();
  });
  sharePopover.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

// Close popover when clicking outside
document.addEventListener('mousedown', (e) => {
  if (sharePopover && !sharePopover.classList.contains('hidden') &&
      !sharePopover.contains(e.target) && e.target !== shareButton) {
    sharePopover.classList.add('hidden');
  }
});

async function loadEditorsList() {
  if (!shareEditorsList) return;
  try {
    const res = await fetch('/api/editors/list', { credentials: 'include' });
    if (!res.ok) { shareEditorsList.innerHTML = ''; return; }
    const data = await res.json();
    shareEditorsList.innerHTML = '';
    if (data.editors && data.editors.length > 0) {
      data.editors.forEach(editor => {
        const item = document.createElement('div');
        item.className = 'share-editor-item';
        const displayName = editor.pending
          ? `${escapeHtml(editor.phone || 'Unknown')} (pending)`
          : escapeHtml(editor.username || editor.phone || 'Unknown');
        item.innerHTML = `
          <span class="share-editor-name">${displayName}</span>
          <button class="share-editor-remove" title="Remove editor">&times;</button>
        `;
        item.querySelector('.share-editor-remove').addEventListener('click', () => {
          if (editor.pending) {
            removeEditorById(editor.id);
          } else {
            removeEditorFromPage(editor.userId);
          }
        });
        shareEditorsList.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Error loading editors:', err);
  }
}

async function addEditorByPhone() {
  if (!sharePhoneInput || !shareError) return;
  const phone = sharePhoneInput.value.trim();
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    shareError.textContent = 'Enter a valid 10-digit phone number';
    shareError.classList.remove('hidden');
    return;
  }
  shareError.classList.add('hidden');
  try {
    const res = await fetch('/api/editors/add', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1' + phone.replace(/\D/g, '') })
    });
    const data = await res.json();
    if (!res.ok) {
      shareError.textContent = data.error || 'Failed to add editor';
      shareError.classList.remove('hidden');
      return;
    }
    sharePhoneInput.value = '';
    shareError.classList.add('hidden');
    loadEditorsList();
  } catch (err) {
    shareError.textContent = 'Network error';
    shareError.classList.remove('hidden');
  }
}

async function removeEditorFromPage(editorUserId) {
  try {
    await fetch('/api/editors/remove', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorUserId })
    });
    loadEditorsList();
  } catch (err) {
    console.error('Error removing editor:', err);
  }
}

async function removeEditorById(editorId) {
  try {
    await fetch('/api/editors/remove-by-id', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editorId })
    });
    loadEditorsList();
  } catch (err) {
    console.error('Error removing pending editor:', err);
  }
}

if (shareAddBtn) {
  shareAddBtn.addEventListener('click', addEditorByPhone);
}
if (sharePhoneInput) {
  sharePhoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEditorByPhone();
    }
  });
}

// ——— Shared page cards on home page ———

async function loadSharedEntries() {
  try {
    console.log('[SHARED] loadSharedEntries called, PAGE_IS_OWNER:', window.PAGE_IS_OWNER, 'PAGE_USERNAME:', window.PAGE_USERNAME);
    const res = await fetch('/api/shared-entries/full', { credentials: 'include' });
    console.log('[SHARED] API response status:', res.status);
    if (!res.ok) { console.log('[SHARED] API returned error, aborting'); return; }
    const data = await res.json();
    console.log('[SHARED] API response groups:', data.groups?.length || 0, JSON.stringify(data.groups?.map(g => ({ owner: g.ownerUsername, entryId: g.sharedEntryId, count: g.entries?.length }))));
    if (!data.groups || data.groups.length === 0) { console.log('[SHARED] No groups, nothing to load'); return; }

    for (const group of data.groups) {
      const { ownerUserId, ownerUsername, sharedEntryId, entries: sharedEntries } = group;
      console.log('[SHARED] Group from', ownerUsername, '- entries:', sharedEntries?.length || 0, 'sharedEntryId:', sharedEntryId);
      if (!sharedEntries || sharedEntries.length === 0) continue;

      sharedEntries.forEach(entryData => {
        // Mark all shared entries with their owner
        sharedEntryOwners.set(entryData.id, ownerUserId);

        // Override root shared entry's parentEntryId to null so it appears at editor's root
        if (entryData.id === sharedEntryId || !entryData.parentEntryId) {
          entryData.parentEntryId = null;
        }

        // Skip if already loaded
        if (entries.has(entryData.id)) return;

        // Create DOM element
        const entry = document.createElement('div');
        entry.className = 'entry shared-entry';
        entry.id = entryData.id;
        entry.style.left = `${entryData.position.x}px`;
        entry.style.top = `${entryData.position.y}px`;
        entry.style.display = 'none'; // Will be shown by updateEntryVisibility

        // Render entry content (same logic as loadUserEntries)
        const isImageOnly = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
        const isFileEntry = entryData.mediaCardData && entryData.mediaCardData.type === 'file';

        if (isImageOnly) {
          entry.classList.add('canvas-image');
          const img = document.createElement('img');
          img.src = entryData.mediaCardData.url;
          img.dataset.fullSrc = entryData.mediaCardData.url;
          img.alt = 'Canvas image';
          img.draggable = false;
          img.loading = 'lazy';
          img.decoding = 'async';
          entry.appendChild(img);
        } else if (isFileEntry) {
          entry.classList.add('canvas-file');
          entry.appendChild(createFileCard(entryData.mediaCardData));
        } else if (entryData.latexData && entryData.latexData.enabled) {
          renderLatex(entryData.latexData.source, entry);
        } else {
          const { processedText, urls } = processTextWithLinks(entryData.text);
          if (entryData.textHtml && entryData.textHtml.includes('deadline-table')) {
            entry.innerHTML = entryData.textHtml;
            const dt = entry.querySelector('.deadline-table');
            if (dt) setupDeadlineTableHandlers(dt);
          } else if (entryData.textHtml && entryData.textHtml.includes('gcal-card')) {
            entry.innerHTML = entryData.textHtml;
            const card = entry.querySelector('.gcal-card');
            if (card) setupCalendarCardHandlers(card);
          } else if (processedText) {
            if (entryData.textHtml && /<(strong|b|em|i|u|strike|span[^>]*style)/i.test(entryData.textHtml)) {
              let cleanHtml = entryData.textHtml;
              urls.forEach(url => { cleanHtml = cleanHtml.replace(url, ''); });
              entry.innerHTML = cleanHtml.trim() ? meltifyHtml(cleanHtml.trim()) : '';
              applyEntryFontSize(entry, entryData.textHtml);
            } else {
              entry.innerHTML = `<span>${meltify(processedText)}</span>`;
            }
          }

          // Add link cards
          if (entryData.linkCardsData && Array.isArray(entryData.linkCardsData)) {
            entryData.linkCardsData.forEach(cardData => {
              if (cardData && cardData.url) {
                const card = createLinkCard(cardData);
                entry.appendChild(card);
              }
            });
          }

          // Add media card
          if (!isImageOnly && !isFileEntry && entryData.mediaCardData && entryData.mediaCardData.type !== 'image') {
            const card = createMediaCard(entryData.mediaCardData);
            entry.appendChild(card);
          }
        }

        world.appendChild(entry);

        // Store in entries map
        const storedData = {
          id: entryData.id,
          element: entry,
          text: entryData.text,
          textHtml: entryData.textHtml,
          latexData: entryData.latexData || null,
          position: entryData.position,
          parentEntryId: entryData.parentEntryId,
          linkCardsData: entryData.linkCardsData || [],
          mediaCardData: entryData.mediaCardData || null,
          _sharedOwnerId: ownerUserId
        };
        entries.set(entryData.id, storedData);
        updateEntryDimensions(entry);
      });

      // Start sync for this shared owner
      startSync(ownerUserId);
    }

    // Refresh visibility to show shared entries at root level
    updateEntryVisibility();
  } catch (err) {
    console.error('Error loading shared entries:', err);
  }
}

// ——— Live sync via polling ———

const syncIntervals = new Map(); // ownerUserId -> { interval, lastSyncTime }
// Legacy aliases
let syncInterval = null;
let lastSyncTime = null;

function startSync(ownerUserId) {
  if (syncIntervals.has(ownerUserId)) return; // Already syncing this owner
  const syncState = { lastSyncTime: new Date().toISOString() };

  const interval = setInterval(async () => {
    try {
      const parentParam = typeof currentViewEntryId !== 'undefined' && currentViewEntryId ? `&parentEntryId=${currentViewEntryId}` : '';
      const res = await fetch(`/api/sync/entries?since=${encodeURIComponent(syncState.lastSyncTime)}&userId=${encodeURIComponent(ownerUserId)}${parentParam}`, {
        credentials: 'include'
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.serverTime) syncState.lastSyncTime = data.serverTime;

      if (data.entries && data.entries.length > 0) {
        data.entries.forEach(entryData => {
          applyRemoteEntryUpdate(entryData);
        });
      }
    } catch (err) {
      // Silently fail - sync will retry
    }
  }, 3000);

  syncIntervals.set(ownerUserId, { interval, syncState });
  // Keep legacy refs pointing to first sync
  if (!syncInterval) {
    syncInterval = interval;
    lastSyncTime = syncState.lastSyncTime;
  }
}

function stopSync() {
  for (const [, { interval }] of syncIntervals) {
    clearInterval(interval);
  }
  syncIntervals.clear();
  syncInterval = null;
  lastSyncTime = null;
}

function applyRemoteEntryUpdate(entryData) {
  // Skip entry currently being edited
  const editorEl = document.getElementById('editor');
  if (editorEl && editorEl.style.display !== 'none') {
    const editingEntryId = editorEl.dataset.entryId;
    if (editingEntryId === entryData.id) return;
  }

  if (entryData.deleted) {
    // Remove deleted entry from canvas
    const existing = entries.get(entryData.id);
    if (existing) {
      if (existing.element) existing.element.remove();
      entries.delete(entryData.id);
    }
    return;
  }

  const existing = entries.get(entryData.id);
  if (existing) {
    // Update existing entry
    existing.text = entryData.text;
    existing.textHtml = entryData.textHtml;
    existing.position = entryData.position;
    existing.linkCardsData = entryData.linkCardsData;
    existing.mediaCardData = entryData.mediaCardData;
    existing.latexData = entryData.latexData;

    if (existing.element) {
      existing.element.style.left = `${entryData.position.x}px`;
      existing.element.style.top = `${entryData.position.y}px`;

      // Update text content
      const isImageOnly = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
      if (!isImageOnly) {
        // Strip URLs from display text — they're shown as link cards instead
        const { processedText, urls } = processTextWithLinks(entryData.text);
        let displayText;
        if (urls.length > 0 && entryData.textHtml) {
          let cleanHtml = entryData.textHtml;
          urls.forEach(url => { cleanHtml = cleanHtml.replace(url, ''); });
          displayText = cleanHtml.trim();
        } else if (entryData.textHtml) {
          displayText = entryData.textHtml;
        } else {
          displayText = processedText ? escapeHtml(processedText) : '';
        }
        // Preserve link/media cards, replace only text content
        const hasCards = existing.element.querySelector('.link-card') || existing.element.querySelector('.media-card');
        if (hasCards) {
          // Remove all non-card children, then prepend new text
          Array.from(existing.element.childNodes).forEach(child => {
            if (child.nodeType === Node.TEXT_NODE ||
                (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('link-card') && !child.classList.contains('media-card'))) {
              child.remove();
            }
          });
          if (displayText) {
            existing.element.insertAdjacentHTML('afterbegin', displayText);
          }
        } else {
          existing.element.innerHTML = displayText;
        }
      }
      if (typeof updateEntryDimensions === 'function') {
        updateEntryDimensions(existing.element);
      }
    }
  } else {
    // Create new entry on canvas
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.id = entryData.id;
    entry.style.left = `${entryData.position.x}px`;
    entry.style.top = `${entryData.position.y}px`;

    const isImageOnly = entryData.mediaCardData && entryData.mediaCardData.type === 'image';
    if (isImageOnly) {
      entry.classList.add('canvas-image');
      const img = document.createElement('img');
      img.src = entryData.mediaCardData.url;
      img.dataset.fullSrc = entryData.mediaCardData.url;
      img.alt = 'Canvas image';
      img.draggable = false;
      img.loading = 'lazy';
      entry.appendChild(img);
    } else {
      // Strip URLs from display text — they're shown as link cards instead
      const { processedText, urls } = processTextWithLinks(entryData.text);
      let displayText;
      if (urls.length > 0 && entryData.textHtml) {
        let cleanHtml = entryData.textHtml;
        urls.forEach(url => { cleanHtml = cleanHtml.replace(url, ''); });
        displayText = cleanHtml.trim();
      } else if (entryData.textHtml) {
        displayText = entryData.textHtml;
      } else {
        displayText = processedText ? escapeHtml(processedText) : '';
      }
      if (displayText) {
        entry.innerHTML = `<span>${displayText}</span>`;
      }
      // Add link cards for URLs
      if (urls.length > 0 && entryData.linkCardsData && Array.isArray(entryData.linkCardsData)) {
        entryData.linkCardsData.forEach(cardData => {
          if (cardData && cardData.url) {
            const card = createLinkCard(cardData);
            entry.appendChild(card);
          }
        });
      }
    }

    world.appendChild(entry);

    const newEntryData = {
      id: entryData.id,
      text: entryData.text,
      textHtml: entryData.textHtml,
      position: entryData.position,
      parentEntryId: entryData.parentEntryId,
      linkCardsData: entryData.linkCardsData,
      mediaCardData: entryData.mediaCardData,
      latexData: entryData.latexData,
      element: entry
    };
    entries.set(entryData.id, newEntryData);
    if (typeof updateEntryDimensions === 'function') {
      updateEntryDimensions(newEntryData);
    }
  }
}

// Stop sync on page unload
window.addEventListener('beforeunload', stopSync);

bootstrap();

// Check Google status after auth loads
setTimeout(() => {
  if (currentUser) checkGoogleStatus();
}, 2000);
