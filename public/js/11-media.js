/**
 * Media Cards
 * Handles media card creation and display (movies, songs)
 */

// Create media card element from data
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
    if (e.shiftKey || justFinishedDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.stopPropagation();

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (mediaData.type === 'song' && mediaData.spotifyUrl) {
        window.open(mediaData.spotifyUrl, '_blank');
      } else if (mediaData.type === 'movie') {
        window.open(`https://www.themoviedb.org/movie/${mediaData.id}`, '_blank');
      }
      return;
    }
  });

  // Double click: navigate into the entry
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      navigateToEntry(entryEl.id);
    }
  });

  // Right-click to edit
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isReadOnly) return;

    const entryEl = card.closest('.entry');
    if (entryEl && entryEl.id) {
      const entryData = entries.get(entryEl.id);
      if (entryData) {
        const rect = entryEl.getBoundingClientRect();
        const worldPos = screenToWorld(rect.left, rect.top);

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

  // Hover effects
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

// Select autocomplete result and create media entry
function selectAutocompleteResult(result) {
  hideAutocomplete();

  // Check if editing existing entry
  if (editingEntryId && editingEntryId !== 'anchor') {
    const entryData = entries.get(editingEntryId);
    if (!entryData) {
      console.warn('[Autocomplete] Missing entry data for edit');
      if (editorWorldPos) {
        showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
      } else {
        hideCursor();
      }
      editingEntryId = null;
      return;
    }

    // Replace existing entry with media card
    entryData.element.innerHTML = '';
    entryData.element.classList.remove('editing');
    entryData.text = '';
    entryData.mediaCardData = result;
    entryData.linkCardsData = null;

    const card = createMediaCard(result);
    entryData.element.appendChild(card);

    if (editorWorldPos) {
      showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
    } else {
      hideCursor();
    }
    editingEntryId = null;

    setTimeout(() => {
      updateEntryDimensions(entryData.element);
      saveEntryToServer(entryData);
    }, 50);

    return;
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
    text: '',
    position: { x: worldPos.x, y: worldPos.y },
    parentEntryId: currentViewEntryId,
    mediaCardData: result
  };
  entries.set(entryId, entryData);

  const card = createMediaCard(result);
  entry.appendChild(card);

  if (editorWorldPos) {
    showCursorAtWorld(editorWorldPos.x, editorWorldPos.y);
  } else {
    hideCursor();
  }
  editingEntryId = null;

  updateEntryVisibility();

  setTimeout(() => {
    updateEntryDimensions(entry);
    saveEntryToServer(entryData);
    saveUndoState('create', { entry: entryData });
  }, 50);
}
