/**
 * Navigation and Breadcrumb
 * Handles navigation between entry levels and breadcrumb display
 */

// Navigate into an entry (make it the current view)
function navigateToEntry(entryId, pushHistory = true) {
  if (isNavigating) return;
  isNavigating = true;
  navigationJustCompleted = false;

  console.log('[NAV] Navigating to entry:', entryId);

  const entryData = entries.get(entryId);
  if (!entryData) {
    console.error('[NAV] Entry not found:', entryId);
    isNavigating = false;
    return;
  }

  // Clear editor if active
  if (editingEntryId) {
    commitEditor();
  }

  // Clear selection
  clearSelection();

  // Push to navigation stack
  if (pushHistory && currentViewEntryId !== entryId) {
    navigationStack.push(currentViewEntryId);
  }

  // Update current view
  currentViewEntryId = entryId;

  // Update URL
  updateUrlForCurrentView();

  // Update entry visibility
  updateEntryVisibility();

  // Update breadcrumb
  updateBreadcrumb();

  // Center on the entry's children or the entry itself
  setTimeout(() => {
    zoomToFitEntries();
    isNavigating = false;
    navigationJustCompleted = true;

    // Reset navigation flag after a delay
    setTimeout(() => {
      navigationJustCompleted = false;
    }, 300);
  }, 50);
}

// Navigate to root (home)
function navigateToRoot() {
  if (isNavigating) return;

  console.log('[NAV] Navigating to root');

  isNavigating = true;
  navigationStack = [];
  currentViewEntryId = null;

  // Update URL
  updateUrlForCurrentView();

  // Update entry visibility
  updateEntryVisibility();

  // Update breadcrumb
  updateBreadcrumb();

  // Center on entries
  setTimeout(() => {
    zoomToFitEntries();
    isNavigating = false;
  }, 50);
}

// Navigate back in stack
function navigateBack() {
  if (navigationStack.length === 0) {
    navigateToRoot();
    return;
  }

  const previousEntry = navigationStack.pop();

  if (previousEntry === null) {
    navigateToRoot();
    return;
  }

  navigateToEntry(previousEntry, false);
}

// Update entry visibility based on current view
function updateEntryVisibility() {
  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;

    const el = entryData.element;
    if (!el) return;

    const parent = entryData.parentEntryId ?? null;
    const isVisible = parent === currentViewEntryId;

    el.style.display = isVisible ? 'block' : 'none';
  });
}

// Update URL to reflect current navigation state
function updateUrlForCurrentView() {
  if (!currentUser || !currentUser.username) return;

  let path = '/' + currentUser.username;

  if (currentViewEntryId) {
    // Build path from navigation stack
    const pathParts = [];

    // Walk up the parent chain
    let current = currentViewEntryId;
    while (current) {
      const entryData = entries.get(current);
      if (!entryData) break;

      const slug = generateEntrySlug(entryData.text, entryData);
      pathParts.unshift(slug);

      current = entryData.parentEntryId;
    }

    if (pathParts.length > 0) {
      path += '/' + pathParts.join('/');
    }
  }

  // Update URL without reload
  if (window.location.pathname !== path) {
    window.history.pushState({ entryId: currentViewEntryId }, '', path);
  }
}

// Update breadcrumb display
function updateBreadcrumb() {
  if (!breadcrumb) return;

  const topbar = document.getElementById('topbar');

  // If at root, hide breadcrumb
  if (!currentViewEntryId) {
    breadcrumb.style.display = 'none';
    if (topbar) topbar.style.display = 'none';
    return;
  }

  // Show topbar and breadcrumb
  if (topbar) topbar.style.display = 'flex';
  breadcrumb.style.display = 'flex';
  breadcrumb.innerHTML = '';

  // Build breadcrumb trail
  const trail = [];
  let current = currentViewEntryId;

  while (current) {
    const entryData = entries.get(current);
    if (!entryData) break;

    trail.unshift({
      id: current,
      text: entryData.text,
      mediaCardData: entryData.mediaCardData
    });

    current = entryData.parentEntryId;
  }

  // Add home item
  const homeItem = document.createElement('span');
  homeItem.className = 'breadcrumb-item';
  homeItem.textContent = currentUser?.username || 'Home';
  homeItem.addEventListener('click', () => navigateToRoot());
  breadcrumb.appendChild(homeItem);

  // Add trail items
  trail.forEach((item, index) => {
    // Add separator
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-separator';
    sep.textContent = '/';
    breadcrumb.appendChild(sep);

    // Add item
    const crumb = document.createElement('span');
    crumb.className = 'breadcrumb-item';

    // Get display text
    let displayText = '';
    if (item.mediaCardData && item.mediaCardData.title) {
      displayText = item.mediaCardData.title;
    } else if (item.text) {
      displayText = item.text.split('\n')[0].substring(0, 30);
      if (item.text.length > 30) displayText += '...';
    } else {
      displayText = 'Entry';
    }

    crumb.textContent = displayText;

    // Last item is current (non-clickable style)
    if (index === trail.length - 1) {
      crumb.style.fontWeight = '500';
    } else {
      crumb.addEventListener('click', () => navigateToEntry(item.id));
    }

    breadcrumb.appendChild(crumb);
  });

  // Scroll to end
  breadcrumb.scrollLeft = breadcrumb.scrollWidth;
}

// Handle browser back/forward
function handlePopState(event) {
  if (event.state && event.state.entryId !== undefined) {
    if (event.state.entryId === null) {
      navigateToRoot();
    } else {
      navigateToEntry(event.state.entryId, false);
    }
  } else {
    // Parse URL to determine entry
    parseUrlAndNavigate();
  }
}

// Parse URL and navigate to correct entry
async function parseUrlAndNavigate() {
  const path = window.location.pathname;
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    // Root
    return;
  }

  const username = parts[0];

  if (parts.length === 1) {
    // Just username - go to root of that user's canvas
    return;
  }

  // Has path parts - need to find the entry
  const slugs = parts.slice(1);

  // Find entry by walking the slug path
  let parentId = null;

  for (const slug of slugs) {
    const entry = findEntryBySlugAndParent(slug, parentId);
    if (!entry) {
      console.log('[NAV] Could not find entry for slug:', slug);
      break;
    }
    parentId = entry.id;
  }

  if (parentId) {
    navigateToEntry(parentId, false);
  }
}

// Find entry by slug and parent
function findEntryBySlugAndParent(slug, parentId) {
  for (const [entryId, entryData] of entries.entries()) {
    if (entryId === 'anchor') continue;

    const entryParent = entryData.parentEntryId ?? null;
    if (entryParent !== parentId) continue;

    const entrySlug = generateEntrySlug(entryData.text, entryData);
    if (entrySlug === slug) {
      return entryData;
    }
  }
  return null;
}
