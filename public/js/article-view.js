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
  const viewId = currentViewEntryId || null;
  entries.forEach(ed => {
    if (ed.id === 'anchor') return;
    // Normalize: treat undefined and null both as "root level"
    const parent = ed.parentEntryId || null;
    if (parent !== viewId) return;
    // Include all entry types: text, media, deadlines, LaTeX
    const hasContent = (ed.text && ed.text.trim()) ||
                       ed.mediaCardData ||
                       (ed.latexData && ed.latexData.enabled) ||
                       (ed.textHtml && ed.textHtml.includes('deadline-table'));
    if (!hasContent) return;
    pages.push(ed);
  });
  return pages;
}

function getPageTitle(ed) {
  if (!ed) return 'Untitled';
  // Media card titles
  if (ed.mediaCardData) {
    if (ed.mediaCardData.type === 'image') return 'Image';
    if (ed.mediaCardData.title) return ed.mediaCardData.title.substring(0, 40);
    return ed.mediaCardData.type === 'song' ? 'Song' : 'Movie';
  }
  // LaTeX entry
  if (ed.latexData && ed.latexData.enabled) {
    const t = (ed.text || '').split('\n')[0].substring(0, 40);
    return t || 'LaTeX';
  }
  // Deadline table
  if (ed.textHtml && ed.textHtml.includes('deadline-table')) return 'Deadlines';
  // Normal text
  const text = (ed.text || '').trim();
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 40) return firstLine.substring(0, 40) + '...';
  return firstLine || 'Untitled';
}

// ——— Format bar visibility ———
function articleFormatBarToggle() {
  if (!formatBar) return;
  // Small delay so focusout fires before focusin on the new target
  setTimeout(() => {
    const active = document.activeElement;
    const inArticle = active &&
      (active.classList.contains('article-body') || active.classList.contains('article-header-title'));
    formatBar.classList.toggle('hidden', !inArticle);
  }, 0);
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

  // Format bar: hidden by default, shown only when cursor is in title or body
  if (articleCanEdit() && formatBar) {
    formatBar.classList.add('hidden');
    document.addEventListener('focusin', articleFormatBarToggle);
    document.addEventListener('focusout', articleFormatBarToggle);
  }

  // Join banner for community pages (disabled — was Amia-specific)

  waitForEntries(() => {
    const pages = getArticlePages();
    if (pages.length > 0) articleCurrentPageId = pages[0].id;
    renderArticleView();
  });
}

function waitForEntries(cb, attempts = 0) {
  // Wait until entries are loaded (more than just anchor), up to 10 seconds
  if (entries.size > 1 || attempts > 50) cb();
  else setTimeout(() => waitForEntries(cb, attempts + 1), 200);
}

// ——— Render ———
function renderArticleView() {
  if (!articleView || articleView.classList.contains('hidden')) return;
  renderSidebar();
  renderPageContent();
}

function isInsidePageCard() {
  if (!currentViewEntryId) return false;
  const parentEntry = entries.get(currentViewEntryId);
  return parentEntry && parentEntry.textHtml && parentEntry.textHtml.includes('page-card');
}

function renderSidebar() {
  articleSidebarNav.innerHTML = '';
  const pages = getArticlePages();

  // If inside a page-card entry, show its title as an editable header
  if (isInsidePageCard()) {
    const parentEntry = entries.get(currentViewEntryId);
    const pageTitleEl = document.createElement('div');
    pageTitleEl.className = 'article-sidebar-page-title';
    pageTitleEl.setAttribute('contenteditable', articleCanEdit() ? 'true' : 'false');
    pageTitleEl.setAttribute('data-placeholder', 'Page title...');
    pageTitleEl.textContent = parentEntry.text || 'Untitled Page';

    if (articleCanEdit()) {
      let pageTitleTimer = null;
      const savePageTitle = () => {
        const newTitle = pageTitleEl.textContent.trim() || 'Untitled Page';
        parentEntry.text = newTitle;
        // Update the page-card HTML on the canvas entry
        const cardEl = parentEntry.element ? parentEntry.element.querySelector('.page-card-title') : null;
        if (cardEl) cardEl.textContent = newTitle;
        parentEntry.textHtml = parentEntry.element ? parentEntry.element.querySelector('.page-card').outerHTML : parentEntry.textHtml.replace(/<div class="page-card-title"[^>]*>.*?<\/div>/, `<div class="page-card-title" contenteditable="true">${escapeHtml(newTitle)}</div>`);
        updateEntryOnServer(parentEntry);
        // Sync breadcrumb with new title
        if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
      };
      pageTitleEl.addEventListener('input', () => {
        if (pageTitleTimer) clearTimeout(pageTitleTimer);
        pageTitleTimer = setTimeout(savePageTitle, 1500);
      });
      pageTitleEl.addEventListener('blur', () => {
        if (pageTitleTimer) clearTimeout(pageTitleTimer);
        savePageTitle();
      });
      pageTitleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); pageTitleEl.blur(); }
      });
    }
    articleSidebarNav.appendChild(pageTitleEl);
  }

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

  // Body — rich text area (or special component)
  const body = document.createElement('div');
  body.className = 'article-body';
  body.setAttribute('data-placeholder', 'Start typing...');

  const isMedia = pageEntry && pageEntry.mediaCardData;
  const isLatex = pageEntry && pageEntry.latexData && pageEntry.latexData.enabled;
  const isDeadline = pageEntry && pageEntry.textHtml && pageEntry.textHtml.includes('deadline-table');
  const isSpecial = isMedia || isLatex || isDeadline;

  if (pageEntry) {
    if (isMedia) {
      // Media card: render image or clone the canvas element
      body.contentEditable = 'false';
      const wrapper = document.createElement('div');
      wrapper.className = 'article-media-embed';
      if (pageEntry.mediaCardData.type === 'image' && pageEntry.mediaCardData.url) {
        const img = document.createElement('img');
        img.src = pageEntry.mediaCardData.url;
        img.alt = pageEntry.mediaCardData.title || 'Image';
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        wrapper.appendChild(img);
      } else if (pageEntry.element) {
        const clone = pageEntry.element.cloneNode(true);
        clone.style.position = 'static';
        clone.style.display = 'block';
        clone.style.transform = 'none';
        clone.style.width = 'auto';
        wrapper.appendChild(clone);
      }
      body.appendChild(wrapper);
    } else if (isLatex) {
      // LaTeX: render the stored HTML
      body.contentEditable = 'false';
      if (pageEntry.latexData.renderedHtml) {
        body.innerHTML = pageEntry.latexData.renderedHtml;
      } else if (pageEntry.textHtml) {
        body.innerHTML = pageEntry.textHtml;
      }
    } else if (isDeadline) {
      // Deadline table: render as interactive HTML
      body.innerHTML = pageEntry.textHtml;
      if (typeof setupDeadlineTableHandlers === 'function') {
        setTimeout(() => {
          const table = body.querySelector('.deadline-table');
          if (table) setupDeadlineTableHandlers(table, pageEntry);
        }, 50);
      }
    } else if (pageEntry.textHtml) {
      body.innerHTML = pageEntry.textHtml;
    } else if (pageEntry.text) {
      // Fallback: entries created in canvas mode may only have plain text
      // Render each line after the title as a paragraph
      const lines = pageEntry.text.split('\n').slice(1); // skip first line (title)
      body.innerHTML = lines.map(line => {
        const trimmed = line.trim();
        return trimmed ? `<p>${escapeHtml(trimmed)}</p>` : '<p><br></p>';
      }).join('');
    }
  }

  // Only make editable for normal text entries
  if (articleCanEdit() && !isSpecial) {
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

  // Render child entries inline below the parent body
  if (pageEntry) {
    const children = [];
    entries.forEach(ed => {
      if (ed.id === 'anchor') return;
      const parent = ed.parentEntryId || null;
      if (parent !== pageEntry.id) return;
      const hasContent = (ed.text && ed.text.trim()) ||
                         ed.mediaCardData ||
                         (ed.latexData && ed.latexData.enabled) ||
                         (ed.textHtml && ed.textHtml.includes('deadline-table'));
      if (!hasContent) return;
      children.push(ed);
    });

    children.forEach(child => {
      const childBlock = document.createElement('div');
      childBlock.className = 'article-child-entry';

      const childTitle = document.createElement('h3');
      childTitle.className = 'article-child-title';
      childTitle.textContent = getPageTitle(child);
      childBlock.appendChild(childTitle);

      const childBody = document.createElement('div');
      childBody.className = 'article-child-body';

      const cIsMedia = child.mediaCardData;
      const cIsLatex = child.latexData && child.latexData.enabled;
      const cIsDeadline = child.textHtml && child.textHtml.includes('deadline-table');

      if (cIsMedia) {
        const wrapper = document.createElement('div');
        wrapper.className = 'article-media-embed';
        if (child.mediaCardData.type === 'image' && child.mediaCardData.url) {
          const img = document.createElement('img');
          img.src = child.mediaCardData.url;
          img.alt = child.mediaCardData.title || 'Image';
          img.style.maxWidth = '100%';
          img.style.borderRadius = '8px';
          wrapper.appendChild(img);
        } else if (child.element) {
          const clone = child.element.cloneNode(true);
          clone.style.position = 'static';
          clone.style.display = 'block';
          clone.style.transform = 'none';
          clone.style.width = 'auto';
          wrapper.appendChild(clone);
        }
        childBody.appendChild(wrapper);
      } else if (cIsLatex) {
        if (child.latexData.renderedHtml) {
          childBody.innerHTML = child.latexData.renderedHtml;
        } else if (child.textHtml) {
          childBody.innerHTML = child.textHtml;
        }
      } else if (cIsDeadline) {
        childBody.innerHTML = child.textHtml;
        if (typeof setupDeadlineTableHandlers === 'function') {
          setTimeout(() => {
            const table = childBody.querySelector('.deadline-table');
            if (table) setupDeadlineTableHandlers(table, child);
          }, 50);
        }
      } else if (child.textHtml) {
        childBody.innerHTML = child.textHtml;
      } else if (child.text) {
        const lines = child.text.split('\n').slice(1);
        childBody.innerHTML = lines.map(line => {
          const trimmed = line.trim();
          return trimmed ? `<p>${escapeHtml(trimmed)}</p>` : '';
        }).filter(Boolean).join('');
      }

      if (childBody.innerHTML) {
        childBlock.appendChild(childBody);
      }
      articleContent.appendChild(childBlock);
    });
  }
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

  body.addEventListener('paste', (e) => {
    // Handle pasted images
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) articleUploadAndInsert(file, body, titleEl, pageEntry);
        return;
      }
    }
    setTimeout(() => {
      autoLinkUrls(body);
      if (bodySaveTimer) clearTimeout(bodySaveTimer);
      bodySaveTimer = setTimeout(() => saveArticlePage(titleEl, body, pageEntry), 1000);
    }, 100);
  });

  // ——— Formatting shortcuts (Cmd+B/I/U, Cmd+Shift+X) ———
  body.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'b' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('bold', false, null);
    } else if (e.key === 'i' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('italic', false, null);
    } else if (e.key === 'u' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('underline', false, null);
    } else if (e.key === 'x' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('strikeThrough', false, null);
    }
  });

  // ——— Drag-and-drop files/images ———
  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    body.classList.add('article-drag-over');
  });
  body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    body.classList.remove('article-drag-over');
  });
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    body.classList.remove('article-drag-over');
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      articleUploadAndInsert(file, body, titleEl, pageEntry);
    }
  });
}

// ——— Upload file and insert into body ———
async function articleUploadAndInsert(file, body, titleEl, pageEntry) {
  const isImage = file.type.startsWith('image/');
  const endpoint = isImage ? '/api/upload-image' : '/api/upload-file';
  const formData = new FormData();
  formData.append('file', file);

  // Insert a placeholder
  const placeholderId = 'upload-' + Date.now();
  const placeholder = document.createElement('div');
  placeholder.id = placeholderId;
  placeholder.className = 'article-upload-placeholder';
  placeholder.textContent = isImage ? 'Uploading image...' : `Uploading ${file.name}...`;
  body.appendChild(placeholder);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');

    const ph = document.getElementById(placeholderId);
    if (!ph) return;

    if (isImage) {
      const wrapper = document.createElement('div');
      wrapper.className = 'article-image-wrapper';
      wrapper.contentEditable = 'false';
      const img = document.createElement('img');
      img.src = data.url;
      img.alt = file.name;
      img.className = 'article-inline-image';
      wrapper.appendChild(img);
      ph.replaceWith(wrapper);
    } else {
      const card = document.createElement('a');
      card.href = data.url;
      card.target = '_blank';
      card.rel = 'noopener';
      card.className = 'article-file-card';
      card.contentEditable = 'false';
      const ext = file.name.split('.').pop().toUpperCase();
      const size = formatFileSize(file.size);
      card.innerHTML = `<span class="article-file-icon">${getFileIcon(ext)}</span>` +
        `<span class="article-file-info"><span class="article-file-name">${escapeHtml(file.name)}</span>` +
        `<span class="article-file-meta">${ext} &middot; ${size}</span></span>`;
      ph.replaceWith(card);
    }

    // Save after insert
    if (bodySaveTimer) clearTimeout(bodySaveTimer);
    bodySaveTimer = setTimeout(() => saveArticlePage(titleEl, body, pageEntry), 500);
  } catch (err) {
    console.error('Upload failed:', err);
    const ph = document.getElementById(placeholderId);
    if (ph) {
      ph.textContent = 'Upload failed: ' + err.message;
      ph.classList.add('article-upload-error');
      setTimeout(() => ph.remove(), 3000);
    }
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(ext) {
  const icons = {
    PDF: '\u{1F4C4}', DOC: '\u{1F4DD}', DOCX: '\u{1F4DD}',
    XLS: '\u{1F4CA}', XLSX: '\u{1F4CA}', CSV: '\u{1F4CA}',
    PPT: '\u{1F4CA}', PPTX: '\u{1F4CA}',
    ZIP: '\u{1F4E6}', RAR: '\u{1F4E6}', '7Z': '\u{1F4E6}',
    MP3: '\u{1F3B5}', WAV: '\u{1F3B5}', M4A: '\u{1F3B5}',
    MP4: '\u{1F3AC}', MOV: '\u{1F3AC}', AVI: '\u{1F3AC}',
    TXT: '\u{1F4C3}', MD: '\u{1F4C3}', JS: '\u{1F4C3}', PY: '\u{1F4C3}',
  };
  return icons[ext] || '\u{1F4CE}';
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
  const username = window.PAGE_USERNAME || 'this page';
  const keyword = username.toUpperCase();
  const banner = document.createElement('div');
  banner.className = 'article-join-banner';
  banner.innerHTML = `<span class="article-join-banner-text">Join ${escapeHtml(username)}'s Page</span>
    <a href="sms:+17139626862&body=${encodeURIComponent(keyword)}" class="article-join-banner-cta">Text "${escapeHtml(keyword)}" to join</a>`;
  document.body.appendChild(banner);
}

// ——— Per-level view mode persistence ———
// Maps navigation depth to the view mode that was active at that level
const viewModeStack = new Map(); // depth → 'canvas' | 'article'

function saveCurrentViewMode() {
  const depth = navigationStack.length;
  viewModeStack.set(depth, window.PAGE_VIEW_MODE || 'canvas');
}

function restoreViewMode(depth) {
  const savedMode = viewModeStack.get(depth) || 'canvas';
  // Clean up deeper entries
  for (const [d] of viewModeStack) {
    if (d > depth) viewModeStack.delete(d);
  }
  if (savedMode !== window.PAGE_VIEW_MODE) {
    window.PAGE_VIEW_MODE = savedMode;
    if (savedMode === 'article') {
      activateArticleMode();
    } else {
      deactivateArticleMode();
    }
    const label = document.getElementById('view-mode-label');
    if (label) label.textContent = savedMode === 'article' ? 'Page View' : 'Canvas View';
  }
}

// ——— Navigation patches (always installed so they work after runtime toggle) ———
const _origNavigateToEntry = navigateToEntry;
navigateToEntry = function(entryId) {
  // Save view mode for current level before navigating deeper
  saveCurrentViewMode();
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
  // Restore view mode for the level we're returning to
  const depth = navigationStack.length;
  setTimeout(() => {
    restoreViewMode(depth);
    if (shouldUseArticleMode()) {
      articleCurrentPageId = null;
      const pages = getArticlePages();
      if (pages.length > 0) articleCurrentPageId = pages[0].id;
      renderArticleView();
    }
  }, 300);
};

const _origNavigateToRoot = navigateToRoot;
navigateToRoot = function() {
  _origNavigateToRoot();
  setTimeout(() => {
    restoreViewMode(0);
    if (shouldUseArticleMode()) {
      articleCurrentPageId = null;
      const pages = getArticlePages();
      if (pages.length > 0) articleCurrentPageId = pages[0].id;
      renderArticleView();
    }
  }, 300);
};

// ——— Deactivate article mode (switch back to canvas) ———
function deactivateArticleMode() {
  if (!articleView) return;
  document.body.classList.remove('article-mode');
  articleView.classList.add('hidden');
  articleContent.innerHTML = '';
  articleHeader.innerHTML = '';
  articleSidebarNav.innerHTML = '';

  // Remove article format bar listeners
  document.removeEventListener('focusin', articleFormatBarToggle);
  document.removeEventListener('focusout', articleFormatBarToggle);

  // Show format bar for canvas mode
  if (formatBar) formatBar.classList.remove('hidden');

  // Re-show canvas entries and fit camera
  if (typeof updateEntryVisibility === 'function') updateEntryVisibility();
  requestAnimationFrame(() => {
    if (typeof zoomToFitEntries === 'function') zoomToFitEntries({ instant: true });
  });
}

// ——— View mode toggle ———
(function initViewModeToggle() {
  const toggle = document.getElementById('view-mode-toggle');
  const label = document.getElementById('view-mode-label');
  if (!toggle || !label) return;

  // Show toggle for owners and editors
  if (window.PAGE_IS_OWNER || window.PAGE_IS_EDITOR) {
    toggle.classList.remove('hidden');
  }

  function updateLabel() {
    label.textContent = shouldUseArticleMode() ? 'Page View' : 'Canvas View';
  }
  updateLabel();

  toggle.addEventListener('click', async () => {
    const newMode = shouldUseArticleMode() ? 'canvas' : 'article';

    // Persist preference to server (fire-and-forget)
    fetch('/api/user/view-mode', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewMode: newMode })
    }).catch(err => console.error('Failed to save view mode:', err));

    // Update global state immediately
    window.PAGE_VIEW_MODE = newMode;

    if (newMode === 'article') {
      activateArticleMode();
    } else {
      deactivateArticleMode();
    }
    updateLabel();
  });
})();

// ——— Initialize ———
if (shouldUseArticleMode()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateArticleMode);
  } else {
    activateArticleMode();
  }
}
