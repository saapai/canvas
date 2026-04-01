// article-view.js — Substack-style article mode
// Each "page" = one entry. Editable title + body. Regular click opens links.
// Sidebar lists pages. "+" creates a new page. Enter = paragraph.

const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');

let articleCurrentPageId = null;
let bodySaveTimer = null;
let titleSaveTimer = null;

function shouldUseArticleMode() {
  return window.PAGE_VIEW_MODE === 'article';
}

function articleCanEdit() {
  return window.PAGE_IS_OWNER || window.PAGE_EDITOR_ROLE === 'admin';
}

// ——— Get pages at the current navigation level ———
function getArticlePages() {
  const pages = [];
  entries.forEach(ed => {
    if (ed.id === 'anchor') return;
    if (ed.parentEntryId !== currentViewEntryId) return;
    if (ed.mediaCardData) return;
    if (ed.latexData && ed.latexData.enabled) return;
    if (ed.textHtml && ed.textHtml.includes('deadline-table')) return;
    if (!ed.text || !ed.text.trim()) return;
    pages.push(ed);
  });
  return pages;
}

function getPageTitle(ed) {
  if (!ed) return 'Untitled';
  const text = (ed.text || '').trim();
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 40) return firstLine.substring(0, 40) + '...';
  return firstLine || 'Untitled';
}

// ——— Activate ———
function activateArticleMode() {
  if (!articleView) return;
  document.body.classList.add('article-mode');
  articleView.classList.remove('hidden');

  const shareBtn = document.getElementById('share-button');
  if (shareBtn && (window.PAGE_IS_OWNER || window.PAGE_IS_EDITOR)) {
    shareBtn.classList.remove('hidden');
  }

  // Show format bar in its natural topbar position — don't move it
  if (articleCanEdit() && formatBar) {
    formatBar.classList.remove('hidden');
  }

  if (!window.PAGE_IS_OWNER && !window.PAGE_IS_EDITOR && !currentUser) {
    showJoinBanner();
  }

  waitForEntries(() => {
    const pages = getArticlePages();
    if (pages.length > 0) articleCurrentPageId = pages[0].id;
    renderArticleView();
  });
}

function waitForEntries(cb, attempts = 0) {
  if (entries.size > 1 || attempts > 20) cb();
  else setTimeout(() => waitForEntries(cb, attempts + 1), 200);
}

// ——— Render ———
function renderArticleView() {
  if (!articleView || articleView.classList.contains('hidden')) return;
  renderSidebar();
  renderPageContent();
}

function renderSidebar() {
  articleSidebarNav.innerHTML = '';
  const pages = getArticlePages();

  const label = document.createElement('div');
  label.className = 'article-sidebar-label';
  label.textContent = 'Pages';
  articleSidebarNav.appendChild(label);

  pages.forEach(ed => {
    const item = document.createElement('div');
    item.className = 'article-sidebar-item';
    if (articleCurrentPageId === ed.id) item.classList.add('active');
    item.innerHTML = `<span class="article-sidebar-title">${escapeHtml(getPageTitle(ed))}</span>`;

    if (articleCanEdit()) {
      const delBtn = document.createElement('button');
      delBtn.className = 'article-sidebar-delete';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete page';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePage(ed.id);
      });
      item.appendChild(delBtn);
    }

    item.addEventListener('click', () => {
      articleCurrentPageId = ed.id;
      renderArticleView();
    });
    articleSidebarNav.appendChild(item);
  });

  if (articleCanEdit()) {
    const addBtn = document.createElement('div');
    addBtn.className = 'article-sidebar-add';
    addBtn.textContent = '+ New Page';
    addBtn.addEventListener('click', () => createNewPage());
    articleSidebarNav.appendChild(addBtn);
  }
}

function renderPageContent() {
  articleContent.innerHTML = '';
  articleHeader.innerHTML = '';
  const pageEntry = articleCurrentPageId ? entries.get(articleCurrentPageId) : null;

  // Editable title — independent of body
  const titleEl = document.createElement('h1');
  titleEl.className = 'article-header-title';
  titleEl.setAttribute('data-placeholder', 'Untitled');

  if (pageEntry) {
    const existingTitle = (pageEntry.text || '').split('\n')[0].trim();
    if (existingTitle) titleEl.textContent = existingTitle;
  }

  if (articleCanEdit()) {
    titleEl.setAttribute('contenteditable', 'true');
    titleEl.addEventListener('input', () => {
      // Update entry text immediately so sidebar reflects changes
      if (pageEntry) pageEntry.text = titleEl.innerText.trim() || 'Untitled';
      renderSidebar();
      if (titleSaveTimer) clearTimeout(titleSaveTimer);
      titleSaveTimer = setTimeout(() => saveArticlePage(titleEl, null, pageEntry), 1500);
    });
    titleEl.addEventListener('blur', () => {
      if (titleSaveTimer) clearTimeout(titleSaveTimer);
      saveArticlePage(titleEl, null, pageEntry);
    });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const bodyEl = articleContent.querySelector('.article-body');
        if (bodyEl) bodyEl.focus();
      }
    });
  }
  articleHeader.appendChild(titleEl);

  // Body — rich text area
  const body = document.createElement('div');
  body.className = 'article-body';
  body.setAttribute('data-placeholder', 'Start typing...');

  if (pageEntry && pageEntry.textHtml) {
    body.innerHTML = pageEntry.textHtml;
  }

  if (articleCanEdit()) {
    body.setAttribute('contenteditable', 'true');
    setupBodyEditor(body, pageEntry, titleEl);
    updateBodyPlaceholder(body);
  }

  // Regular click opens links (not cmd+click)
  body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      window.open(link.href, '_blank');
    }
  });

  articleContent.appendChild(body);
}

// ——— Placeholder — shown when body has no real text ———
function updateBodyPlaceholder(body) {
  const text = body.innerText.replace(/\n/g, '').trim();
  body.classList.toggle('is-empty', !text);
}

// ——— Body editor ———
function setupBodyEditor(body, pageEntry, titleEl) {
  body.addEventListener('input', () => {
    updateBodyPlaceholder(body);
    if (bodySaveTimer) clearTimeout(bodySaveTimer);
    bodySaveTimer = setTimeout(() => saveArticlePage(titleEl, body, pageEntry), 2000);
  });

  // Linkify immediately after space (catches "duttapad.com " instantly)
  // Don't run on Enter — cursor offset breaks when newline is added
  body.addEventListener('keyup', (e) => {
    if (e.key === ' ') autoLinkUrls(body);
  });

  body.addEventListener('blur', () => {
    if (bodySaveTimer) clearTimeout(bodySaveTimer);
    saveArticlePage(titleEl, body, pageEntry);
  });

  body.addEventListener('paste', () => {
    setTimeout(() => {
      autoLinkUrls(body);
      if (bodySaveTimer) clearTimeout(bodySaveTimer);
      bodySaveTimer = setTimeout(() => saveArticlePage(titleEl, body, pageEntry), 1000);
    }, 100);
  });
}

// ——— Save title + body ———
async function saveArticlePage(titleEl, bodyEl, pageEntry) {
  // Only auto-link when body isn't focused (avoids cursor jump during typing)
  if (bodyEl && document.activeElement !== bodyEl) autoLinkUrls(bodyEl);

  const title = titleEl ? titleEl.innerText.trim() : '';
  const text = title || 'Untitled';
  const html = bodyEl ? bodyEl.innerHTML : (pageEntry ? (pageEntry.textHtml || '') : '');

  if (pageEntry) {
    if (text === (pageEntry.text || '').trim() && html === (pageEntry.textHtml || '')) return;
    pageEntry.text = text;
    pageEntry.textHtml = html;
    const pageOwnerId = getPageOwnerIdForEntry(pageEntry.id);
    fetch(`/api/entries/${pageEntry.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, textHtml: html, position: pageEntry.position, pageOwnerId })
    }).catch(err => console.error('Save failed:', err));
  } else if (text && text !== 'Untitled') {
    const id = generateEntryId();
    const position = { x: 100, y: 100 };
    const parentEntryId = currentViewEntryId || null;
    const pageOwnerId = window.PAGE_OWNER_ID;

    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text, textHtml: html, position, parentEntryId, pageOwnerId })
    });

    const el = document.createElement('div');
    el.className = 'entry'; el.id = id; el.style.display = 'none';
    world.appendChild(el);
    entries.set(id, { id, text, textHtml: html, position, parentEntryId, element: el });

    articleCurrentPageId = id;
    renderSidebar();
  }
}

// ——— URL auto-linking ———
function autoLinkUrls(body) {
  const sel = window.getSelection();
  let savedOffset = -1;
  if (sel.rangeCount > 0 && body.contains(sel.anchorNode)) {
    savedOffset = 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode === sel.anchorNode) { savedOffset += sel.anchorOffset; break; }
      savedOffset += walker.currentNode.textContent.length;
    }
  }

  const html = body.innerHTML;
  const linked = linkifyHtml(html);
  if (linked === html) return;
  body.innerHTML = linked;

  if (savedOffset >= 0 && document.activeElement === body) {
    restoreCursor(body, sel, savedOffset);
  }
}

function linkifyHtml(html) {
  const parts = html.split(/(<[^>]*>)/);
  let insideA = false;
  return parts.map(part => {
    if (part.startsWith('<')) {
      if (/^<a[\s>]/i.test(part)) insideA = true;
      if (/^<\/a>/i.test(part)) insideA = false;
      return part;
    }
    if (insideA) return part;
    return part.replace(/(https?:\/\/[^\s<"']+|(?:[\w-]+\.)+(?:com|org|net|edu|io|co|dev|app|me|xyz|info|gov|us|uk)(?:\/[^\s<"']*)?)/gi, (match) => {
      const href = match.match(/^https?:\/\//i) ? match : 'https://' + match;
      return `<a href="${href}" target="_blank" rel="noopener" class="article-inline-link">${match}</a>`;
    });
  }).join('');
}

function restoreCursor(body, sel, offset) {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let pos = 0;
  while (walker.nextNode()) {
    const len = walker.currentNode.textContent.length;
    if (pos + len >= offset) {
      try {
        const range = document.createRange();
        range.setStart(walker.currentNode, offset - pos);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}
      return;
    }
    pos += len;
  }
}

// ——— New page creation ———
async function createNewPage() {
  let count = 0;
  entries.forEach(ed => {
    if (ed.parentEntryId !== currentViewEntryId) return;
    if (ed.text && ed.text.startsWith('New Page')) count++;
  });
  const title = count === 0 ? 'New Page' : `New Page ${count + 1}`;
  const id = generateEntryId();
  const position = { x: 100, y: 100 + entries.size * 50 };
  const parentEntryId = currentViewEntryId || null;
  const pageOwnerId = window.PAGE_OWNER_ID;

  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text: title, textHtml: '', position, parentEntryId, pageOwnerId })
    });

    const el = document.createElement('div');
    el.className = 'entry'; el.id = id; el.style.display = 'none';
    world.appendChild(el);
    entries.set(id, { id, text: title, textHtml: '', position, parentEntryId, element: el });

    articleCurrentPageId = id;
    renderArticleView();

    // Focus title and select all for easy renaming
    setTimeout(() => {
      const titleEl = articleHeader.querySelector('.article-header-title');
      if (titleEl) { titleEl.focus(); document.execCommand('selectAll'); }
    }, 50);
  } catch (err) {
    console.error('Failed to create page:', err);
  }
}

// ——— Delete page ———
async function deletePage(entryId) {
  try {
    const pageOwnerId = getPageOwnerIdForEntry(entryId);
    await fetch(`/api/entries/${entryId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageOwnerId })
    });

    const ed = entries.get(entryId);
    if (ed && ed.element) ed.element.remove();
    entries.delete(entryId);

    if (articleCurrentPageId === entryId) {
      const pages = getArticlePages();
      articleCurrentPageId = pages.length > 0 ? pages[0].id : null;
    }
    renderArticleView();
  } catch (err) {
    console.error('Failed to delete page:', err);
  }
}

// ——— Join banner ———
function showJoinBanner() {
  const banner = document.createElement('div');
  banner.className = 'article-join-banner';
  banner.innerHTML = `<span class="article-join-banner-text">Join Project Lux</span>
    <a href="sms:+17139626862&body=LUX" class="article-join-banner-cta">Text "LUX" to join</a>`;
  document.body.appendChild(banner);
}

// ——— Navigation patches ———
if (shouldUseArticleMode()) {
  const _origNavigateToEntry = navigateToEntry;
  navigateToEntry = function(entryId) {
    _origNavigateToEntry(entryId);
    if (shouldUseArticleMode()) setTimeout(() => {
      articleCurrentPageId = null;
      const pages = getArticlePages();
      if (pages.length > 0) articleCurrentPageId = pages[0].id;
      renderArticleView();
    }, 300);
  };

  const _origNavigateBack = navigateBack;
  navigateBack = function(level) {
    _origNavigateBack(level);
    if (shouldUseArticleMode()) setTimeout(() => {
      articleCurrentPageId = null;
      const pages = getArticlePages();
      if (pages.length > 0) articleCurrentPageId = pages[0].id;
      renderArticleView();
    }, 300);
  };

  const _origNavigateToRoot = navigateToRoot;
  navigateToRoot = function() {
    _origNavigateToRoot();
    if (shouldUseArticleMode()) setTimeout(() => {
      articleCurrentPageId = null;
      const pages = getArticlePages();
      if (pages.length > 0) articleCurrentPageId = pages[0].id;
      renderArticleView();
    }, 300);
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
