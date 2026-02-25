// article.js — Article view, Google Calendar integration, and final initialization
function setViewMode(mode) {
  if (mode === currentViewMode) return;

  // Just toggle the flag — research entries are real and persist
  if (researchModeEnabled && mode !== 'research') {
    researchModeEnabled = false;
  }

  currentViewMode = mode;

  viewToggleCanvas.classList.toggle('active', mode === 'canvas');
  viewToggleArticle.classList.toggle('active', mode === 'article');
  if (viewToggleResearch) viewToggleResearch.classList.toggle('active', mode === 'research');
  document.body.classList.toggle('article-mode', mode === 'article');

  if (mode === 'article') {
    researchModeEnabled = false;
    viewport.style.display = 'none';
    if (editingEntryId) {
      editor.blur();
      hideCursor();
    }
    articleView.classList.remove('hidden');
    renderArticleView();
  } else if (mode === 'research') {
    researchModeEnabled = true;
    articleView.classList.add('hidden');
    viewport.style.display = '';
    // Recalculate entry dimensions when switching
    setTimeout(() => {
      entries.forEach((ed, id) => {
        if (id === 'anchor') return;
        if (ed.element && ed.element.style.display !== 'none') {
          updateEntryDimensions(ed.element);
        }
      });
    }, 50);
  } else {
    // canvas mode
    researchModeEnabled = false;
    articleView.classList.add('hidden');
    viewport.style.display = '';
    // Recalculate entry dimensions when switching back
    setTimeout(() => {
      entries.forEach((ed, id) => {
        if (id === 'anchor') return;
        if (ed.element && ed.element.style.display !== 'none') {
          updateEntryDimensions(ed.element);
        }
      });
    }, 50);
  }
}

function getArticleCategory(ed) {
  const mcd = ed.mediaCardData;
  if (mcd && mcd.type === 'image') return 'images';
  if (mcd && mcd.type === 'file') return 'files';
  if (mcd && mcd.type === 'song') return 'songs';
  if (mcd && mcd.type === 'movie') return 'movies';
  if (ed.latexData && ed.latexData.enabled) return 'latex';
  if (ed.textHtml && ed.textHtml.includes('deadline-table')) return 'deadlines';
  if (ed.linkCardsData && ed.linkCardsData.length > 0 && ed.linkCardsData.some(c => c && c.url)) return 'links';
  return 'notes';
}

function getFlattenedArticleEntries() {
  const list = [];
  entries.forEach((ed) => {
    if (ed.id === 'anchor') return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    const cat = getArticleCategory(ed);
    list.push({ ed, category: cat });
  });
  list.sort((a, b) => {
    const ay = a.ed.position?.y ?? 0;
    const by = b.ed.position?.y ?? 0;
    if (ay !== by) return ay - by;
    return (a.ed.position?.x ?? 0) - (b.ed.position?.x ?? 0);
  });
  return list;
}

function renderArticleView() {
  const flattened = getFlattenedArticleEntries();
  const totalCount = flattened.length;

  let titleText = 'Home';
  if (currentViewEntryId) {
    const parent = entries.get(currentViewEntryId);
    if (parent) titleText = entryTitle(parent);
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  articleHeader.innerHTML = `<h1 class="article-header-title">${escapeHtml(titleText)}</h1><div class="article-header-meta">${totalCount} item${totalCount !== 1 ? 's' : ''} &middot; ${dateStr}</div>`;

  if (articleSidebarNav) articleSidebarNav.innerHTML = '';

  articleContent.innerHTML = '';
  if (totalCount === 0) {
    articleContent.innerHTML = '<div class="article-empty">No entries on this page yet.</div>';
    articleAiSection.classList.add('hidden');
    return;
  }

  const stream = document.createElement('div');
  stream.className = 'article-stream';
  flattened.forEach(({ ed, category }) => {
    const el = renderArticleEntry(ed, category);
    if (el) stream.appendChild(el);
  });
  articleContent.appendChild(stream);

  fetchArticleRelated();
}

function renderArticleEntry(ed, category) {
  switch (category) {
    case 'notes': {
      const card = document.createElement('div');
      card.className = 'article-note-card';
      if (ed.textHtml) {
        card.innerHTML = ed.textHtml;
      } else {
        card.textContent = ed.text || '';
      }
      // Check if this entry has children
      const hasChildren = Array.from(entries.values()).some(e => e.parentEntryId === ed.id);
      if (hasChildren) {
        card.classList.add('clickable');
        const hint = document.createElement('div');
        hint.className = 'article-note-children-hint';
        hint.textContent = 'Open subpage \u2192';
        card.appendChild(hint);
        card.addEventListener('click', () => navigateToEntry(ed.id));
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
      // Also show the text if any (above the link cards)
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

function fetchArticleRelated() {
  if (!currentUser) {
    articleAiSection.classList.add('hidden');
    return;
  }
  articleAiSection.classList.remove('hidden');
  articleAiContent.innerHTML = '<div class="article-related-loading">Finding related content…</div>';

  const payload = buildTrenchesPayload();
  const body = {
    ...payload,
    userMessage: `RELATED CONTENT TASK: Suggest 3–5 real articles and books that fit the content and aesthetic of this page.

Only recommend actual, well-known works: real book titles with authors, real essay/article titles with publications or authors. Never invent or make up titles. Draw from your knowledge of classic and notable works.

Format: One line per item. "Title" by Author (or "Article Title" – Publication). No asterisks, no markdown, no links. Plain text only.

Examples: "Bullshit Jobs" by David Graeber | "Consider the Lobster" – David Foster Wallace, The Atlantic`
  };
  fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
    .then(data => {
      let raw = (data.message || '').trim();
      raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/\*+/g, '').replace(/^#+\s*/gm, '');
      articleAiContent.innerHTML = `<div class="article-related-card">${escapeHtml(raw)}</div>`;
    })
    .catch(() => {
      articleAiContent.innerHTML = '<div class="article-related-loading">Could not load related content.</div>';
    });
}

// Toggle event listeners
if (viewToggleCanvas) viewToggleCanvas.addEventListener('click', () => setViewMode('canvas'));
if (viewToggleArticle) viewToggleArticle.addEventListener('click', () => setViewMode('article'));
if (viewToggleResearch) viewToggleResearch.addEventListener('click', () => setViewMode('research'));

// Patch navigation functions to re-render article view
const _origNavigateToEntry = navigateToEntry;
navigateToEntry = function(entryId) {
  _origNavigateToEntry(entryId);
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

const _origNavigateBack = navigateBack;
navigateBack = function(level) {
  _origNavigateBack(level);
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

const _origNavigateToRoot = navigateToRoot;
navigateToRoot = function() {
  _origNavigateToRoot();
  if (currentViewMode === 'article') setTimeout(() => renderArticleView(), 300);
};

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

bootstrap();

// Check Google status after auth loads
setTimeout(() => {
  if (currentUser) checkGoogleStatus();
}, 2000);
