// ui-formatting.js — UI toggles, help modal, and text formatting toolbar

// Autocomplete toggle functionality
const toggleButton = document.getElementById('toggle-button');

if (toggleButton) {
  // Ensure initial pressed state matches current value
  toggleButton.classList.toggle('active', mediaAutocompleteEnabled);

  toggleButton.addEventListener('click', () => {
    mediaAutocompleteEnabled = !mediaAutocompleteEnabled;
    toggleButton.classList.toggle('active', mediaAutocompleteEnabled);

    if (mediaAutocompleteEnabled) {
      // Trigger autocomplete search if editor has content
      if (editor.style.display !== 'none' && editor.innerText.trim().length >= 3) {
        handleAutocompleteSearch();
      }
    } else {
      hideAutocomplete(); // Hide autocomplete when switching to text mode
    }
  });
}

// LaTeX toggle functionality
const latexToggleButton = document.getElementById('latex-toggle-button');
if (latexToggleButton) {
  latexToggleButton.classList.toggle('active', latexModeEnabled);
  latexToggleButton.addEventListener('click', () => {
    latexModeEnabled = !latexModeEnabled;
    latexToggleButton.classList.toggle('active', latexModeEnabled);
  });
}

// Help modal functionality
const helpButton = document.getElementById('help-button');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');

if (helpButton) {
  helpButton.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });
}

if (helpClose) {
  helpClose.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });
}

if (helpModal) {
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.classList.add('hidden');
    }
  });
  // Help category toggles
  helpModal.querySelectorAll('.help-category-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.closest('.help-category');
      const isOpen = cat.getAttribute('data-open') === 'true';
      cat.setAttribute('data-open', isOpen ? 'false' : 'true');
    });
  });
}

// ——— Text format bar ———
function updateFormatBarState() {
  if (!formatBar || !editor || document.activeElement !== editor) return;
  if (formatBtnBold) formatBtnBold.classList.toggle('active', document.queryCommandState('bold'));
  if (formatBtnItalic) formatBtnItalic.classList.toggle('active', document.queryCommandState('italic'));
  if (formatBtnUnderline) formatBtnUnderline.classList.toggle('active', document.queryCommandState('underline'));
  if (formatBtnStrike) formatBtnStrike.classList.toggle('active', document.queryCommandState('strikeThrough'));
}

function saveSelectionInEditor() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  return { range };
}

function restoreSelection(saved) {
  if (!saved || !saved.range) return;
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved.range);
  } catch (_) {}
}

function getSelectionFontSize() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    // No selection - return editor's base font size
    const editorFontSize = parseFloat(window.getComputedStyle(editor).fontSize);
    return isNaN(editorFontSize) ? 16 : Math.round(editorFontSize);
  }
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!editor.contains(node)) {
    // Fallback to editor's base font size
    const editorFontSize = parseFloat(window.getComputedStyle(editor).fontSize);
    return isNaN(editorFontSize) ? 16 : Math.round(editorFontSize);
  }
  const px = parseFloat(window.getComputedStyle(node).fontSize);
  return isNaN(px) ? 16 : Math.round(px);
}

function applyFontSizePx(px, savedSelection) {
  editor.focus();
  if (savedSelection) restoreSelection(savedSelection);
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
  const size = Math.min(72, Math.max(10, Number(px) || 16));
  const range = sel.getRangeAt(0);

  if (range.collapsed) {
    // For collapsed cursor: insert a zero-width space in a span with the font size
    // This ensures future typing inherits the font size without affecting existing text
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    span.appendChild(document.createTextNode('\u200B')); // Zero-width space
    range.insertNode(span);

    // Position cursor after the zero-width space inside the span
    const newRange = document.createRange();
    newRange.setStart(span.firstChild, 1);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    if (formatFontPx) formatFontPx.value = size;
    updateFormatBarState();
  } else {
    // For selection: wrap in span with font-size
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);

    // Select the wrapped content
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(newRange);

    if (formatFontPx) formatFontPx.value = size;
    updateFormatBarState();
  }

  // Update editing border dimensions to match new font size
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (entryData && entryData.element) {
      // Use requestAnimationFrame to ensure DOM is updated with new font size
      requestAnimationFrame(() => {
        updateEditingBorderDimensions(entryData.element);
      });
    }
  }
}

function applyFormat(cmd, value, savedSelection) {
  editor.focus();
  if (savedSelection) restoreSelection(savedSelection);
  document.execCommand(cmd, false, value);
  updateFormatBarState();
}

if (formatBar && editor) {
  editor.addEventListener('focus', () => {
    updateFormatBarState();
    if (formatFontPx) formatFontPx.value = getSelectionFontSize();
  });

  editor.addEventListener('selectionchange', () => {
    updateFormatBarState();
    if (formatFontPx && document.activeElement === editor) formatFontPx.value = getSelectionFontSize();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) {
      updateFormatBarState();
      if (formatFontPx) formatFontPx.value = getSelectionFontSize();
    }
  });
}

function handleFormatButton(cmd, value) {
  return (e) => {
    e.preventDefault();
    const saved = saveSelectionInEditor();
    applyFormat(cmd, value, saved);
  };
}

if (formatFontDecrease) formatFontDecrease.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const saved = saveSelectionInEditor();
  const current = getSelectionFontSize();
  applyFontSizePx(current - 2, saved);
});
if (formatFontIncrease) formatFontIncrease.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const saved = saveSelectionInEditor();
  const current = getSelectionFontSize();
  applyFontSizePx(current + 2, saved);
});
if (formatFontPx) {
  const applyFontPxFromInput = () => {
    const saved = saveSelectionInEditor();
    const px = parseInt(formatFontPx.value, 10);
    if (!isNaN(px)) applyFontSizePx(px, saved);
  };
  formatFontPx.addEventListener('change', applyFontPxFromInput);
  formatFontPx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFontPxFromInput();
      editor.focus();
    }
  });
  formatFontPx.addEventListener('blur', () => {
    if (editor.style.display === 'block') editor.focus();
  });
  formatFontPx.addEventListener('mousedown', (e) => e.stopPropagation());
}
if (formatBtnBold) formatBtnBold.addEventListener('mousedown', handleFormatButton('bold'));
if (formatBtnItalic) formatBtnItalic.addEventListener('mousedown', handleFormatButton('italic'));
if (formatBtnUnderline) formatBtnUnderline.addEventListener('mousedown', handleFormatButton('underline'));
if (formatBtnStrike) formatBtnStrike.addEventListener('mousedown', handleFormatButton('strikeThrough'));

if (formatBar) {
  formatBar.addEventListener('mousedown', (e) => {
    if (formatFontPx && (e.target === formatFontPx || formatFontPx.contains(e.target))) return;
    e.preventDefault();
  });
}
