// calendar.js — Google Calendar cards and deadline table keyboard navigation
function formatMonthKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function parseGcalMonth(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return new Date();
  return new Date(monthStr + '-01T12:00:00');
}

async function fetchGcalCalendars() {
  try {
    const res = await fetch('/api/google/calendars', { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { gcalConnected = false; updateGoogleConnectButton(); }
      return [];
    }
    const data = await res.json();
    return data.calendars || [];
  } catch (e) {
    console.error('Fetch calendars error:', e);
    return [];
  }
}

async function fetchGcalEventsForMonth(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month + 2, 0).toISOString();
  try {
    const res = await fetch(`/api/google/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { gcalConnected = false; updateGoogleConnectButton(); }
      return [];
    }
    const data = await res.json();
    return data.events || [];
  } catch (e) {
    console.error('Fetch events error:', e);
    return [];
  }
}

function getEventsForDateFromList(dateStr, eventsList) {
  return eventsList.filter(evt => {
    const start = evt.start;
    if (!start) return false;
    const evtDate = start.length === 10 ? start : start.substring(0, 10);
    if (evtDate === dateStr) return true;
    if (evt.allDay && evt.end) {
      const endDate = evt.end.length === 10 ? evt.end : evt.end.substring(0, 10);
      return dateStr >= evtDate && dateStr < endDate;
    }
    return false;
  });
}

function renderCalendarDayCell(day, dateStr, otherMonth, isToday, state) {
  const events = getEventsForDateFromList(dateStr, state.events || []);
  const maxChips = 3;
  const shown = events.slice(0, maxChips);
  const moreCount = events.length - maxChips;
  let chipsHtml = '';
  shown.forEach(evt => {
    const cal = (state.calendars || []).find(c => c.id === evt.calendarId);
    const color = cal?.backgroundColor || '#4285f4';
    const title = (evt.summary || 'Event').substring(0, 30);
    chipsHtml += `<div class="gcal-card-chip" style="border-left-color:${color}"><span class="gcal-card-chip-title">${escapeHtml(title)}</span></div>`;
  });
  if (moreCount > 0) {
    chipsHtml += `<div class="gcal-card-more">+${moreCount} more</div>`;
  }
  const classes = ['gcal-card-day'];
  if (otherMonth) classes.push('other-month');
  if (isToday) classes.push('today');
  return `<div class="${classes.join(' ')}" data-date="${escapeHtml(dateStr)}"><div class="gcal-card-day-num">${day}</div>${chipsHtml}</div>`;
}

function renderCalendarCard(card) {
  const state = card._gcalState || {};
  const viewDate = state.viewDate ? new Date(state.viewDate) : parseGcalMonth(card.dataset.gcalMonth || '');
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();

  const monthLabel = card.querySelector('.gcal-card-month-label');
  if (monthLabel) monthLabel.textContent = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const dayHeaders = card.querySelector('.gcal-card-day-headers');
  if (dayHeaders) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.innerHTML = days.map(d => `<span>${d}</span>`).join('');
  }

  const grid = card.querySelector('.gcal-card-grid');
  if (!grid) return;

  let html = '';
  const prevLastDay = new Date(year, month, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevLastDay - i;
    const dateStr = formatDateKey(new Date(year, month - 1, d));
    html += renderCalendarDayCell(d, dateStr, true, false, state);
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = formatDateKey(new Date(year, month, d));
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    html += renderCalendarDayCell(d, dateStr, false, isToday, state);
  }
  const totalCells = startDow + lastDay.getDate();
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    const dateStr = formatDateKey(new Date(year, month + 1, d));
    html += renderCalendarDayCell(d, dateStr, true, false, state);
  }
  grid.innerHTML = html;

  const loading = card.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');
}

function saveCalendarCardState(card) {
  const entry = card.closest('.entry');
  if (!entry) return;
  const entryData = entries.get(entry.id);
  if (!entryData) return;
  const clone = card.cloneNode(true);
  // Keep rendered grid content so events are visible on page reload
  const loading = clone.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');
  // Save cached events as data attribute for instant restore
  const state = card._gcalState;
  if (state && state.eventCache) {
    clone.dataset.gcalEventCache = JSON.stringify(state.eventCache);
  }
  if (state && state.calendars && state.calendars.length > 0) {
    clone.dataset.gcalCalendars = JSON.stringify(state.calendars);
  }
  entryData.text = entry.innerText;
  entryData.textHtml = clone.outerHTML;
  updateEntryOnServer(entryData);
}

function setupCalendarCardHandlers(card) {
  const monthStr = card.dataset.gcalMonth || formatMonthKey(new Date());
  card.dataset.gcalMonth = monthStr;
  const viewDate = parseGcalMonth(monthStr);

  // Restore cached data from saved HTML data attributes
  let restoredEventCache = {};
  let restoredCalendars = [];
  try {
    if (card.dataset.gcalEventCache) {
      restoredEventCache = JSON.parse(card.dataset.gcalEventCache);
      delete card.dataset.gcalEventCache;
    }
  } catch (e) { /* ignore parse errors */ }
  try {
    if (card.dataset.gcalCalendars) {
      restoredCalendars = JSON.parse(card.dataset.gcalCalendars);
      delete card.dataset.gcalCalendars;
    }
  } catch (e) { /* ignore parse errors */ }

  const cachedEvents = restoredEventCache[monthStr] || [];
  card._gcalState = {
    viewDate: viewDate.getTime(),
    calendars: restoredCalendars,
    events: cachedEvents,
    eventCache: restoredEventCache
  };

  const loading = card.querySelector('.gcal-card-loading');
  if (loading) loading.classList.add('hidden');

  // If we have cached events (from saved HTML), the grid already shows them.
  // If no cached events, render to show the empty grid structure.
  const grid = card.querySelector('.gcal-card-grid');
  const hasRenderedContent = grid && grid.children.length > 0 && cachedEvents.length > 0;
  if (!hasRenderedContent) {
    renderCalendarCard(card);
  }

  // Silently fetch fresh events in background
  (async () => {
    const [calendars, events] = await Promise.all([
      fetchGcalCalendars(),
      fetchGcalEventsForMonth(viewDate)
    ]);
    if (!card._gcalState) return;
    card._gcalState.calendars = calendars;
    // Only re-render if events actually changed
    const oldJson = JSON.stringify(card._gcalState.events);
    const newJson = JSON.stringify(events);
    card._gcalState.events = events;
    card._gcalState.eventCache[monthStr] = events;
    if (oldJson !== newJson || !hasRenderedContent) {
      renderCalendarCard(card);
      saveCalendarCardState(card);
    }
  })();

  card.addEventListener('mousedown', (e) => {
    if (e.target.closest('.gcal-card-nav-btn, .gcal-card-today-btn')) e.stopPropagation();
  });

  const prevBtn = card.querySelector('.gcal-card-prev');
  const nextBtn = card.querySelector('.gcal-card-next');
  const todayBtn = card.querySelector('.gcal-card-today-btn');

  // Shared function for navigating to a month
  function navigateToMonth(d) {
    const key = formatMonthKey(d);
    card._gcalState.viewDate = d.getTime();
    card.dataset.gcalMonth = key;
    // Show cached events immediately if available, otherwise show empty grid
    const cached = card._gcalState.eventCache[key];
    card._gcalState.events = cached || [];
    renderCalendarCard(card);
    // Silently fetch fresh events in background
    fetchGcalEventsForMonth(d).then(events => {
      if (!card._gcalState) return;
      // Only re-render if we're still on the same month and events changed
      if (formatMonthKey(new Date(card._gcalState.viewDate)) !== key) return;
      const oldJson = JSON.stringify(card._gcalState.events);
      const newJson = JSON.stringify(events);
      card._gcalState.events = events;
      card._gcalState.eventCache[key] = events;
      if (oldJson !== newJson) {
        renderCalendarCard(card);
      }
      saveCalendarCardState(card);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = new Date(card._gcalState.viewDate || Date.now());
      d.setMonth(d.getMonth() - 1);
      navigateToMonth(d);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = new Date(card._gcalState.viewDate || Date.now());
      d.setMonth(d.getMonth() + 1);
      navigateToMonth(d);
    });
  }
  if (todayBtn) {
    todayBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToMonth(new Date());
    });
  }
}

async function insertCalendarTemplate() {
  if (!gcalConnected) {
    handleGoogleConnection();
    return;
  }
  const now = new Date();
  const monthStr = formatMonthKey(now);
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const cardHTML = `
<div class="gcal-card" contenteditable="false" data-gcal-card="true" data-gcal-month="${escapeHtml(monthStr)}">
  <div class="gcal-card-header">
    <button type="button" class="gcal-card-nav-btn gcal-card-prev" aria-label="Previous month">‹</button>
    <button type="button" class="gcal-card-nav-btn gcal-card-next" aria-label="Next month">›</button>
    <span class="gcal-card-month-label">${escapeHtml(monthLabel)}</span>
    <button type="button" class="gcal-card-today-btn">Today</button>
  </div>
  <div class="gcal-card-day-headers">
    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
  </div>
  <div class="gcal-card-grid"></div>
  <div class="gcal-card-loading hidden" aria-hidden="true">Loading calendar…</div>
</div>`;
  editor.innerHTML = cardHTML;
  editor.classList.add('has-content');
  const card = editor.querySelector('.gcal-card');
  if (card) setupCalendarCardHandlers(card);
}

function focusNearestDeadlineCell(table, clientX, clientY) {
  const cells = Array.from(table.querySelectorAll('.deadline-col-name, .deadline-col-deadline, .deadline-col-class, .deadline-col-notes'));
  if (cells.length === 0) return;
  let nearest = cells[0];
  let minDist = Infinity;
  for (const cell of cells) {
    const r = cell.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (d < minDist) { minDist = d; nearest = cell; }
  }
  nearest.focus();
  const range = document.createRange();
  const sel = window.getSelection();
  if (document.caretRangeFromPoint) {
    const cr = document.caretRangeFromPoint(clientX, clientY);
    if (cr && nearest.contains(cr.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(cr);
      return;
    }
  }
  range.selectNodeContents(nearest);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getDeadlineEditableCells(row) {
  return Array.from(row.querySelectorAll('.deadline-col-name, .deadline-col-deadline, .deadline-col-class, .deadline-col-notes'));
}

function getDeadlineActiveRows(table) {
  const completedSection = table.querySelector('.deadline-completed-section');
  return Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
}

function handleDeadlineTableKeydown(e) {
  const target = e.target;
  const deadlineTable = target.closest('.deadline-table');
  if (!deadlineTable) return;

  const cell = target.closest('[contenteditable="true"]');
  const currentRow = cell ? cell.closest('.deadline-row') : null;
  const activeRows = getDeadlineActiveRows(deadlineTable);

  // Tab / Shift+Tab: traverse cells like a spreadsheet
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!cell || !currentRow) return;
    const cells = getDeadlineEditableCells(currentRow);
    const cellIndex = cells.indexOf(cell);
    const rowIndex = activeRows.indexOf(currentRow);
    if (e.shiftKey) {
      if (cellIndex > 0) {
        cells[cellIndex - 1].focus();
      } else if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        if (prevCells.length > 0) prevCells[prevCells.length - 1].focus();
      }
    } else {
      if (cellIndex < cells.length - 1) {
        cells[cellIndex + 1].focus();
      } else if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        if (nextCells.length > 0) nextCells[0].focus();
      }
    }
    return;
  }

  // Arrow keys: spreadsheet-style navigation
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!cell || !currentRow) return;
    const cells = getDeadlineEditableCells(currentRow);
    const cellIndex = cells.indexOf(cell);
    const rowIndex = activeRows.indexOf(currentRow);
    const sel = window.getSelection();

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        if (prevCells[cellIndex]) prevCells[cellIndex].focus();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        if (nextCells[cellIndex]) nextCells[cellIndex].focus();
      }
      return;
    }

    // ArrowLeft / ArrowRight: move within cell text, wrap to adjacent rows at edges
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const atStart = range.collapsed && cell.contains(range.startContainer) &&
      (range.startOffset === 0 || (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0));
    const atEnd = range.collapsed && cell.contains(range.endContainer) &&
      (range.endOffset === (range.endContainer.textContent || '').length);

    if (e.key === 'ArrowLeft' && atStart) {
      e.preventDefault();
      let target;
      if (cellIndex > 0) {
        target = cells[cellIndex - 1];
      } else if (rowIndex > 0) {
        const prevCells = getDeadlineEditableCells(activeRows[rowIndex - 1]);
        target = prevCells.length > 0 ? prevCells[prevCells.length - 1] : null;
      }
      if (target) {
        target.focus();
        const r = document.createRange();
        r.selectNodeContents(target);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    if (e.key === 'ArrowRight' && atEnd) {
      e.preventDefault();
      let target;
      if (cellIndex < cells.length - 1) {
        target = cells[cellIndex + 1];
      } else if (rowIndex < activeRows.length - 1) {
        const nextCells = getDeadlineEditableCells(activeRows[rowIndex + 1]);
        target = nextCells.length > 0 ? nextCells[0] : null;
      }
      if (target) {
        target.focus();
        const r = document.createRange();
        r.setStart(target, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    return;
  }

  // Cmd/Ctrl+A: select all text within the current cell only
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    if (cell) {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }

  // Backspace/Delete: empty cell or empty row
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (cell && cell.textContent === '') {
      e.preventDefault();
      const row = cell.closest('.deadline-row');
      if (row && isDeadlineRowEmpty(row)) {
        const table = row.closest('.deadline-table');
        const allRows = Array.from(table.querySelectorAll('.deadline-row'));
        if (allRows.length <= 1) {
          editor.innerHTML = '';
          setTimeout(() => commitEditor(), 0);
        } else {
          const rowIndex = activeRows.indexOf(row);
          row.remove();
          const remaining = getDeadlineActiveRows(table);
          const focusRow = remaining[Math.min(rowIndex, remaining.length - 1)] || remaining[0];
          if (focusRow) {
            const focusCell = getDeadlineEditableCells(focusRow)[0];
            if (focusCell) focusCell.focus();
          }
        }
      }
      return;
    }
  }

  if (e.key !== 'Enter') return;

  e.preventDefault();

  // Cmd/Ctrl+Enter: always commit
  if (e.metaKey || e.ctrlKey) {
    setTimeout(() => commitEditor(), 0);
    return;
  }

  const enterRow = target.closest('.deadline-row');
  if (!enterRow) return;

  const table = enterRow.closest('.deadline-table');
  const completedSection = table.querySelector('.deadline-completed-section');
  const allRows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const currentIndex = allRows.indexOf(enterRow);
  const rowsBelow = allRows.slice(currentIndex + 1);

  // Check if any row below has an empty editable cell
  for (const row of rowsBelow) {
    const emptyCell = row.querySelector('.deadline-col-name:empty, .deadline-col-deadline:empty, .deadline-col-class:empty');
    if (emptyCell) {
      emptyCell.focus();
      return;
    }
  }

  // No filled row below or at the end — add a new row
  addDeadlineRow(table);
}

/* ── Background picker ─────────────────────────────────────────── */
(function initBgPicker() {
  const bgBtn = document.getElementById('bg-picker-button');
  const bgDropdown = document.getElementById('bg-picker-dropdown');
  const bgUploadBtn = document.getElementById('bg-upload-btn');
  const bgUploadInput = document.getElementById('bg-upload-input');
  if (!bgBtn || !bgDropdown) return;

  // Session state (loaded from API)
  var _bgUrl = null;
  var _bgUploads = [];
  var _saveTimer = null;

  // --- Image preload verification ---
  function preloadImage(url) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { resolve(url); };
      img.onerror = function() { reject(new Error('Image failed to load')); };
      img.src = url;
    });
  }

  // --- API persistence ---
  function saveBgToAPI() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      fetch('/api/user/background', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bgUrl: _bgUrl, bgUploads: _bgUploads })
      }).catch(function(err) { console.warn('Failed to save background:', err); });
    }, 200);
  }

  // Build a thumbnail option element for an uploaded image
  function createUploadedOption(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    var btn = document.createElement('button');
    btn.className = 'bg-picker-option bg-picker-preset bg-picker-uploaded';
    btn.setAttribute('data-bg', url);
    btn.title = 'Uploaded image (right-click to remove)';
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'uploaded bg';
    img.onerror = function() {
      _bgUploads = _bgUploads.filter(function(u) { return u !== url; });
      if (_bgUrl === url) {
        _bgUrl = null;
        removeBg();
        markActive(null);
      }
      btn.remove();
      saveBgToAPI();
    };
    btn.appendChild(img);
    btn.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      _bgUploads = _bgUploads.filter(function(u) { return u !== url; });
      btn.remove();
      if (_bgUrl === url) {
        _bgUrl = null;
        removeBg();
        markActive(null);
      }
      saveBgToAPI();
    });
    return btn;
  }

  // Render saved uploads into the dropdown (before the upload button)
  function renderSavedUploads() {
    bgDropdown.querySelectorAll('.bg-picker-uploaded').forEach(function(el) { el.remove(); });
    _bgUploads.forEach(function(url) {
      var opt = createUploadedOption(url);
      if (opt) bgDropdown.insertBefore(opt, bgUploadBtn);
    });
  }

  // --- Core functions ---
  function loadBg() {
    fetch('/api/user/background', { credentials: 'include' })
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) {
        if (!data) return;
        _bgUrl = data.bgUrl || null;
        _bgUploads = Array.isArray(data.bgUploads) ? data.bgUploads.filter(function(u) { return typeof u === 'string' && u.startsWith('http'); }) : [];
        renderSavedUploads();
        if (_bgUrl) {
          preloadImage(_bgUrl).then(function() {
            applyBg(_bgUrl);
            markActive(_bgUrl);
          }).catch(function() {
            console.warn('Background image failed to load:', _bgUrl);
            _bgUrl = null;
            saveBgToAPI();
          });
        }
      })
      .catch(function(err) { console.warn('Failed to load background settings:', err); });
  }

  function applyBg(url) {
    document.body.style.setProperty('--bg-url', "url('" + url + "')");
    document.body.classList.add('has-bg-image');
  }

  function removeBg() {
    document.body.classList.remove('has-bg-image');
    document.body.style.removeProperty('--bg-url');
  }

  function markActive(url) {
    bgDropdown.querySelectorAll('.bg-picker-option').forEach(function(opt) {
      var bg = opt.getAttribute('data-bg');
      opt.classList.toggle('active', bg === (url || 'none'));
    });
  }

  // Toggle dropdown
  bgBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    bgDropdown.classList.toggle('hidden');
  });

  // Option clicks (presets, none, uploaded, and upload button)
  bgDropdown.addEventListener('click', function(e) {
    var opt = e.target.closest('.bg-picker-option');
    if (!opt) return;
    var bg = opt.getAttribute('data-bg');
    if (bg === 'none') {
      removeBg();
      _bgUrl = null;
      saveBgToAPI();
      markActive(null);
    } else if (opt.id === 'bg-upload-btn') {
      bgUploadInput.click();
      return; // don't close dropdown yet
    } else {
      preloadImage(bg).then(function() {
        applyBg(bg);
        _bgUrl = bg;
        saveBgToAPI();
        markActive(bg);
      }).catch(function() {
        alert('Background image failed to load.');
      });
    }
    bgDropdown.classList.add('hidden');
  });

  function showBgError(msg) {
    if (typeof msg === 'string' && msg) alert('Background upload: ' + msg);
    else alert('Background upload failed. Try another image or check you\u2019re signed in.');
  }

  // Upload handler
  if (bgUploadInput) {
    bgUploadInput.addEventListener('change', async function() {
      var file = bgUploadInput.files[0];
      if (!file) return;
      bgDropdown.classList.add('hidden');

      var finalUrl = null;
      var serverError = null;

      // Try server upload
      try {
        var form = new FormData();
        form.append('file', file);
        var res = await fetch('/api/upload-background-image', { method: 'POST', credentials: 'include', body: form });
        if (res.ok) {
          var data = await res.json();
          if (data.url) finalUrl = data.url;
        } else {
          var body = await res.json().catch(function() { return {}; });
          serverError = body.error || res.statusText || 'Upload failed';
        }
      } catch (err) {
        console.warn('Background server upload failed:', err);
        serverError = 'Network error';
      }

      if (!finalUrl) {
        showBgError(serverError || 'Upload failed');
        bgUploadInput.value = '';
        return;
      }

      // Verify the image actually loads before applying
      try {
        await preloadImage(finalUrl);
      } catch (err) {
        showBgError('Uploaded image could not be loaded. The storage bucket may not be publicly accessible.');
        bgUploadInput.value = '';
        return;
      }

      // Add to uploads list and apply
      if (_bgUploads.indexOf(finalUrl) === -1) {
        _bgUploads.push(finalUrl);
      }
      _bgUrl = finalUrl;
      renderSavedUploads();
      applyBg(finalUrl);
      markActive(finalUrl);
      saveBgToAPI();

      bgUploadInput.value = '';
    });
  }

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!bgDropdown.classList.contains('hidden') && !bgDropdown.contains(e.target) && e.target !== bgBtn) {
      bgDropdown.classList.add('hidden');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !bgDropdown.classList.contains('hidden')) {
      bgDropdown.classList.add('hidden');
    }
  });

  // Expose loadBg so bootstrap can call it after auth
  window._loadBgAfterAuth = loadBg;
})();
