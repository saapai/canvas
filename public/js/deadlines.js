// deadlines.js — Template menu and deadline table management
const templateMenuButton = document.getElementById('template-menu-button');
const templateMenuDropdown = document.getElementById('template-menu-dropdown');

function closeTemplateMenu() {
  if (templateMenuButton) templateMenuButton.classList.remove('active');
  if (templateMenuDropdown) templateMenuDropdown.classList.add('hidden');
}

function openTemplateMenu() {
  if (templateMenuButton) templateMenuButton.classList.add('active');
  if (templateMenuDropdown) templateMenuDropdown.classList.remove('hidden');
}

if (templateMenuButton && templateMenuDropdown) {
  templateMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !templateMenuDropdown.classList.contains('hidden');
    if (isOpen) {
      closeTemplateMenu();
    } else {
      openTemplateMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!templateMenuDropdown.contains(e.target) && e.target !== templateMenuButton) {
      closeTemplateMenu();
    }
  });

  templateMenuDropdown.querySelectorAll('.template-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const templateType = btn.dataset.template;
      insertTemplate(templateType);
      closeTemplateMenu();
    });
  });
}

async function insertTemplate(templateType) {
  if (templateType === 'deadlines') {
    await insertDeadlinesTemplate();
  } else if (templateType === 'gcal-card') {
    await insertCalendarTemplate();
  } else if (templateType === 'google') {
    handleGoogleConnection();
  }
}

function getDeadlineRowHTML() {
  return `<div class="deadline-col-check"><button class="deadline-dot" type="button"></button></div>
    <div class="deadline-col-name" contenteditable="true"></div>
    <div class="deadline-col-deadline" contenteditable="true"></div>
    <div class="deadline-col-class" contenteditable="true"></div>
    <div class="deadline-col-status"><button class="status-badge" data-status="not-started" type="button">Not started</button><div class="status-dropdown"><div class="status-option" data-status="not-started">Not started</div><div class="status-option" data-status="overdue">Overdue</div><div class="status-option" data-status="done">Done</div></div></div>
    <div class="deadline-col-notes" contenteditable="true"></div>`;
}

function addDeadlineRow(table) {
  const ghostRow = table.querySelector('.deadline-ghost-row');
  const newRow = document.createElement('div');
  newRow.className = 'deadline-row';
  newRow.innerHTML = getDeadlineRowHTML();
  if (ghostRow) {
    table.insertBefore(newRow, ghostRow);
  } else {
    table.appendChild(newRow);
  }
  const firstCell = newRow.querySelector('.deadline-col-name');
  if (firstCell) {
    setTimeout(() => firstCell.focus(), 0);
  }
}

function getPacificToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}

function parseRawDeadlineDate(raw) {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();
  const year = getPacificToday().getFullYear();
  const months = {
    jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
    may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,
    oct:9,october:9,nov:10,november:10,dec:11,december:11
  };
  const cleaned = s.replace(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*,?\s*/i, '');
  const monthDay = cleaned.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*,?\s*(\d{4}))?/i);
  if (monthDay && months[monthDay[1].toLowerCase()] !== undefined) {
    const y = monthDay[3] ? parseInt(monthDay[3]) : year;
    return new Date(y, months[monthDay[1].toLowerCase()], parseInt(monthDay[2]));
  }
  const slash = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + parseInt(slash[3]) : parseInt(slash[3])) : year;
    return new Date(y, parseInt(slash[1]) - 1, parseInt(slash[2]));
  }
  return null;
}

function formatDeadlineDisplay(rawDate) {
  const d = parseRawDeadlineDate(rawDate);
  if (!d) return rawDate || '';
  const today = getPacificToday();
  today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diffDays = Math.round((target - today) / 86400000);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  if (diffDays >= 0 && diffDays <= 13) {
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays <= 6) return dayNames[target.getDay()];
    return 'Next ' + dayNames[target.getDay()];
  }
  return `${dayNames[target.getDay()]}, ${monthNames[target.getMonth()]} ${target.getDate()}, ${target.getFullYear()}`;
}

function refreshDeadlineDates(table) {
  table.querySelectorAll('.deadline-col-deadline').forEach(cell => {
    let raw = cell.dataset.rawDate;
    // If no raw date stored yet, try to parse the text content and set it
    if (!raw) {
      const text = cell.textContent.trim();
      if (!text) return;
      const parsed = parseRawDeadlineDate(text);
      if (parsed) {
        raw = `${parsed.getMonth()+1}/${parsed.getDate()}/${parsed.getFullYear()}`;
        cell.dataset.rawDate = raw;
      } else {
        return; // unparseable, leave as-is
      }
    }
    cell.textContent = formatDeadlineDisplay(raw);
  });
}

function refreshAllDeadlineDates() {
  document.querySelectorAll('.deadline-table').forEach(t => refreshDeadlineDates(t));
}

function parseDeadlineDateForSort(dateStr, cell) {
  // Prefer raw date stored in data attribute
  const raw = cell ? cell.dataset.rawDate : null;
  const src = raw || dateStr;
  if (!src || !src.trim()) return Infinity;
  const d = parseRawDeadlineDate(src);
  return d ? d.getTime() : Infinity;
}

function sortDeadlineRows(table) {
  // Only sort active rows (not in completed section)
  const completedSection = table.querySelector('.deadline-completed-section');
  const rows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const ghostRow = table.querySelector('.deadline-ghost-row');
  rows.sort((a, b) => {
    const aCel = a.querySelector('.deadline-col-deadline');
    const bCel = b.querySelector('.deadline-col-deadline');
    const aT = parseDeadlineDateForSort(aCel?.textContent, aCel);
    const bT = parseDeadlineDateForSort(bCel?.textContent, bCel);
    return aT - bT;
  });
  rows.forEach(row => {
    if (ghostRow) table.insertBefore(row, ghostRow);
    else table.appendChild(row);
  });
}

function isDeadlineRowEmpty(row) {
  const cells = row.querySelectorAll('[contenteditable="true"]');
  for (const cell of cells) {
    if (cell.textContent.trim() !== '') return false;
  }
  const badge = row.querySelector('.status-badge');
  if (badge && badge.dataset.status !== 'not-started') return false;
  const dot = row.querySelector('.deadline-dot');
  if (dot && dot.classList.contains('checked')) return false;
  return true;
}

function ensureCompletedSection(table) {
  if (!table.querySelector('.deadline-completed-section')) {
    const divider = document.createElement('div');
    divider.className = 'deadline-completed-divider';
    divider.textContent = 'Completed';
    divider.addEventListener('click', () => {
      divider.classList.toggle('expanded');
      const sec = table.querySelector('.deadline-completed-section');
      if (sec) sec.classList.toggle('expanded');
    });
    const section = document.createElement('div');
    section.className = 'deadline-completed-section';
    table.appendChild(divider);
    table.appendChild(section);
  }
  return table.querySelector('.deadline-completed-section');
}

function hideOrShowCompletedSection(table) {
  const section = table.querySelector('.deadline-completed-section');
  const divider = table.querySelector('.deadline-completed-divider');
  if (!section || !divider) return;
  const empty = section.children.length === 0;
  section.style.display = empty ? 'none' : '';
  divider.style.display = empty ? 'none' : '';
}

function findSortedInsertPosition(table, row) {
  const completedSection = table.querySelector('.deadline-completed-section');
  const ghostRow = table.querySelector('.deadline-ghost-row');
  const completedDivider = table.querySelector('.deadline-completed-divider');
  const activeRows = Array.from(table.querySelectorAll('.deadline-row')).filter(r => !completedSection || !completedSection.contains(r));
  const newCell = row.querySelector('.deadline-col-deadline');
  const newTime = parseDeadlineDateForSort(newCell?.textContent, newCell);
  for (const existing of activeRows) {
    const cell = existing.querySelector('.deadline-col-deadline');
    const t = parseDeadlineDateForSort(cell?.textContent, cell);
    if (newTime < t) return existing;
  }
  return ghostRow || completedDivider || null;
}

function completeDeadlineRow(row, table) {
  row.classList.add('completing');
  const dot = row.querySelector('.deadline-dot');
  if (dot) dot.classList.add('checked');
  setTimeout(() => {
    const section = ensureCompletedSection(table);
    row.classList.remove('completing');
    section.appendChild(row);
    hideOrShowCompletedSection(table);
    saveDeadlineTableState(table);
  }, 350);
}

function uncompleteDeadlineRow(row, table) {
  const dot = row.querySelector('.deadline-dot');
  if (dot) dot.classList.remove('checked');
  row.classList.add('uncompleting');
  const insertBefore = findSortedInsertPosition(table, row);
  if (insertBefore) table.insertBefore(row, insertBefore);
  else {
    const ghost = table.querySelector('.deadline-ghost-row');
    if (ghost) table.insertBefore(row, ghost);
    else table.appendChild(row);
  }
  sortDeadlineRows(table);
  setTimeout(() => row.classList.remove('uncompleting'), 300);
  hideOrShowCompletedSection(table);
  saveDeadlineTableState(table);
}

async function extractFileIntoTable(table, file) {
  // Show or update loading overlay
  let overlay = table.querySelector('.deadline-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'deadline-loading-overlay';
    overlay.innerHTML = '<div class="deadline-loading-spinner"></div><div class="deadline-loading-text">Extracting deadlines...</div>';
    table.appendChild(overlay);
  }
  // Track active extraction count so overlay stays visible until all finish
  table._extractionCount = (table._extractionCount || 0) + 1;
  overlay.querySelector('.deadline-loading-text').textContent =
    table._extractionCount > 1 ? `Extracting (${table._extractionCount} files)...` : 'Extracting deadlines...';
  overlay.classList.add('active');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/extract-deadlines', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to extract deadlines');
    }

    const data = await res.json();
    // Filter to today onwards
    if (data.deadlines) {
      const todayMs = getPacificToday(); todayMs.setHours(0,0,0,0);
      data.deadlines = data.deadlines.filter(d => {
        const parsed = parseRawDeadlineDate(d.deadline);
        return !parsed || parsed.getTime() >= todayMs.getTime();
      });
    }

    if (!data.deadlines || data.deadlines.length === 0) {
      table._extractionCount--;
      if (table._extractionCount <= 0) {
        overlay.querySelector('.deadline-loading-text').textContent = 'No deadlines found';
        setTimeout(() => overlay.classList.remove('active'), 1500);
      }
      return;
    }

    // Remove empty rows before adding first batch
    Array.from(table.querySelectorAll('.deadline-row')).forEach(row => {
      if (isDeadlineRowEmpty(row)) row.remove();
    });

    // Add rows from extracted deadlines
    const ghostRow = table.querySelector('.deadline-ghost-row');
    data.deadlines.forEach(d => {
      const row = document.createElement('div');
      row.className = 'deadline-row';
      row.innerHTML = getDeadlineRowHTML();
      const nameCell = row.querySelector('.deadline-col-name');
      const deadlineCell = row.querySelector('.deadline-col-deadline');
      const classCell = row.querySelector('.deadline-col-class');
      const notesCell = row.querySelector('.deadline-col-notes');
      if (nameCell) nameCell.textContent = d.assignment || '';
      if (deadlineCell) {
        deadlineCell.dataset.rawDate = d.deadline || '';
        deadlineCell.textContent = formatDeadlineDisplay(d.deadline);
      }
      if (classCell) classCell.textContent = d.class || '';
      if (notesCell) notesCell.textContent = d.notes || '';
      if (ghostRow) table.insertBefore(row, ghostRow);
      else table.appendChild(row);
    });

    sortDeadlineRows(table);
    table._extractionCount--;
    if (table._extractionCount <= 0) {
      overlay.classList.remove('active');
    }
  } catch (err) {
    console.error('Deadline extraction error:', err);
    table._extractionCount--;
    if (table._extractionCount <= 0) {
      overlay.querySelector('.deadline-loading-text').textContent = err.message || 'Extraction failed';
      setTimeout(() => overlay.classList.remove('active'), 2000);
    }
  }
}

function saveDeadlineTableState(table) {
  const entry = table.closest('.entry');
  if (!entry) return;
  const entryData = entries.get(entry.id);
  if (entryData) {
    entryData.text = entry.innerText;
    entryData.textHtml = entry.innerHTML;
    updateEntryOnServer(entryData);
  }
}

function setupDeadlineTableHandlers(table) {
  table.addEventListener('mousedown', (e) => {
    table.classList.add('table-active');
    const inEditor = table.closest('#editor');
    if (inEditor) {
      const cell = e.target.closest('[contenteditable="true"]');
      if (!cell && !e.target.closest('button')) {
        e.preventDefault();
        focusNearestDeadlineCell(table, e.clientX, e.clientY);
      }
    }
  });

  // Deactivate when clicking outside + close any open dropdowns
  const deactivateHandler = (e) => {
    if (!table.contains(e.target)) {
      table.classList.remove('table-active');
      table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
    }
  };
  document.addEventListener('mousedown', deactivateHandler);

  // Migrate old checkboxes to dots
  table.querySelectorAll('.deadline-col-check input[type="checkbox"]').forEach(cb => {
    const dot = document.createElement('button');
    dot.className = 'deadline-dot';
    dot.type = 'button';
    if (cb.checked) dot.classList.add('checked');
    cb.replaceWith(dot);
  });

  // Wire up existing completed divider toggle if present in saved HTML
  const existingDivider = table.querySelector('.deadline-completed-divider');
  if (existingDivider) {
    existingDivider.addEventListener('click', () => {
      existingDivider.classList.toggle('expanded');
      const sec = table.querySelector('.deadline-completed-section');
      if (sec) sec.classList.toggle('expanded');
    });
  }
  hideOrShowCompletedSection(table);

  // Event delegation for clicks within the table
  table.addEventListener('click', (e) => {
    // Dot click - toggle completion
    const dot = e.target.closest('.deadline-dot');
    if (dot) {
      e.preventDefault();
      e.stopPropagation();
      const row = dot.closest('.deadline-row');
      if (!row) return;
      if (dot.classList.contains('checked')) {
        uncompleteDeadlineRow(row, table);
      } else {
        completeDeadlineRow(row, table);
      }
      return;
    }

    // Status badge click - toggle dropdown
    const badge = e.target.closest('.status-badge');
    if (badge) {
      e.preventDefault();
      e.stopPropagation();
      table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
      const dropdown = badge.closest('.deadline-col-status').querySelector('.status-dropdown');
      if (dropdown) dropdown.classList.toggle('open');
      return;
    }

    // Status option click - update badge
    const option = e.target.closest('.status-option');
    if (option) {
      e.preventDefault();
      e.stopPropagation();
      const status = option.dataset.status;
      const text = option.textContent;
      const statusCell = option.closest('.deadline-col-status');
      const statusBadge = statusCell.querySelector('.status-badge');
      if (statusBadge) {
        statusBadge.dataset.status = status;
        statusBadge.textContent = text;
      }
      option.closest('.status-dropdown').classList.remove('open');
      return;
    }

    // Ghost row click - add new row
    const ghostRow = e.target.closest('.deadline-ghost-row');
    if (ghostRow) {
      e.preventDefault();
      e.stopPropagation();
      addDeadlineRow(table);
      return;
    }

    // Close any open dropdowns when clicking elsewhere
    table.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  table.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('[contenteditable="true"]');
    if (!cell) return;
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(cell);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  table.addEventListener('focusout', (e) => {
    const cell = e.target.closest('.deadline-col-deadline');
    if (cell) {
      const text = cell.textContent.trim();
      if (!text) { delete cell.dataset.rawDate; }
      else if (!(cell.dataset.rawDate && formatDeadlineDisplay(cell.dataset.rawDate) === text)) {
        const parsed = parseRawDeadlineDate(text);
        if (parsed) {
          const raw = `${parsed.getMonth()+1}/${parsed.getDate()}/${parsed.getFullYear()}`;
          cell.dataset.rawDate = raw;
          cell.textContent = formatDeadlineDisplay(raw);
        }
      }
    }
    setTimeout(() => {
      refreshDeadlineDates(table);
      sortDeadlineRows(table);
    }, 0);
  });

  // Drag and drop onto deadline table in editor to populate rows.
  // The viewport dragover already prevents default for all files, so
  // the browser won't open the file. These handlers add visual feedback
  // and handle the extraction when dropped directly on the table.
  table.addEventListener('dragover', (e) => {
    if (!table.closest('#editor')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    table.classList.add('deadline-drop-active');
  });

  table.addEventListener('dragleave', (e) => {
    if (!table.closest('#editor')) return;
    // Only remove if we're actually leaving the table, not entering a child
    if (!table.contains(e.relatedTarget)) {
      table.classList.remove('deadline-drop-active');
    }
  });

  table.addEventListener('drop', async (e) => {
    if (!table.closest('#editor')) return;
    e.preventDefault();
    e.stopPropagation();
    table.classList.remove('deadline-drop-active');

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Process each file concurrently — results append to table as they arrive
    const promises = files.map(file => extractFileIntoTable(table, file));
    await Promise.allSettled(promises);
  });
}

async function insertDeadlinesTemplate() {
  const tableHTML = `
<div class="deadline-table" contenteditable="false">
  <div class="deadline-header">
    <div></div>
    <div>assignment</div>
    <div>deadline</div>
    <div>class</div>
    <div>status</div>
    <div>notes</div>
  </div>
  <div class="deadline-row">
    ${getDeadlineRowHTML()}
  </div>
  <div class="deadline-ghost-row">
    <div>+</div>
    <div>Assignment...</div>
    <div>Date...</div>
    <div>Class...</div>
    <div>Status</div>
    <div></div>
  </div>
</div>`;

  editor.innerHTML = tableHTML;
  editor.classList.add('has-content');

  // Set up event handlers
  const table = editor.querySelector('.deadline-table');
  if (table) setupDeadlineTableHandlers(table);

  editor.removeEventListener('keydown', handleDeadlineTableKeydown);
  editor.addEventListener('keydown', handleDeadlineTableKeydown);

  // Focus first editable cell
  const firstCell = editor.querySelector('.deadline-col-name');
  if (firstCell) {
    setTimeout(() => firstCell.focus(), 0);
  }
}
