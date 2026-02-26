// rendering.js — Text animation (melt), LaTeX, link cards, and URL processing

function meltify(text){
  return escapeHtml(text).replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
}

// LaTeX conversion helper: POST text to server, return { latex, isFullMath }
async function convertToLatex(text) {
  try {
    const response = await fetch('/api/convert-latex', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error('LaTeX conversion failed');
    return await response.json();
  } catch (error) {
    console.error('[LATEX] Conversion error:', error);
    return null;
  }
}

// Render LaTeX source into an element using KaTeX
// Common KaTeX options shared across all render calls
const katexOptions = {
  throwOnError: false,
  trust: true,
  strict: false,
  macros: {
    '\\R': '\\mathbb{R}',
    '\\Z': '\\mathbb{Z}',
    '\\N': '\\mathbb{N}',
    '\\Q': '\\mathbb{Q}',
    '\\C': '\\mathbb{C}',
    '\\F': '\\mathbb{F}',
    '\\dx': '\\,dx',
    '\\dy': '\\,dy',
    '\\dz': '\\,dz',
    '\\dt': '\\,dt',
    '\\du': '\\,du',
    '\\dv': '\\,dv',
    '\\dtheta': '\\,d\\theta',
    '\\dphi': '\\,d\\phi',
    '\\abs': '\\left|#1\\right|',
    '\\norm': '\\left\\|#1\\right\\|',
    '\\inner': '\\left\\langle #1, #2 \\right\\rangle',
    '\\floor': '\\left\\lfloor #1 \\right\\rfloor',
    '\\ceil': '\\left\\lceil #1 \\right\\rceil',
    '\\eval': '\\left.#1\\right|'
  }
};

function renderLatex(latexSource, element) {
  // Wrap in a latex-content container
  const container = document.createElement('div');
  container.className = 'latex-content';

  element.innerHTML = '';
  element.appendChild(container);

  // Check if source has math delimiters ($...$, $$...$$, \[...\], \(...\), or \begin{env})
  const hasDelimiters = /\$\$[\s\S]+?\$\$|\$[^$]+?\$|\\[\[\]]|\\[()]|\\begin\{/.test(latexSource);

  // Guard: wait for KaTeX to be loaded
  function doRender() {
    if (typeof katex !== 'undefined') {
      try {
        if (hasDelimiters && typeof renderMathInElement === 'function') {
          // Has delimiters - use renderMathInElement to parse mixed content
          container.textContent = latexSource;
          renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
              { left: '$', right: '$', display: false },
              { left: '\\begin{equation}', right: '\\end{equation}', display: true },
              { left: '\\begin{align}', right: '\\end{align}', display: true },
              { left: '\\begin{aligned}', right: '\\end{aligned}', display: true },
              { left: '\\begin{gather}', right: '\\end{gather}', display: true },
              { left: '\\begin{cases}', right: '\\end{cases}', display: true },
              { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
              { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true },
              { left: '\\begin{vmatrix}', right: '\\end{vmatrix}', display: true }
            ],
            ...katexOptions
          });
        } else {
          // No delimiters - render directly as a single math expression
          katex.render(latexSource, container, {
            displayMode: true,
            ...katexOptions
          });
        }
      } catch (e) {
        console.error('[LATEX] KaTeX render error:', e);
        // Fallback: show raw source
        container.textContent = latexSource;
      }
    } else {
      // Retry after a short delay if KaTeX hasn't loaded yet
      setTimeout(doRender, 200);
    }
  }
  doRender();
}

// Detect the primary font-size from an entry's textHtml and set it on the element.
// This ensures text outside explicit font-size spans still renders at the correct size
// (the entry CSS defaults to 16px, so entries with larger fonts would shrink on reload).
function applyEntryFontSize(entry, textHtml) {
  if (!textHtml) {
    entry.style.fontSize = '';
    return;
  }
  const match = textHtml.match(/style="[^"]*font-size:\s*(\d+(?:\.\d+)?)px/);
  if (match) {
    const size = parseFloat(match[1]);
    if (size && size !== 16) {
      entry.style.fontSize = size + 'px';
    } else {
      entry.style.fontSize = '';
    }
  } else {
    entry.style.fontSize = '';
  }
}

function escapeHtml(s){
  if (!s) return '';
  return s
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function meltifyHtml(html){
  if (!html) return '';
  return html;
}

// URL detection regex
const urlRegex = /(https?:\/\/[^\s]+)/gi;

function extractUrls(text) {
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

// Generate slug from entry text (limit to 17 characters)
function generateEntrySlug(text, entryData = null) {
  if (entryData && entryData.mediaCardData && entryData.mediaCardData.type === 'image') {
    const suffix = (entryData.id || '').slice(-8).replace(/[^a-z0-9-]/gi, '') || '0';
    return 'image-' + suffix;
  }
  if (entryData && entryData.mediaCardData && entryData.mediaCardData.title) {
    const slug = entryData.mediaCardData.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with one
      .trim()
      .substring(0, 17)
      .replace(/-+$/, ''); // Remove trailing hyphens
    return slug || 'media';
  }

  if (!text) return '';

  // Remove URLs first
  let cleanText = text;
  const urls = extractUrls(text);
  urls.forEach(url => {
    cleanText = cleanText.replace(url, '').trim();
  });

  // If only URLs, extract meaningful text from first URL
  if (!cleanText.trim() && urls.length > 0) {
    cleanText = extractUrlSlug(urls[0]);
  }

  // Limit to 17 characters
  const slug = cleanText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with one
    .trim()
    .substring(0, 17)
    .replace(/-+$/, ''); // Remove trailing hyphens

  return slug || 'entry';
}

// Extract meaningful text from URL (first 10 chars, skip protocol/domain)
function extractUrlSlug(url) {
  try {
    const urlObj = new URL(url);
    // Get pathname + search, or hostname if no path
    let meaningful = urlObj.pathname + urlObj.search;

    // Remove leading slash
    meaningful = meaningful.replace(/^\//, '');

    // If no path, use hostname but remove common TLDs
    if (!meaningful || meaningful === '/') {
      meaningful = urlObj.hostname
        .replace(/^www\./, '')
        .replace(/\.(com|org|net|edu|gov|io|co|ai)$/, '');
    }

    // Extract first 10 characters that are alphanumeric
    const clean = meaningful
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10);

    return clean || 'link';
  } catch {
    // Fallback: extract first 10 alphanumeric chars from URL
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10) || 'link';
  }
}

async function generateLinkCard(url) {
  try {
    const response = await fetch('/api/generate-link-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      throw new Error('Failed to generate card');
    }

    return await response.json();
  } catch (error) {
    console.error('Error generating link card:', error);
    return null;
  }
}

function createLinkCardPlaceholder(url) {
  const placeholder = document.createElement('div');
  placeholder.className = 'link-card-placeholder';
  placeholder.dataset.url = url;

  const placeholderContent = `
    <div class="link-card-placeholder-content">
      <div class="link-card-placeholder-url">${escapeHtml(url)}</div>
      <div class="link-card-placeholder-loading">Loading...</div>
    </div>
  `;

  placeholder.innerHTML = placeholderContent;

  // Change cursor to pointer when hovering over link-card placeholder
  placeholder.addEventListener('mouseenter', (e) => {
    const entry = placeholder.closest('.entry');
    if (entry) {
      entry.classList.add('has-link-card-hover');
    }
  });

  placeholder.addEventListener('mouseleave', (e) => {
    const entry = placeholder.closest('.entry');
    if (entry) {
      entry.classList.remove('has-link-card-hover');
    }
  });

  placeholder.addEventListener('mousedown', (e) => {
    // Allow shift+click to propagate for dragging
    if (!e.shiftKey) {
      e.stopPropagation();
    }
  });
  placeholder.addEventListener('dblclick', (e) => {
    e.stopPropagation();
  });

  return placeholder;
}

function createLinkCard(cardData) {
  const card = document.createElement('div');
  const isYouTube = cardData.isVideo && cardData.videoId;

  if (isYouTube) {
    card.className = 'link-card link-card-yt';
    card.dataset.videoId = cardData.videoId;
    card.dataset.isVideo = 'true';
  } else {
    card.className = cardData.image ? 'link-card' : 'link-card link-card-no-image';
  }

  card.dataset.url = cardData.url;
  card.dataset.title = cardData.title;
  card.dataset.siteName = cardData.siteName;
  card.dataset.description = cardData.description || '';

  let cardContent;
  if (isYouTube) {
    cardContent = `
      <div class="link-card-yt-thumb" style="background-image: url('${cardData.image}')">
        <div class="link-card-yt-play"><span></span></div>
      </div>
      <div class="link-card-content">
        <div class="link-card-yt-channel">${escapeHtml(cardData.description || '')}</div>
        <div class="link-card-title">${escapeHtml(cardData.title)}</div>
      </div>
    `;
  } else {
    cardContent = `
      ${cardData.image ? `<div class="link-card-image" style="background-image: url('${cardData.image}')"></div>` : ''}
      <div class="link-card-content">
        <div class="link-card-site">${escapeHtml(cardData.siteName)}</div>
        <div class="link-card-title">${escapeHtml(cardData.title)}</div>
        ${cardData.description ? `<div class="link-card-description">${escapeHtml(cardData.description)}</div>` : ''}
      </div>
    `;
  }

  card.innerHTML = cardContent;

  // Change cursor to pointer when hovering over link-card
  card.addEventListener('mouseenter', (e) => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.add('has-link-card-hover');
    }
  });

  card.addEventListener('mouseleave', (e) => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.remove('has-link-card-hover');
    }
  });

  // Single click: Command/Ctrl + click opens link in new tab
  card.addEventListener('click', (e) => {
    // Don't handle click if shift was held (shift+click is for dragging)
    // Also don't handle if we just finished dragging (prevents navigation after drag)
    if (e.shiftKey || justFinishedDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.stopPropagation();

    // Command/Ctrl + click: open link
    if (e.metaKey || e.ctrlKey) {
      window.open(cardData.url, '_blank');
      return;
    }

    // Regular single click does nothing (allows dragging)
  });

  // Double click: create entry and navigate to it (like text entries)
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Regular double-click: create entry and navigate to it
    const entryText = cardData.url;

    // Check for duplicate entry at the same directory level
    const duplicateId = findDuplicateEntry(entryText, currentViewEntryId, null);
    if (duplicateId) {
      // Navigate to existing entry instead of creating duplicate
      navigateToEntry(duplicateId);
      return;
    }

    const entryId = `entry-${entryIdCounter++}`;
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.id = entryId;

    // Position the new entry near the card
    const cardRect = card.getBoundingClientRect();
    const cardWorldPos = screenToWorld(cardRect.left, cardRect.top);
    const offsetX = 300; // Offset to the right of the card
    const offsetY = 0;

    entry.style.left = `${cardWorldPos.x + offsetX}px`;
    entry.style.top = `${cardWorldPos.y + offsetY}px`;
    entry.style.width = '400px';
    entry.style.minHeight = '60px';

    // Create entry text from link card data
    entry.innerHTML = meltify(entryText);
    world.appendChild(entry);

    // Store entry data
    const entryData = {
      id: entryId,
      element: entry,
      text: entryText,
      position: { x: cardWorldPos.x + offsetX, y: cardWorldPos.y + offsetY },
      parentEntryId: currentViewEntryId
    };
    entries.set(entryId, entryData);

    // Save to server
    saveEntryToServer(entryData);

    // Navigate to the new entry
    navigateToEntry(entryId);

  });
  card.addEventListener('mousedown', (e) => {
    // Allow mousedown to bubble for dragging (both regular and shift+click)
    // The entry handler will handle the drag, and we prevent unwanted click behavior in the click handler
    // Don't stop propagation here - let dragging work
  });
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow editing in read-only mode
    if (isReadOnly) return;

    // Right-click: edit the parent entry with the card's URL as text
    const entryEl = findEntryElement(card);
    if (entryEl && entryEl.id !== 'anchor' && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const rect = entryEl.getBoundingClientRect();
        const worldPos = screenToWorld(rect.left, rect.top);
        // Edit with the card's URL as the text
        placeEditorAtWorld(worldPos.x, worldPos.y, cardData.url, entryEl.id);
      }
    }
  });

  return card;
}

function processTextWithLinks(text) {
  const urls = extractUrls(text);
  let processedText = text;

  // Remove URLs from text (they'll be shown as cards)
  urls.forEach((url) => {
    processedText = processedText.replace(url, '').trim();
  });

  // Clean up multiple spaces but preserve newlines
  // Replace multiple spaces (but not newlines) with single space
  processedText = processedText.replace(/[ \t]+/g, ' ');
  // Clean up multiple consecutive newlines (keep single newlines)
  processedText = processedText.replace(/\n{3,}/g, '\n\n');
  // Trim trailing whitespace from each line, but preserve line structure
  processedText = processedText.split('\n').map(line => line.trimEnd()).join('\n').trim();

  return { processedText, urls };
}
