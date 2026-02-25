// autocomplete.js — Media search autocomplete and media card creation
// Autocomplete functions
let autocompleteIsShowing = false;
let isSelectingAutocomplete = false;

function handleAutocompleteSearch() {
  // Only show autocomplete if:
  // 1. Editor is visible (in edit mode)
  // 2. Media autocomplete is enabled
  if (!autocomplete || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    autocompleteIsShowing = false;
      return;
    }

  const text = editor.innerText || editor.textContent || '';
  const trimmed = text.trim();

  // Only search if we have at least 3 characters
  if (trimmed.length < 3) {
    hideAutocomplete();
    autocompleteIsShowing = false;
      return;
    }

  // Debounce search
  clearTimeout(autocompleteSearchTimeout);
  autocompleteSearchTimeout = setTimeout(() => {
    searchMedia(trimmed);
  }, 300);
}

// Check if a result is relevant to the query
// Returns true only if ALL meaningful words from query match the result
function isRelevantMatch(query, result) {
  const queryLower = query.toLowerCase().trim();
  const titleLower = (result.title || '').toLowerCase();
  const artistLower = (result.artist || '').toLowerCase();

  // Combine title and artist for matching
  const combinedText = `${titleLower} ${artistLower}`;

  // Extract meaningful words from query (ignore common words)
  const commonWords = ['the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'is', 'are', 'was', 'were'];
  const queryWords = queryLower.split(/\s+/).filter(word => {
    const cleaned = word.replace(/[^\w]/g, '');
    return cleaned.length > 2 && !commonWords.includes(cleaned);
  });

  // If query is very short or has no meaningful words, require exact match
  if (queryWords.length === 0) {
    return titleLower.includes(queryLower) || artistLower.includes(queryLower);
  }

  // STRICT: ALL meaningful words must appear in title OR artist
  // This prevents showing results when there's extra unrelated text
  const allWordsMatch = queryWords.every(word =>
    titleLower.includes(word) || artistLower.includes(word)
  );

  // Also allow if the query is a substring of title or artist (for exact matches)
  const hasSubstringMatch = titleLower.includes(queryLower) || artistLower.includes(queryLower);

  // Only show if ALL words match OR it's a substring match
  return allWordsMatch || hasSubstringMatch;
}

async function searchMedia(query) {
  if (!autocomplete) return;

  console.log('[Autocomplete] Searching for:', query);

  try {
    // Search both movies and songs in parallel
    const [moviesRes, songsRes] = await Promise.all([
      fetch(`/api/search/movies?q=${encodeURIComponent(query)}`),
      fetch(`/api/search/songs?q=${encodeURIComponent(query)}`)
    ]);

    console.log('[Autocomplete] Movies response:', moviesRes.ok, moviesRes.status);
    console.log('[Autocomplete] Songs response:', songsRes.ok, songsRes.status);

    const moviesData = moviesRes.ok ? await moviesRes.json() : { results: [] };
    const songsData = songsRes.ok ? await songsRes.json() : { results: [] };

    console.log('[Autocomplete] Movies results:', moviesData.results?.length || 0);
    console.log('[Autocomplete] Songs results:', songsData.results?.length || 0);

    // Filter results to only show relevant matches
    const movies = (moviesData.results || []).filter(result => isRelevantMatch(query, result));
    const songs = (songsData.results || []).filter(result => isRelevantMatch(query, result));

    // Only show if we have at least one relevant match
    if (movies.length === 0 && songs.length === 0) {
      console.log('[Autocomplete] No relevant matches found');
      hideAutocomplete();
      return;
    }

    // Interleave movies and songs for equal weighting
    const allResults = [];
    const maxLength = Math.max(movies.length, songs.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < movies.length) allResults.push(movies[i]);
      if (i < songs.length) allResults.push(songs[i]);
    }

    console.log('[Autocomplete] Showing', allResults.length, 'relevant results');
    autocompleteResults = allResults;
    showAutocomplete(allResults);
  } catch (error) {
    console.error('[Autocomplete] Error searching media:', error);
    hideAutocomplete();
  }
}

function showAutocomplete(results) {
  if (!autocomplete) {
    console.error('[Autocomplete] Autocomplete element not found!');
    return;
  }

  console.log('[Autocomplete] Showing autocomplete with', results.length, 'results');

  autocomplete.innerHTML = '';
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false; // Reset keyboard navigation flag

  results.forEach((result, index) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.index = index;

    const imageHtml = result.image || result.poster
      ? `<div class="autocomplete-item-image" style="background-image: url('${result.image || result.poster}')"></div>`
      : '<div class="autocomplete-item-image"></div>';

    const subtitle = result.type === 'song'
      ? result.artist
      : result.type === 'movie'
      ? result.year ? `(${result.year})` : ''
      : '';

    item.innerHTML = `
      ${imageHtml}
      <div class="autocomplete-item-content">
        <div class="autocomplete-item-title">${escapeHtml(result.title)}</div>
        ${subtitle ? `<div class="autocomplete-item-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="autocomplete-item-type">${result.type === 'song' ? '🎵 Song' : '🎬 Movie'}</div>
      </div>
    `;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isSelectingAutocomplete = true;
    });

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAutocompleteResult(result);
    });

    item.addEventListener('mouseenter', () => {
      autocompleteSelectedIndex = index;
      autocompleteKeyboardNavigation = false; // Mouse hover doesn't count as keyboard navigation
      updateAutocompleteSelection();
    });

    autocomplete.appendChild(item);
  });

  // Position autocomplete below editor
  updateAutocompletePosition();
  autocomplete.classList.remove('hidden');

  console.log('[Autocomplete] Autocomplete displayed at', autocomplete.style.top, autocomplete.style.left);
}

function updateAutocompletePosition() {
  // Only update position if editor is visible (in edit mode) and media autocomplete is enabled
  if (!autocomplete || !editor || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    return;
  }

  const editorRect = editor.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  // Position below editor, relative to viewport
  const top = editorRect.bottom - viewportRect.top + 8;
  const left = editorRect.left - viewportRect.left;

  autocomplete.style.top = `${top}px`;
  autocomplete.style.left = `${left}px`;
  autocomplete.style.maxWidth = `${Math.min(400, viewportRect.width - left - 16)}px`;
}

function updateAutocompleteSelection() {
  if (!autocomplete) return;

  const items = autocomplete.querySelectorAll('.autocomplete-item');
  items.forEach((item, index) => {
    if (index === autocompleteSelectedIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function hideAutocomplete() {
  if (!autocomplete) return;
  autocomplete.classList.add('hidden');
  autocomplete.innerHTML = '';
  autocompleteResults = [];
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false; // Reset keyboard navigation flag
  autocompleteIsShowing = false;
}

function selectAutocompleteResult(result) {
  hideAutocomplete();

  // Check if we're editing an existing entry
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (!entryData) {
      console.warn('[Autocomplete] Missing entry data for edit. Aborting selection to avoid duplicate:', editingEntryId);
      if (editorWorldPos) {
        showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
      } else {
        hideCursor();
      }
      editingEntryId = null;
      return;
    }
    if (entryData) {
      // Replace existing entry with media card
      // Remove existing content
      entryData.element.innerHTML = '';
      entryData.element.classList.remove('editing', 'deadline-editing');

      // Update entry data
      entryData.text = ''; // Clear text - title is in mediaCardData
      entryData.mediaCardData = result;
      entryData.linkCardsData = null; // Clear any link cards

      // Add media card
      const card = createMediaCard(result);
      entryData.element.appendChild(card);

      // Clear and hide editor
      if (editorWorldPos) {
        showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
      } else {
        hideCursor();
      }
      editingEntryId = null;

      // Update entry dimensions and save
      setTimeout(() => {
        updateEntryDimensions(entryData.element);
        saveEntryToServer(entryData);
      }, 50);

      return;
    }
  }

  // Create new entry with media card
  const worldPos = editorWorldPos;

  const entryId = generateEntryId();
  const entry = document.createElement('div');
  entry.className = 'entry melt';
  entry.id = entryId;

  entry.style.left = `${worldPos.x}px`;
  entry.style.top = `${worldPos.y}px`;

  world.appendChild(entry);

  const entryData = {
    id: entryId,
    element: entry,
    text: '', // Keep text empty for media cards - title is in mediaCardData
    position: { x: worldPos.x, y: worldPos.y },
    parentEntryId: currentViewEntryId,
    mediaCardData: result
  };
  entries.set(entryId, entryData);

  // Add media card to entry (no text content)
  const card = createMediaCard(result);
  entry.appendChild(card);

  // Clear editor and show cursor at current position
  if (editorWorldPos) {
    showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
  } else {
    hideCursor();
  }
  editingEntryId = null;

  // Update visibility
  updateEntryVisibility();

  // Update entry dimensions and save
  setTimeout(() => {
    updateEntryDimensions(entry);
    saveEntryToServer(entryData);

    // Save undo state
    saveUndoState('create', {
      entry: entryData
    });
  }, 50);
}

function createMediaCard(mediaData) {
  const card = document.createElement('div');
  card.className = mediaData.image || mediaData.poster ? 'media-card' : 'media-card media-card-no-image';
  card.dataset.mediaId = mediaData.id;
  card.dataset.type = mediaData.type;
  card.dataset.title = mediaData.title;

  const imageUrl = mediaData.image || mediaData.poster;
  const typeLabel = mediaData.type === 'song' ? 'Song' : 'Movie';
  const subtitle = mediaData.type === 'song'
    ? mediaData.artist
    : mediaData.type === 'movie'
    ? mediaData.year ? `${mediaData.year}` : ''
    : '';

  const cardContent = `
    <div class="media-card-inner">
      ${imageUrl ? `<div class="media-card-image" style="background-image: url('${imageUrl}')"></div>` : ''}
      <div class="media-card-content">
        <div class="media-card-type">${typeLabel}</div>
        <div class="media-card-title">${escapeHtml(mediaData.title)}</div>
        ${subtitle ? `<div class="media-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>
    </div>
  `;

  card.innerHTML = cardContent;

  // Single click: Command/Ctrl+click opens in new tab
  card.addEventListener('click', (e) => {
    // Don't handle click if shift was held (shift+click is for dragging)
    // Also don't handle if we just finished dragging (prevents navigation after drag)
    if (e.shiftKey || justFinishedDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.stopPropagation();

    // Command/Ctrl+click opens in new tab
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (mediaData.type === 'song' && mediaData.spotifyUrl) {
        window.open(mediaData.spotifyUrl, '_blank');
      } else if (mediaData.type === 'movie') {
        window.open(`https://www.themoviedb.org/movie/${mediaData.id}`, '_blank');
      }
      return;
    }

    // Regular single click does nothing (allows dragging)
  });

  // Double click: navigate into the entry (like text entries)
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Regular double-click navigates into the entry
    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      navigateToEntry(entryEl.id);
    }
  });

  // Allow mousedown to bubble for dragging, but prevent click from bubbling
  // This allows dragging cards while still preventing unwanted click behavior
  card.addEventListener('mousedown', (e) => {
    // Allow shift+click to bubble for dragging
    // For regular clicks, we still want to allow dragging, so don't stop propagation
    // The entry handler will handle the drag
  });

  // Right-click to edit the media card's link (similar to link cards)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow editing in read-only mode
    if (isReadOnly) return;

    // Get the entry this card belongs to
    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const rect = entryEl.getBoundingClientRect();
        const worldPos = screenToWorld(rect.left, rect.top);

        // Get the URL to edit
        let urlToEdit = '';
        if (mediaData.type === 'song' && mediaData.spotifyUrl) {
          urlToEdit = mediaData.spotifyUrl;
        } else if (mediaData.type === 'movie') {
          urlToEdit = `https://www.themoviedb.org/movie/${mediaData.id}`;
        }

        placeEditorAtWorld(worldPos.x, worldPos.y, urlToEdit, entryEl.id);
      }
    }
  });

  // Hover effects similar to link cards
  card.addEventListener('mouseenter', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.add('has-media-card-hover');
    }
  });

  card.addEventListener('mouseleave', () => {
    const entry = card.closest('.entry');
    if (entry) {
      entry.classList.remove('has-media-card-hover');
    }
  });

  return card;
}

// Hide autocomplete when clicking outside
document.addEventListener('click', (e) => {
  if (autocomplete && !autocomplete.contains(e.target) && e.target !== editor && !editor.contains(e.target)) {
    hideAutocomplete();
  }
});

// Update autocomplete position when editor moves or viewport changes
const updateAutocompleteOnMove = () => {
  if (autocomplete && !autocomplete.classList.contains('hidden')) {
    updateAutocompletePosition();
  }
};

editor.addEventListener('input', updateAutocompleteOnMove);
window.addEventListener('scroll', updateAutocompleteOnMove);
window.addEventListener('resize', updateAutocompleteOnMove);
