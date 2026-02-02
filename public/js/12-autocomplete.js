/**
 * Autocomplete
 * Media search autocomplete functionality
 */

// Handle autocomplete search on editor input
function handleAutocompleteSearch() {
  if (!autocomplete || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    autocompleteIsShowing = false;
    return;
  }

  const text = editor.innerText || editor.textContent || '';
  const trimmed = text.trim();

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

// Check if result is relevant to query
function isRelevantMatch(query, result) {
  const queryLower = query.toLowerCase().trim();
  const titleLower = (result.title || '').toLowerCase();
  const artistLower = (result.artist || '').toLowerCase();

  const combinedText = `${titleLower} ${artistLower}`;

  const commonWords = ['the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'is', 'are', 'was', 'were'];
  const queryWords = queryLower.split(/\s+/).filter(word => {
    const cleaned = word.replace(/[^\w]/g, '');
    return cleaned.length > 2 && !commonWords.includes(cleaned);
  });

  if (queryWords.length === 0) {
    return titleLower.includes(queryLower) || artistLower.includes(queryLower);
  }

  const allWordsMatch = queryWords.every(word =>
    titleLower.includes(word) || artistLower.includes(word)
  );

  const hasSubstringMatch = titleLower.includes(queryLower) || artistLower.includes(queryLower);

  return allWordsMatch || hasSubstringMatch;
}

// Search for media (movies and songs)
async function searchMedia(query) {
  if (!autocomplete) return;

  console.log('[Autocomplete] Searching for:', query);

  try {
    const [moviesRes, songsRes] = await Promise.all([
      fetch(`/api/search/movies?q=${encodeURIComponent(query)}`),
      fetch(`/api/search/songs?q=${encodeURIComponent(query)}`)
    ]);

    const moviesData = moviesRes.ok ? await moviesRes.json() : { results: [] };
    const songsData = songsRes.ok ? await songsRes.json() : { results: [] };

    const movies = (moviesData.results || []).filter(result => isRelevantMatch(query, result));
    const songs = (songsData.results || []).filter(result => isRelevantMatch(query, result));

    if (movies.length === 0 && songs.length === 0) {
      console.log('[Autocomplete] No relevant matches found');
      hideAutocomplete();
      return;
    }

    // Interleave movies and songs
    const allResults = [];
    const maxLength = Math.max(movies.length, songs.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < movies.length) allResults.push(movies[i]);
      if (i < songs.length) allResults.push(songs[i]);
    }

    console.log('[Autocomplete] Showing', allResults.length, 'results');
    autocompleteResults = allResults;
    showAutocomplete(allResults);
  } catch (error) {
    console.error('[Autocomplete] Error searching media:', error);
    hideAutocomplete();
  }
}

// Show autocomplete dropdown
function showAutocomplete(results) {
  if (!autocomplete) return;

  autocomplete.innerHTML = '';
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false;

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
        <div class="autocomplete-item-type">${result.type === 'song' ? 'Song' : 'Movie'}</div>
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
      autocompleteKeyboardNavigation = false;
      updateAutocompleteSelection();
    });

    autocomplete.appendChild(item);
  });

  updateAutocompletePosition();
  autocomplete.classList.remove('hidden');
}

// Update autocomplete position relative to editor
function updateAutocompletePosition() {
  if (!autocomplete || !editor || editor.style.display === 'none' || !mediaAutocompleteEnabled) {
    hideAutocomplete();
    return;
  }

  const editorRect = editor.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  const top = editorRect.bottom - viewportRect.top + 8;
  const left = editorRect.left - viewportRect.left;

  autocomplete.style.top = `${top}px`;
  autocomplete.style.left = `${left}px`;
  autocomplete.style.maxWidth = `${Math.min(400, viewportRect.width - left - 16)}px`;
}

// Update autocomplete selection highlight
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

// Hide autocomplete dropdown
function hideAutocomplete() {
  if (!autocomplete) return;

  autocomplete.classList.add('hidden');
  autocomplete.innerHTML = '';
  autocompleteResults = [];
  autocompleteSelectedIndex = -1;
  autocompleteKeyboardNavigation = false;
  autocompleteIsShowing = false;
}

// Initialize autocomplete toggle
function initAutocompleteToggle() {
  const toggleButton = document.getElementById('toggle-button');
  const toggleState = toggleButton?.querySelector('.toggle-state');

  if (toggleButton && toggleState) {
    toggleButton.addEventListener('click', () => {
      mediaAutocompleteEnabled = !mediaAutocompleteEnabled;

      if (mediaAutocompleteEnabled) {
        toggleButton.classList.add('active');
        toggleState.textContent = 'ON';
        if (editor.style.display !== 'none' && editor.innerText.trim().length >= 3) {
          handleAutocompleteSearch();
        }
      } else {
        toggleButton.classList.remove('active');
        toggleState.textContent = 'OFF';
        hideAutocomplete();
      }
    });
  }
}
