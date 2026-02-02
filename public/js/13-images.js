/**
 * Image Entry Handling
 * Drag-and-drop image uploads and image entry management
 */

// Handle image drop on canvas
async function handleImageDrop(e) {
  if (isReadOnly) return;

  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  if (!file.type.startsWith('image/')) return;

  const worldPos = screenToWorld(e.clientX, e.clientY);

  console.log('[IMAGE] Uploading image at', worldPos);

  try {
    // Upload image to server
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/api/upload-image', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[IMAGE] Upload failed:', err);
      alert(err.error || 'Failed to upload image');
      return;
    }

    const data = await res.json();
    console.log('[IMAGE] Upload successful:', data);

    // Create image entry
    createImageEntry(data.url, worldPos);
  } catch (err) {
    console.error('[IMAGE] Upload error:', err);
    alert('Failed to upload image');
  }
}

// Create image entry from URL
function createImageEntry(imageUrl, position) {
  const entryId = generateEntryId();

  const entry = document.createElement('div');
  entry.className = 'entry canvas-image';
  entry.id = entryId;
  entry.style.left = `${position.x}px`;
  entry.style.top = `${position.y}px`;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = 'Canvas image';
  img.draggable = false;

  entry.appendChild(img);
  world.appendChild(entry);

  const entryData = {
    id: entryId,
    element: entry,
    text: '',
    position: { x: position.x, y: position.y },
    parentEntryId: currentViewEntryId,
    mediaCardData: {
      type: 'image',
      url: imageUrl
    }
  };

  entries.set(entryId, entryData);

  // Save to server
  saveEntryToServer(entryData);

  // Save undo state
  saveUndoState('create', { entryId: entryId });

  // Update visibility
  updateEntryVisibility();

  return entryData;
}

// Handle drag over for image drop
function handleDragOver(e) {
  if (isReadOnly) return;

  const files = e.dataTransfer?.files || e.dataTransfer?.items;
  let hasImage = false;

  if (files) {
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.type?.startsWith('image/') || item.kind === 'file') {
        hasImage = true;
        break;
      }
    }
  }

  if (hasImage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

// Handle drag enter
function handleDragEnter(e) {
  if (isReadOnly) return;
  e.preventDefault();
}

// Handle drag leave
function handleDragLeave(e) {
  if (isReadOnly) return;
  e.preventDefault();
}

// Initialize image drop listeners
function initImageDropListeners() {
  viewport.addEventListener('dragover', handleDragOver);
  viewport.addEventListener('dragenter', handleDragEnter);
  viewport.addEventListener('dragleave', handleDragLeave);
  viewport.addEventListener('drop', handleImageDrop);
}
