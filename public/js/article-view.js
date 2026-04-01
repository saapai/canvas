// article-view.js — Substack-style article mode for Project Lux
// Each "page" = one entry. The entry's textHtml IS the page body.
// Sidebar lists pages. "+" creates a new page. Enter = paragraph.

const articleView = document.getElementById('article-view');
const articleHeader = document.getElementById('article-header');
const articleContent = document.getElementById('article-content');
const articleSidebarNav = document.getElementById('article-sidebar-nav');

const phraseCache = new Map();
const PHRASE_CACHE_TTL = 5 * 60 * 1000;

let articleCurrentPageId = null;
let bodySaveTimer = null;
let bodyDetectTimer = null;

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
    // Skip completely empty entries (ghost entries)
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

  // Move format bar into article-main for clean sticky positioning
  if (articleCanEdit() && formatBar) {
    const articleMain = articleView.querySelector('.article-main');
    if (articleMain) {
      articleMain.insertBefore(formatBar, articleMain.firstChild);
    }
    formatBar.classList.remove('hidden');
    formatBar.classList.add('article-format-bar');
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
  const pageEntry = articleCurrentPageId ? entries.get(articleCurrentPageId) : null;

  // Title — show selected page's title, not a constant
  const titleText = pageEntry ? getPageTitle(pageEntry) : 'Untitled';
  articleHeader.innerHTML = `<h1 class="article-header-title">${escapeHtml(titleText)}</h1>`;

  // Body — single contenteditable area for the page
  const body = document.createElement('div');
  body.className = 'article-body';
  body.setAttribute('data-placeholder', 'Start writing...');

  if (pageEntry) {
    if (pageEntry.textHtml) {
      body.innerHTML = pageEntry.textHtml;
    } else if (pageEntry.text) {
      body.innerHTML = escapeHtml(pageEntry.text).replace(/\n/g, '<br>');
    }
  }

  if (articleCanEdit()) {
    body.setAttribute('contenteditable', 'true');
    setupBodyEditor(body, pageEntry);
  }

  // Cmd/Ctrl+click to open links
  body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.open(link.href, '_blank');
    }
  });

  articleContent.appendChild(body);
}

// ——— Body editor with auto-save and live entity detection ———
function setupBodyEditor(body, pageEntry) {
  let detectTimer = null;
  let lastDetectedText = '';

  // On input: strip phrase highlights, debounce save + re-detect
  body.addEventListener('input', () => {
    stripPhraseSpans(body);

    if (bodySaveTimer) clearTimeout(bodySaveTimer);
    bodySaveTimer = setTimeout(() => savePageContent(body, pageEntry), 2000);

    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      const text = body.innerText.trim();
      if (text.length >= 5 && text !== lastDetectedText) {
        lastDetectedText = text;
        detectAndHighlightPhrases(body);
      }
    }, 1000);
  });

  // Save on blur, detect if needed
  body.addEventListener('blur', () => {
    if (bodySaveTimer) clearTimeout(bodySaveTimer);
    savePageContent(body, pageEntry);
    if (detectTimer) clearTimeout(detectTimer);
    const text = body.innerText.trim();
    if (text.length >= 5 && text !== lastDetectedText) {
      lastDetectedText = text;
      setTimeout(() => detectAndHighlightPhrases(body), 300);
    }
  });

  // Arrow keys into a phrase span → unwrap it so user can edit
  body.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      setTimeout(() => unwrapPhraseAtCursor(body), 0);
    }
  });

  // Auto-link URLs on paste, then re-detect
  body.addEventListener('paste', () => {
    setTimeout(() => {
      autoLinkUrls(body);
      stripPhraseSpans(body);
      if (bodySaveTimer) clearTimeout(bodySaveTimer);
      bodySaveTimer = setTimeout(() => savePageContent(body, pageEntry), 1000);
      if (detectTimer) clearTimeout(detectTimer);
      detectTimer = setTimeout(() => {
        lastDetectedText = body.innerText.trim();
        detectAndHighlightPhrases(body);
      }, 1000);
    }, 100);
  });
}

// Strip all phrase highlight spans back to plain text
function stripPhraseSpans(body) {
  body.querySelectorAll('.article-clickable-phrase').forEach(span => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
  body.normalize();
}

// If cursor landed inside a phrase span via arrow keys, unwrap that span
function unwrapPhraseAtCursor(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.anchorNode;
  while (node && node !== body) {
    if (node.nodeType === 1 && node.classList && node.classList.contains('article-clickable-phrase')) {
      // Calculate cursor offset within this span
      let cursorOff = 0;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode === sel.anchorNode) { cursorOff += sel.anchorOffset; break; }
        cursorOff += walker.currentNode.textContent.length;
      }
      const text = node.textContent;
      const textNode = document.createTextNode(text);
      node.replaceWith(textNode);
      body.normalize();
      try {
        const range = document.createRange();
        range.setStart(textNode, Math.min(cursorOff, text.length));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}
      return;
    }
    node = node.parentNode;
  }
}

async function savePageContent(body, pageEntry) {
  // Auto-link any plain URLs
  autoLinkUrls(body);

  const html = body.innerHTML;
  const text = body.innerText.trim();

  if (pageEntry) {
    // Update existing entry
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
    renderSidebar(); // Update page title in sidebar
  } else if (text) {
    // Create new page entry
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
    // Re-assign pageEntry for future saves
    body._pageEntry = entries.get(id);
    renderSidebar();
  }
}

// ——— URL auto-linking ———
function autoLinkUrls(body) {
  const sel = window.getSelection();
  let savedOffset = -1;
  // Save cursor as text offset
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

  // Restore cursor
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
    // Match full URLs (https://...) and bare domains (duttapad.com, foo.org/path)
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
      body: JSON.stringify({ id, text: title, textHtml: `<p>${escapeHtml(title)}</p>`, position, parentEntryId, pageOwnerId })
    });

    const el = document.createElement('div');
    el.className = 'entry'; el.id = id; el.style.display = 'none';
    world.appendChild(el);
    entries.set(id, { id, text: title, textHtml: `<p>${escapeHtml(title)}</p>`, position, parentEntryId, element: el });

    articleCurrentPageId = id;
    renderArticleView();

    setTimeout(() => {
      const body = articleContent.querySelector('.article-body');
      if (body) { body.focus(); document.execCommand('selectAll'); }
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

    // If we deleted the active page, switch to the first remaining page
    if (articleCurrentPageId === entryId) {
      const pages = getArticlePages();
      articleCurrentPageId = pages.length > 0 ? pages[0].id : null;
    }
    renderArticleView();
  } catch (err) {
    console.error('Failed to delete page:', err);
  }
}

// ——— Live Entity Detection — 1s after typing stops ———
async function detectAndHighlightPhrases(body) {
  const text = body.innerText.trim();
  if (text.length < 5) return;
  if (body.querySelector('.article-clickable-phrase')) return;

  try {
    const res = await fetch('/api/detect-phrases', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) return;
    const data = await res.json();
    const phrases = data.phrases || [];
    if (!phrases.length) return;

    // Save cursor
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

    // Apply highlights (avoid matching inside <a> tags)
    let html = body.innerHTML;
    phrases.forEach(p => {
      if (!p.phrase) return;
      const escaped = p.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = html.split(/(<[^>]*>)/);
      let insideA = false;
      let insidePhrase = false;
      html = parts.map(part => {
        if (part.startsWith('<')) {
          if (/^<a[\s>]/i.test(part)) insideA = true;
          if (/^<\/a>/i.test(part)) insideA = false;
          if (/^<span[^>]*article-clickable-phrase/i.test(part)) insidePhrase = true;
          if (insidePhrase && /^<\/span>/i.test(part)) { insidePhrase = false; return part; }
          return part;
        }
        if (insideA || insidePhrase) return part;
        const regex = new RegExp(`(${escaped})`, 'gi');
        return part.replace(regex, (match) => {
          return `<span class="article-clickable-phrase" data-phrase="${escapeHtml(match)}" data-category="${escapeHtml(p.category || '')}">${escapeHtml(match)}</span>`;
        });
      }).join('');
    });
    body.innerHTML = html;

    // Restore cursor
    if (savedOffset >= 0 && document.activeElement === body) {
      restoreCursor(body, sel, savedOffset);
    }

    // Wire up single-click → traverse
    body.querySelectorAll('.article-clickable-phrase').forEach(span => {
      span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Prevent contenteditable from placing cursor
        window.getSelection().removeAllRanges();
        createSubpageFromPhrase(span.dataset.phrase, articleCurrentPageId);
      });
    });
  } catch (err) {}
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
      body: JSON.stringify({ id, text: phrase, textHtml: `<p>${escapeHtml(phrase)}</p>`, position, parentEntryId: parentId, pageOwnerId })
    });

    const el = document.createElement('div');
    el.className = 'entry'; el.id = id; el.style.display = 'none';
    world.appendChild(el);
    entries.set(id, { id, text: phrase, textHtml: `<p>${escapeHtml(phrase)}</p>`, position, parentEntryId: parentId, element: el });

    navigateToEntry(parentId);
  } catch (err) {
    console.error('Failed to create subpage:', err);
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
