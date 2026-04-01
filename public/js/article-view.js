// article-view.js — Article mode rendering for Amia's Project Lux page
// Only activates when PAGE_VIEW_MODE === 'article'

const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');

// Phrase detection cache: entryId -> { phrases, timestamp }
const phraseCache = new Map();
const PHRASE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Check if article mode should activate
function shouldUseArticleMode() {
  return window.PAGE_VIEW_MODE === 'article';
}

// Check if current user can edit
function articleCanEdit() {
  return window.PAGE_IS_OWNER || window.PAGE_EDITOR_ROLE === 'admin';
}

// ——— Activate article mode ———
function activateArticleMode() {
  if (!articleView) return;
  document.body.classList.add('article-mode');
  articleView.classList.remove('hidden');

  // Show share button in article mode too
  const shareBtn = document.getElementById('share-button');
  if (shareBtn && (window.PAGE_IS_OWNER || window.PAGE_IS_EDITOR)) {
    shareBtn.classList.remove('hidden');
  }

  // Show join banner for non-logged-in visitors
  if (!window.PAGE_IS_OWNER && !window.PAGE_IS_EDITOR && !currentUser) {
    showJoinBanner();
  }

  // Initial render after entries load
  waitForEntries(() => {
    renderArticleView();
  });
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

// ——— Render article view ———
function renderArticleView() {
  if (!articleView || articleView.classList.contains('hidden')) return;
  const cats = categorizeCurrentEntries();
  const totalCount = Object.values(cats).reduce((s, a) => s + a.length, 0);

  // Header
  let titleText = window.PAGE_USERNAME || 'Home';
  if (currentViewEntryId) {
    const parent = entries.get(currentViewEntryId);
    if (parent) titleText = entryTitle(parent);
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  articleHeader.innerHTML = `<h1 class="article-header-title">${escapeHtml(titleText)}</h1><div class="article-header-meta">${totalCount} item${totalCount !== 1 ? 's' : ''} &middot; ${dateStr}</div>`;

  // Sidebar
  const categoryLabels = { notes: 'Notes', links: 'Links', songs: 'Songs', movies: 'Movies', images: 'Images', files: 'Files', latex: 'LaTeX', deadlines: 'Deadlines' };
  articleSidebarNav.innerHTML = '';
  for (const [key, label] of Object.entries(categoryLabels)) {
    if (cats[key].length === 0) continue;
    const item = document.createElement('div');
    item.className = 'article-sidebar-item';
    item.innerHTML = `<span>${label}</span><span class="article-sidebar-count">${cats[key].length}</span>`;
    item.addEventListener('click', () => {
      const section = document.getElementById('article-section-' + key);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      articleSidebarNav.querySelectorAll('.article-sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
    articleSidebarNav.appendChild(item);
  }

  // Content sections
  articleContent.innerHTML = '';
  if (totalCount === 0) {
    articleContent.innerHTML = '<div class="article-empty">No entries on this page yet.</div>';
    if (articleCanEdit()) {
      const addBtn = createAddEntryButton();
      articleContent.appendChild(addBtn);
    }
    return;
  }

  for (const [key, label] of Object.entries(categoryLabels)) {
    if (cats[key].length === 0) continue;
    const section = document.createElement('div');
    section.id = 'article-section-' + key;
    const heading = document.createElement('h2');
    heading.className = 'article-section-heading';
    heading.textContent = label;
    section.appendChild(heading);
    cats[key].forEach(ed => {
      const el = renderArticleEntry(ed, key);
      if (el) section.appendChild(el);
    });
    // Add "new entry" button for admins
    if (articleCanEdit()) {
      section.appendChild(createAddEntryButton());
    }
    articleContent.appendChild(section);
  }

  // Detect AI phrases for note entries
  if (currentUser) {
    cats.notes.forEach(ed => detectAndHighlightPhrases(ed));
  }
}

// ——— Render individual entry ———
function renderArticleEntry(ed, category) {
  switch (category) {
    case 'notes': {
      const card = document.createElement('div');
      card.className = 'article-note-card';
      card.dataset.entryId = ed.id;
      if (ed.textHtml) {
        card.innerHTML = ed.textHtml;
      } else {
        card.textContent = ed.text || '';
      }
      // Check for children → make clickable
      const hasChildren = Array.from(entries.values()).some(e => e.parentEntryId === ed.id);
      if (hasChildren) {
        card.classList.add('clickable');
        const hint = document.createElement('div');
        hint.className = 'article-note-children-hint';
        hint.textContent = 'Open subpage \u2192';
        card.appendChild(hint);
        card.addEventListener('click', (e) => {
          if (e.target.classList.contains('article-clickable-phrase')) return;
          navigateToEntry(ed.id);
        });
      }
      // Make editable for admins
      if (articleCanEdit() && !hasChildren) {
        card.classList.add('editable');
        card.addEventListener('click', () => startArticleEdit(card, ed));
      }
      return card;
    }
    case 'links': {
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
            <div class="article-link-open">Open link \u2192</div>
          </div>`;
        frag.appendChild(a);
      });
      if (ed.text && ed.text.trim()) {
        const wrapper = document.createElement('div');
        const textDiv = document.createElement('div');
        textDiv.className = 'article-note-card';
        textDiv.style.marginBottom = '8px';
        textDiv.textContent = ed.text;
        wrapper.appendChild(textDiv);
        wrapper.appendChild(frag);
        return wrapper;
      }
      return frag.childNodes.length > 0 ? (() => { const d = document.createElement('div'); d.appendChild(frag); return d; })() : null;
    }
    case 'songs':
    case 'movies': {
      const mcd = ed.mediaCardData;
      if (!mcd) return null;
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
    case 'images': {
      const mcd = ed.mediaCardData;
      if (!mcd || !mcd.url) return null;
      const card = document.createElement('div');
      card.className = 'article-image-card';
      const img = document.createElement('img');
      img.src = mcd.url;
      img.alt = 'Image';
      img.loading = 'lazy';
      card.appendChild(img);
      return card;
    }
    case 'files': {
      const mcd = ed.mediaCardData;
      if (!mcd) return null;
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
    case 'latex': {
      const card = document.createElement('div');
      card.className = 'article-latex-card';
      if (ed.latexData && ed.latexData.source) {
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
    case 'deadlines': {
      const card = document.createElement('div');
      card.className = 'article-deadline-card';
      if (ed.element) {
        const dt = ed.element.querySelector('.deadline-table');
        if (dt) {
          card.appendChild(dt.cloneNode(true));
        } else if (ed.textHtml) {
          card.innerHTML = ed.textHtml;
        }
      } else if (ed.textHtml) {
        card.innerHTML = ed.textHtml;
      }
      return card;
    }
    default:
      return null;
  }
}

// ——— Inline editing for article mode ———
let activeArticleEditor = null;

function startArticleEdit(card, ed) {
  if (activeArticleEditor) return;
  activeArticleEditor = card;
  card.classList.add('editing');
  card.contentEditable = 'true';
  card.focus();

  // Place cursor at end
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(card);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  function finishEdit() {
    card.removeEventListener('blur', finishEdit);
    card.removeEventListener('keydown', handleKey);
    card.contentEditable = 'false';
    card.classList.remove('editing');
    activeArticleEditor = null;

    const newText = card.innerText.trim();
    const newHtml = card.innerHTML;
    if (newText !== (ed.text || '').trim()) {
      // Save to server
      ed.text = newText;
      ed.textHtml = newHtml;
      const pageOwnerId = getPageOwnerIdForEntry(ed.id);
      fetch(`/api/entries/${ed.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newText,
          textHtml: newHtml,
          position: ed.position,
          pageOwnerId
        })
      }).catch(err => console.error('Failed to save article edit:', err));
      // Clear phrase cache for this entry
      phraseCache.delete(ed.id);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      card.blur();
    }
    if (e.key === 'Escape') {
      // Revert
      if (ed.textHtml) card.innerHTML = ed.textHtml;
      else card.textContent = ed.text || '';
      card.blur();
    }
  }

  card.addEventListener('blur', finishEdit);
  card.addEventListener('keydown', handleKey);
}

// ——— Add new entry ———
function createAddEntryButton() {
  const btn = document.createElement('button');
  btn.className = 'article-add-entry-btn';
  btn.innerHTML = '+ Add entry';
  btn.addEventListener('click', () => createNewArticleEntry());
  return btn;
}

async function createNewArticleEntry() {
  const id = generateEntryId();
  const position = { x: 100, y: 100 + entries.size * 50 };
  const parentEntryId = currentViewEntryId || null;
  const pageOwnerId = window.PAGE_OWNER_ID;

  // Create entry on server
  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        text: '',
        textHtml: '',
        position,
        parentEntryId,
        pageOwnerId
      })
    });

    // Add to local entries map
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.id = id;
    entry.style.display = 'none';
    world.appendChild(entry);

    entries.set(id, {
      id,
      text: '',
      textHtml: '',
      position,
      parentEntryId,
      element: entry
    });

    // Re-render and focus the new card
    renderArticleView();
    setTimeout(() => {
      const newCard = articleContent.querySelector(`[data-entry-id="${id}"]`);
      if (newCard) startArticleEdit(newCard, entries.get(id));
    }, 50);
  } catch (err) {
    console.error('Failed to create article entry:', err);
  }
}

// ——— AI Phrase Detection ———
async function detectAndHighlightPhrases(ed) {
  if (!ed.text || ed.text.trim().length < 20) return; // Skip short text
  const card = articleContent.querySelector(`[data-entry-id="${ed.id}"]`);
  if (!card) return;

  // Check cache
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
    // Silently fail — phrase detection is optional
  }
}

function applyPhraseHighlights(card, phrases, ed) {
  if (!phrases.length) return;
  // Don't re-apply if already highlighted
  if (card.querySelector('.article-clickable-phrase')) return;

  let html = card.innerHTML;
  phrases.forEach(p => {
    if (!p.phrase) return;
    const escapedPhrase = p.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedPhrase})`, 'gi');
    html = html.replace(regex, `<span class="article-clickable-phrase" data-phrase="$1" data-category="${escapeHtml(p.category || '')}">$1</span>`);
  });
  card.innerHTML = html;

  // Add click handlers to phrases
  card.querySelectorAll('.article-clickable-phrase').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      createSubpageFromPhrase(span.dataset.phrase, ed.id);
    });
  });
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
      id,
      text: phrase,
      textHtml: `<span>${escapeHtml(phrase)}</span>`,
      position,
      parentEntryId: parentId,
      element: entry
    });

    navigateToEntry(parentId);
  } catch (err) {
    console.error('Failed to create subpage from phrase:', err);
  }
}

// ——— Join banner for non-logged-in visitors ———
function showJoinBanner() {
  const banner = document.createElement('div');
  banner.className = 'article-join-banner';
  banner.innerHTML = `
    <span class="article-join-banner-text">Join Project Lux</span>
    <a href="imessage://+17139626862&body=LUX" class="article-join-banner-cta">
      Text "LUX" to join
    </a>
  `;
  document.body.appendChild(banner);
}

// ——— Patch navigation for article mode ———
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

// —���— Initialize ———
if (shouldUseArticleMode()) {
  // Wait for DOM ready / entries to load before activating
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateArticleMode);
  } else {
    activateArticleMode();
  }
}
