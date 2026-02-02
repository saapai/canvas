/**
 * Utility Functions
 * Common helper functions used throughout the application
 */

// Generate user-specific entry ID to prevent overwrites
function generateEntryId() {
  if (!currentUser || !currentUser.id) {
    return `entry-${entryIdCounter++}`;
  }
  const userPrefix = currentUser.id.substring(0, 8);
  return `${userPrefix}-entry-${entryIdCounter++}`;
}

// HTML Escaping
function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", "&#039;");
}

// URL Extraction
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
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 17)
      .replace(/-+$/, '');
    return slug || 'media';
  }

  if (!text) return '';

  let cleanText = text;
  const urls = extractUrls(text);
  urls.forEach(url => {
    cleanText = cleanText.replace(url, '').trim();
  });

  if (!cleanText.trim() && urls.length > 0) {
    cleanText = extractUrlSlug(urls[0]);
  }

  const slug = cleanText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .substring(0, 17)
    .replace(/-+$/, '');

  return slug || 'entry';
}

// Extract meaningful text from URL
function extractUrlSlug(url) {
  try {
    const urlObj = new URL(url);
    let meaningful = urlObj.pathname + urlObj.search;
    meaningful = meaningful.replace(/^\//, '');

    if (!meaningful || meaningful === '/') {
      meaningful = urlObj.hostname
        .replace(/^www\./, '')
        .replace(/\.(com|org|net|edu|gov|io|co|ai)$/, '');
    }

    const clean = meaningful
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10);

    return clean || 'link';
  } catch {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]/gi, '')
      .substring(0, 10) || 'link';
  }
}

// Process text with links (extract URLs and return cleaned text)
function processTextWithLinks(text) {
  if (!text) return { processedText: '', urls: [] };
  const urls = extractUrls(text);
  return { processedText: text, urls };
}

// Check if entry is an image entry
function isImageEntry(element) {
  return element && element.classList && element.classList.contains('canvas-image');
}

// Find parent entry element from a target
function findEntryElement(target) {
  let el = target;
  while (el && el !== viewport && el !== document.body) {
    if (el.classList && el.classList.contains('entry')) {
      return el;
    }
    if (el.id === 'anchor') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// Count child entries for an entry
function countChildEntries(entryId) {
  return Array.from(entries.values()).filter(e => e.parentEntryId === entryId).length;
}

// Check for duplicate entry at current directory level
function findDuplicateEntry(text, parentEntryId, excludeEntryId = null) {
  const normalizedText = text.trim().toLowerCase();
  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;
    if (entryId === excludeEntryId) continue;
    if (!entryData || !entryData.text) continue;

    const entryParent = entryData.parentEntryId ?? null;
    if (entryParent !== parentEntryId) continue;

    if (entryData.text.trim().toLowerCase() === normalizedText) {
      return entryId;
    }
  }
  return null;
}

// Get widest line width from element
function getWidestLineWidth(element) {
  const text = element.textContent || '';
  const lines = text.split('\n');
  const styles = window.getComputedStyle(element);

  let maxWidth = 0;
  lines.forEach(line => {
    const temp = document.createElement('span');
    temp.style.font = styles.font;
    temp.style.fontSize = styles.fontSize;
    temp.style.fontFamily = styles.fontFamily;
    temp.style.visibility = 'hidden';
    temp.style.position = 'absolute';
    temp.style.whiteSpace = 'pre';
    temp.textContent = line || ' ';
    document.body.appendChild(temp);
    maxWidth = Math.max(maxWidth, temp.offsetWidth);
    document.body.removeChild(temp);
  });

  return maxWidth;
}
