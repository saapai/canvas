/**
 * Link Cards
 * Generates and displays link preview cards for URLs
 */

// Create link card placeholder while loading
function createLinkCardPlaceholder(url) {
  const placeholder = document.createElement('div');
  placeholder.className = 'link-card-placeholder';

  placeholder.innerHTML = `
    <div class="link-card-placeholder-content">
      <div class="link-card-placeholder-url">${escapeHtml(url)}</div>
      <div class="link-card-placeholder-loading">Loading preview...</div>
    </div>
  `;

  return placeholder;
}

// Generate link card data from URL
async function generateLinkCard(url) {
  try {
    const res = await fetch('/api/generate-link-card', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!res.ok) {
      console.error('[LINK] Failed to fetch preview for:', url);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[LINK] Error generating link card:', err);
    return null;
  }
}

// Create link card element from data
function createLinkCard(cardData) {
  const card = document.createElement('div');
  card.className = cardData.image ? 'link-card' : 'link-card link-card-no-image';

  const imageHtml = cardData.image
    ? `<div class="link-card-image" style="background-image: url('${escapeHtml(cardData.image)}')"></div>`
    : '';

  card.innerHTML = `
    ${imageHtml}
    <div class="link-card-content">
      <div class="link-card-site">${escapeHtml(cardData.siteName || extractDomain(cardData.url))}</div>
      <div class="link-card-title">${escapeHtml(cardData.title || cardData.url)}</div>
      ${cardData.description ? `<div class="link-card-description">${escapeHtml(cardData.description)}</div>` : ''}
    </div>
  `;

  // Store URL in dataset
  card.dataset.url = cardData.url;

  // Click handler - open URL in new tab
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(cardData.url, '_blank');
  });

  // Hover effects
  card.addEventListener('mouseenter', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.add('has-link-card-hover');
    }
  });

  card.addEventListener('mouseleave', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.remove('has-link-card-hover');
    }
  });

  // Right-click to edit the link
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isReadOnly) return;

    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const position = entryData.position || { x: 0, y: 0 };
        placeEditorAtWorld(position.x, position.y, cardData.url, entryEl.id);
      }
    }
  });

  return card;
}

// Extract domain from URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Update entry width to accommodate link card
function updateEntryWidthForLinkCard(element, card) {
  if (!element || !card) return;

  // Link cards have their own styling, just ensure entry is wide enough
  const cardWidth = card.offsetWidth || 360;
  const currentWidth = element.offsetWidth || 0;

  if (cardWidth > currentWidth) {
    element.style.minWidth = cardWidth + 'px';
  }
}
