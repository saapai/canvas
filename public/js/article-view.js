// article-view.js — Article mode rendering for Amia's Project Lux page
// Only activates when PAGE_VIEW_MODE === 'article'

const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');

// Phrase detection cache: entryId -> { phrases, timestamp }
const phraseCache = new Map();
const PHRASE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track which entry card is currently being edited
let activeArticleEditor = null;

function shouldUseArticleMode() {
  return window.PAGE_VIEW_MODE === 'article';
}

function articleCanEdit() {
  return window.PAGE_IS_OWNER || window.PAGE_EDITOR_ROLE === 'admin';
}

// ——— Activate article mode ———
function activateArticleMode() {
  if (!articleView) return;
  document.body.classList.add('article-mode');
  articleView.classList.remove('hidden');

  // Hide the sidebar — Substack-style, just title + content
  const sidebar = document.querySelector('.article-sidebar');
  if (sidebar) sidebar.style.display = 'none';

  // Show share button
  const shareBtn = document.getElementById('share-button');
  if (shareBtn && (window.PAGE_IS_OWNER || window.PAGE_IS_EDITOR)) {
    shareBtn.classList.remove('hidden');
  }

  // Move format bar out of #topbar to body so it can be positioned freely
  if (articleCanEdit() && formatBar) {
    document.body.appendChild(formatBar);
    formatBar.classList.remove('hidden');
    formatBar.classList.add('article-format-bar');
  }

  // Join banner for visitors
  if (!window.PAGE_IS_OWNER && !window.PAGE_IS_EDITOR && !currentUser) {
    showJoinBanner();
  }

  waitForEntries(() => renderArticleView());
}

function waitForEntries(cb, attempts = 0) {
  if (entries.size > 1 || attempts > 20) {
    cb();
  } else {
    setTimeout(() => waitForEntries(cb, attempts + 1), 200);
  }
}

// ——— Categorize entries ———
function categorizeCurrentEntries() {
  const cats = { notes: [], links: [], songs: [], movies: [], images: [], files: [], latex: [], deadlines: [] };
  entries.forEach((ed) => {
    if (ed.id === 'anchor') return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    const mcd = ed.mediaCardData;
    if (mcd && mcd.type === 'image') { cats.images.push(ed); return; }
    if (mcd && mcd.type === 'file') { cats.files.push(ed); return; }
    if (mcd && mcd.type === 'song') { cats.songs.push(ed); return; }
    if (mcd && mcd.type === 'movie') { cats.movies.push(ed); return; }
    if (ed.latexData && ed.latexData.enabled) { cats.latex.push(ed); return; }
    if (ed.textHtml && ed.textHtml.includes('deadline-table')) { cats.deadlines.push(ed); return; }
    if (ed.linkCardsData && ed.linkCardsData.length > 0 && ed.linkCardsData.some(c => c && c.url)) { cats.links.push(ed); return; }
    cats.notes.push(ed);
  });
  return cats;
}

// ——— Render article view (Substack-style: title then content) ———
function renderArticleView() {
  if (!articleView || articleView.classList.contains('hidden')) return;
  const cats = categorizeCurrentEntries();

  // Title
  let titleText = 'Project Lux';
  if (currentViewEntryId) {
    const parent = entries.get(currentViewEntryId);
    if (parent) titleText = entryTitle(parent);
  }
  articleHeader.innerHTML = `<h1 class="article-header-title">${escapeHtml(titleText)}</h1>`;

  // Content — no section headings, no categories, just entries as plain text
  articleContent.innerHTML = '';

  // Render all note entries as seamless paragraphs
  const allEntries = [];
  entries.forEach((ed) => {
    if (ed.id === 'anchor') return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    allEntries.push(ed);
  });

  if (allEntries.length === 0 && !articleCanEdit()) {
    articleContent.innerHTML = '<div class="article-empty">Nothing here yet.</div>';
    return;
  }

  // Render each entry
  allEntries.forEach(ed => {
    const el = renderArticleEntry(ed);
    if (el) articleContent.appendChild(el);
  });

  // "Start writing..." area at bottom
  if (articleCanEdit()) {
    const newArea = document.createElement('div');
    newArea.className = 'article-new-entry';
    newArea.setAttribute('contenteditable', 'true');
    newArea.setAttribute('data-placeholder', 'Start writing...');

    newArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = newArea.innerText.trim();
        const html = newArea.innerHTML;
        if (text) {
          newArea.setAttribute('contenteditable', 'false');
          saveNewArticleEntry(text, html).then(() => {
            renderArticleView();
            setTimeout(() => {
              const area = articleContent.querySelector('.article-new-entry');
              if (area) area.focus();
            }, 50);
          });
        }
      }
    });

    articleContent.appendChild(newArea);
  }

  // Auto-meltify: detect phrases for note entries
  if (currentUser) {
    allEntries.forEach(ed => {
      // Only meltify text-based entries (not media/links/etc)
      const mcd = ed.mediaCardData;
      if (mcd) return;
      if (ed.latexData && ed.latexData.enabled) return;
      if (ed.textHtml && ed.textHtml.includes('deadline-table')) return;
      detectAndHighlightPhrases(ed);
    });
  }
}

// ——— Render individual entry (unified, no category separation) ———
function renderArticleEntry(ed) {
  const mcd = ed.mediaCardData;

  // Image
  if (mcd && mcd.type === 'image' && mcd.url) {
    const card = document.createElement('div');
    card.className = 'article-image-card';
    const img = document.createElement('img');
    img.src = mcd.url;
    img.alt = 'Image';
    img.loading = 'lazy';
    card.appendChild(img);
    return card;
  }

  // File
  if (mcd && mcd.type === 'file') {
    const card = document.createElement('div');
    card.className = 'article-file-card';
    card.innerHTML = `<span class="article-file-icon">${getFileIcon(mcd.mimetype || '')}</span>
      <div>
        <div class="article-file-name">${escapeHtml(mcd.name || 'File')}</div>
        <div class="article-file-size">${formatFileSize(mcd.size || 0)}</div>
      </div>`;
    if (mcd.url) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => window.open(mcd.url, '_blank'));
    }
    return card;
  }

  // Song / Movie
  if (mcd && (mcd.type === 'song' || mcd.type === 'movie')) {
    const card = document.createElement('div');
    card.className = 'article-media-card';
    const imageUrl = mcd.image || mcd.poster || '';
    const typeLabel = mcd.type === 'song' ? 'Song' : 'Movie';
    const subtitle = mcd.type === 'song' ? (mcd.artist || '') : (mcd.year ? String(mcd.year) : '');
    card.innerHTML = `${imageUrl ? `<div class="article-media-image" style="background-image:url('${imageUrl}')"></div>` : ''}
      <div class="article-media-info">
        <div class="article-media-type">${typeLabel}</div>
        <div class="article-media-title">${escapeHtml(mcd.title || '')}</div>
        ${subtitle ? `<div class="article-media-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>`;
    return card;
  }

  // LaTeX
  if (ed.latexData && ed.latexData.enabled) {
    const card = document.createElement('div');
    card.className = 'article-latex-card';
    if (ed.latexData.source) {
      const container = document.createElement('div');
      card.appendChild(container);
      setTimeout(() => {
        if (typeof renderMathInElement !== 'undefined') {
          container.innerHTML = ed.latexData.source;
          renderMathInElement(container, { delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ], throwOnError: false });
        } else if (typeof katex !== 'undefined') {
          try { katex.render(ed.latexData.source, container, { displayMode: true, throwOnError: false }); }
          catch(e) { container.textContent = ed.latexData.source; }
        } else {
          container.textContent = ed.latexData.source;
        }
      }, 100);
    }
    return card;
  }

  // Deadline table
  if (ed.textHtml && ed.textHtml.includes('deadline-table')) {
    const card = document.createElement('div');
    card.className = 'article-deadline-card';
    if (ed.element) {
      const dt = ed.element.querySelector('.deadline-table');
      if (dt) card.appendChild(dt.cloneNode(true));
      else if (ed.textHtml) card.innerHTML = ed.textHtml;
    } else if (ed.textHtml) {
      card.innerHTML = ed.textHtml;
    }
    return card;
  }

  // Links
  if (ed.linkCardsData && ed.linkCardsData.length > 0 && ed.linkCardsData.some(c => c && c.url)) {
    const frag = document.createDocumentFragment();
    (ed.linkCardsData || []).forEach(lc => {
      if (!lc || !lc.url) return;
      const a = document.createElement('a');
      a.className = 'article-link-card';
      a.href = lc.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `${lc.image ? `<div class="article-link-thumb" style="background-image:url('${lc.image}')"></div>` : ''}
        <div class="article-link-body">
          <div class="article-link-site">${escapeHtml(lc.siteName || '')}</div>
          <div class="article-link-title">${escapeHtml(lc.title || '')}</div>
          ${lc.description ? `<div class="article-link-desc">${escapeHtml(lc.description)}</div>` : ''}
          <div class="article-link-open">Open link &rarr;</div>
        </div>`;
      frag.appendChild(a);
    });
    const wrapper = document.createElement('div');
    if (ed.text && ed.text.trim()) {
      const textP = document.createElement('div');
      textP.className = 'article-note-card';
      textP.dataset.entryId = ed.id;
      textP.textContent = ed.text;
      wrapper.appendChild(textP);
    }
    wrapper.appendChild(frag);
    return wrapper;
  }

  // Default: note/text entry — seamless paragraph
  const card = document.createElement('div');
  card.className = 'article-note-card';
  card.dataset.entryId = ed.id;

  if (ed.textHtml) {
    card.innerHTML = ed.textHtml;
  } else {
    card.textContent = ed.text || '';
  }

  const hasChildren = Array.from(entries.values()).some(e => e.parentEntryId === ed.id);
  if (hasChildren) card.classList.add('has-children');

  // Click/dblclick handling
  let clickTimer = null;

  if (articleCanEdit()) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.article-clickable-phrase')) return;
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        startArticleEdit(card, ed);
      }, 200);
    });
  }

  // Double-click: phrase → create subpage; has-children → traverse
  card.addEventListener('dblclick', (e) => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    const phraseEl = e.target.closest('.article-clickable-phrase');
    if (phraseEl) {
      createSubpageFromPhrase(phraseEl.dataset.phrase, ed.id);
      return;
    }
    if (hasChildren) navigateToEntry(ed.id);
  });

  return card;
}

// ——— Inline editing ———
function startArticleEdit(card, ed) {
  if (activeArticleEditor === card) return;
  if (activeArticleEditor) {
    finishArticleEdit(activeArticleEditor, activeArticleEditor._editEntry);
  }

  activeArticleEditor = card;
  card._editEntry = ed;

  // Restore clean HTML (strip melt spans)
  if (ed.textHtml) {
    card.innerHTML = ed.textHtml;
  } else {
    card.textContent = ed.text || '';
  }

  card.setAttribute('contenteditable', 'true');
  card.classList.add('editing');
  card.focus();

  // Cursor at end
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(card);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  function onBlur() {
    card.removeEventListener('blur', onBlur);
    card.removeEventListener('keydown', onKey);
    finishArticleEdit(card, ed);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      card.blur();
    }
    if (e.key === 'Escape') {
      if (ed.textHtml) card.innerHTML = ed.textHtml;
      else card.textContent = ed.text || '';
      card.removeEventListener('blur', onBlur);
      card.removeEventListener('keydown', onKey);
      card.setAttribute('contenteditable', 'false');
      card.classList.remove('editing');
      if (activeArticleEditor === card) activeArticleEditor = null;
      if (currentUser) detectAndHighlightPhrases(ed);
    }
  }

  card.addEventListener('blur', onBlur);
  card.addEventListener('keydown', onKey);
}

function finishArticleEdit(card, ed) {
  card.setAttribute('contenteditable', 'false');
  card.classList.remove('editing');
  if (activeArticleEditor === card) activeArticleEditor = null;

  const newText = card.innerText.trim();
  const newHtml = card.innerHTML;

  if (newText !== (ed.text || '').trim()) {
    ed.text = newText;
    ed.textHtml = newHtml;
    const pageOwnerId = getPageOwnerIdForEntry(ed.id);
    fetch(`/api/entries/${ed.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText, textHtml: newHtml, position: ed.position, pageOwnerId })
    }).catch(err => console.error('Failed to save:', err));
    phraseCache.delete(ed.id);
  }

  // Re-meltify after edit
  if (currentUser) detectAndHighlightPhrases(ed);
}

// ——— Save a new entry ———
async function saveNewArticleEntry(text, html) {
  const id = generateEntryId();
  const position = { x: 100, y: 100 + entries.size * 50 };
  const parentEntryId = currentViewEntryId || null;
  const pageOwnerId = window.PAGE_OWNER_ID;

  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text, textHtml: html, position, parentEntryId, pageOwnerId })
    });

    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.id = id;
    entry.style.display = 'none';
    world.appendChild(entry);

    entries.set(id, { id, text, textHtml: html, position, parentEntryId, element: entry });
  } catch (err) {
    console.error('Failed to create article entry:', err);
  }
}

// ——— AI Phrase Detection & Auto-meltify ———
async function detectAndHighlightPhrases(ed) {
  if (!ed.text || ed.text.trim().length < 5) return;
  const card = articleContent.querySelector(`[data-entry-id="${ed.id}"]`);
  if (!card) return;
  if (card.getAttribute('contenteditable') === 'true') return;

  const cached = phraseCache.get(ed.id);
  if (cached && Date.now() - cached.timestamp < PHRASE_CACHE_TTL) {
    applyPhraseHighlights(card, cached.phrases, ed);
    return;
  }

  try {
    const res = await fetch('/api/detect-phrases', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ed.text })
    });
    if (!res.ok) return;
    const data = await res.json();
    const phrases = data.phrases || [];
    phraseCache.set(ed.id, { phrases, timestamp: Date.now() });
    applyPhraseHighlights(card, phrases, ed);
  } catch (err) {
    // Silently fail
  }
}

function applyPhraseHighlights(card, phrases, ed) {
  if (!phrases.length) return;
  if (card.querySelector('.article-clickable-phrase')) return;

  let html = card.innerHTML;
  phrases.forEach(p => {
    if (!p.phrase) return;
    const escapedPhrase = p.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedPhrase})`, 'gi');
    html = html.replace(regex, (match) => {
      const meltChars = match.split('').map((ch, i) => {
        const delay = i * 30;
        const drip = Math.random() < 0.15 ? ' drip' : '';
        return `<span data-ch="${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}" style="animation-delay:${delay}ms"${drip ? ` class="${drip.trim()}"` : ''}>${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`;
      }).join('');
      return `<span class="article-clickable-phrase melt" data-phrase="${escapeHtml(match)}" data-category="${escapeHtml(p.category || '')}">${meltChars}</span>`;
    });
  });
  card.innerHTML = html;
}

async function createSubpageFromPhrase(phrase, parentId) {
  const id = generateEntryId();
  const position = { x: 100, y: 100 };
  const pageOwnerId = window.PAGE_OWNER_ID;

  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        text: phrase,
        textHtml: `<span>${escapeHtml(phrase)}</span>`,
        position,
        parentEntryId: parentId,
        pageOwnerId
      })
    });

    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.id = id;
    entry.style.display = 'none';
    world.appendChild(entry);

    entries.set(id, {
      id, text: phrase,
      textHtml: `<span>${escapeHtml(phrase)}</span>`,
      position, parentEntryId: parentId, element: entry
    });

    navigateToEntry(parentId);
  } catch (err) {
    console.error('Failed to create subpage from phrase:', err);
  }
}

// ——— Join banner ———
function showJoinBanner() {
  const banner = document.createElement('div');
  banner.className = 'article-join-banner';
  banner.innerHTML = `
    <span class="article-join-banner-text">Join Project Lux</span>
    <a href="sms:+17139626862&body=LUX" class="article-join-banner-cta">
      Text "LUX" to join
    </a>
  `;
  document.body.appendChild(banner);
}

// ——— Patch navigation ———
if (shouldUseArticleMode()) {
  const _origNavigateToEntry = navigateToEntry;
  navigateToEntry = function(entryId) {
    _origNavigateToEntry(entryId);
    if (shouldUseArticleMode()) setTimeout(() => renderArticleView(), 300);
  };

  const _origNavigateBack = navigateBack;
  navigateBack = function(level) {
    _origNavigateBack(level);
    if (shouldUseArticleMode()) setTimeout(() => renderArticleView(), 300);
  };

  const _origNavigateToRoot = navigateToRoot;
  navigateToRoot = function() {
    _origNavigateToRoot();
    if (shouldUseArticleMode()) setTimeout(() => renderArticleView(), 300);
  };
}

// ——— Initialize ———
if (shouldUseArticleMode()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateArticleMode);
  } else {
    activateArticleMode();
  }
}
