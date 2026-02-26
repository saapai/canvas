// spaces.js — User spaces/accounts management and user menu

// User menu functionality
const userMenuButton = document.getElementById('user-menu-button');
const userMenuDropdown = document.getElementById('user-menu-dropdown');
const spacesList = document.getElementById('spaces-list');
const createSpaceButton = document.getElementById('create-space-button');
const createSpaceForm = document.getElementById('create-space-form');
const newUsernameInput = document.getElementById('new-username-input');
const newUsernameError = document.getElementById('new-username-error');
const createSpaceCancel = document.getElementById('create-space-cancel');
const createSpaceSubmit = document.getElementById('create-space-submit');
const logoutButton = document.getElementById('logout-button');
const userMenu = document.getElementById('user-menu');

let editingSpaceId = null;

// Hide user menu if not logged in
if (userMenu) {
  fetch('/api/auth/me', { credentials: 'include' })
    .then(res => {
      if (!res.ok) {
        userMenu.style.display = 'none';
      }
    })
    .catch(() => {
      userMenu.style.display = 'none';
    });
}

// Toggle dropdown
if (userMenuButton && userMenuDropdown) {
  userMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown.classList.toggle('hidden');
    if (!userMenuDropdown.classList.contains('hidden')) {
      loadSpaces();
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (userMenuDropdown && !userMenuDropdown.contains(e.target) && !userMenuButton.contains(e.target)) {
      userMenuDropdown.classList.add('hidden');
      if (createSpaceForm) {
        createSpaceForm.classList.add('hidden');
      }
      editingSpaceId = null;
    }
  });
}

// Load spaces
async function loadSpaces() {
  if (!spacesList) {
    console.log('[SPACES CLIENT] spacesList element not found');
    return;
  }

  console.log('[SPACES CLIENT] Starting to load spaces...');
  console.log('[SPACES CLIENT] Current user:', currentUser);
  console.log('[SPACES CLIENT] User logged in:', !!currentUser);

  try {
    console.log('[SPACES CLIENT] Fetching /api/auth/spaces with credentials: include');
    const response = await fetch('/api/auth/spaces', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('[SPACES CLIENT] Response status:', response.status);
    console.log('[SPACES CLIENT] Response ok:', response.ok);
    console.log('[SPACES CLIENT] Response headers:', {
      'content-type': response.headers.get('content-type'),
      'set-cookie': response.headers.get('set-cookie')
    });

    if (!response.ok) {
      const errorData = await response.json().catch((e) => {
        console.error('[SPACES CLIENT] Failed to parse error response:', e);
        return { error: 'Failed to parse error response' };
      });
      console.error('[SPACES CLIENT] Failed to load spaces:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5);">No spaces found</div>';
      return;
    }

    const data = await response.json().catch((e) => {
      console.error('[SPACES CLIENT] Failed to parse JSON response:', e);
      return null;
    });

    console.log('[SPACES CLIENT] Response data:', data);
    console.log('[SPACES CLIENT] Spaces array:', data.spaces);
    console.log('[SPACES CLIENT] Spaces count:', data.spaces?.length || 0);

    if (data && data.spaces) {
      console.log('[SPACES CLIENT] Processing', data.spaces.length, 'spaces');
      data.spaces.forEach((space, index) => {
        console.log(`[SPACES CLIENT] Space ${index + 1}:`, space);
      });
    }

    spacesList.innerHTML = '';

    if (data && data.spaces && data.spaces.length > 0) {
      console.log('[SPACES CLIENT] Rendering', data.spaces.length, 'spaces');
      data.spaces.forEach(space => {
        console.log('[SPACES CLIENT] Rendering space:', space);
        const spaceItem = document.createElement('div');
        spaceItem.className = 'space-item';
        spaceItem.innerHTML = `
          <div class="space-item-content">
            <span class="space-username">${escapeHtml(space.username)}</span>
          </div>
          <button class="space-edit-button" data-space-id="${space.id}" data-space-username="${escapeHtml(space.username)}" title="Edit username">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        `;

        // Click to navigate
        spaceItem.querySelector('.space-item-content').addEventListener('click', () => {
          console.log('[SPACES CLIENT] Navigating to space:', space.username);
          window.location.href = `/${space.username}`;
        });

        // Edit button
        spaceItem.querySelector('.space-edit-button').addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[SPACES CLIENT] Editing space:', space.id, space.username);
          startEditingSpace(space.id, space.username);
        });

        spacesList.appendChild(spaceItem);
      });
      console.log('[SPACES CLIENT] Successfully rendered', data.spaces.length, 'spaces');
    } else {
      console.log('[SPACES CLIENT] No spaces found in response');
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5); font-style: italic;">No spaces yet</div>';
    }
  } catch (error) {
    console.error('[SPACES CLIENT] Error loading spaces:', error);
    console.error('[SPACES CLIENT] Error stack:', error.stack);
    spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: #dc2626;">Error loading spaces</div>';
  }
}

function startEditingSpace(spaceId, currentUsername) {
  editingSpaceId = spaceId;
  const spaceItem = Array.from(spacesList.children).find(item =>
    item.querySelector('.space-edit-button').dataset.spaceId === spaceId
  );

  if (!spaceItem) return;

  const content = spaceItem.querySelector('.space-item-content');
  const editButton = spaceItem.querySelector('.space-edit-button');

  const editForm = document.createElement('div');
  editForm.className = 'space-edit-form';
  editForm.innerHTML = `
    <input type="text" class="space-edit-input" value="${escapeHtml(currentUsername)}" maxlength="40" />
    <div class="username-error hidden"></div>
    <div class="space-edit-buttons">
      <button class="space-edit-cancel">Cancel</button>
      <button class="space-edit-save">Save</button>
    </div>
  `;

  const input = editForm.querySelector('.space-edit-input');
  const errorDiv = editForm.querySelector('.username-error');
  const cancelBtn = editForm.querySelector('.space-edit-cancel');
  const saveBtn = editForm.querySelector('.space-edit-save');

  content.replaceWith(editForm);
  editButton.style.display = 'none';

  input.focus();
  input.select();

  cancelBtn.addEventListener('click', () => {
    restoreSpaceItem(spaceItem, spaceId, currentUsername);
  });

  saveBtn.addEventListener('click', async () => {
    const newUsername = input.value.trim();
    if (!newUsername) {
      showError(input, errorDiv, 'Username is required');
      return;
    }

    if (newUsername === currentUsername) {
      restoreSpaceItem(spaceItem, spaceId, currentUsername);
      return;
    }

    try {
      const response = await fetch('/api/auth/update-username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newUsername: newUsername, spaceId: spaceId })
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.error === 'Username already taken') {
          showError(input, errorDiv, 'Username already taken');
        } else {
          showError(input, errorDiv, error.error || 'Failed to update username');
        }
        return;
      }

      // Success - reload page to new username
      const data = await response.json();
      window.location.href = `/${data.user.username}`;
    } catch (error) {
      showError(input, errorDiv, 'Failed to update username');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });
}

function restoreSpaceItem(spaceItem, spaceId, username) {
  const editForm = spaceItem.querySelector('.space-edit-form');
  const editButton = spaceItem.querySelector('.space-edit-button');

  const content = document.createElement('div');
  content.className = 'space-item-content';
  content.innerHTML = `<span class="space-username">${escapeHtml(username)}</span>`;

  content.addEventListener('click', () => {
    window.location.href = `/${username}`;
  });

  editForm.replaceWith(content);
  editButton.style.display = '';
  editingSpaceId = null;
}

function showError(input, errorDiv, message) {
  input.classList.add('error');
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}


// Create new space
if (createSpaceButton && createSpaceForm) {
  createSpaceButton.addEventListener('click', () => {
    createSpaceForm.classList.toggle('hidden');
    if (!createSpaceForm.classList.contains('hidden')) {
      newUsernameInput.focus();
    }
  });

  createSpaceCancel.addEventListener('click', () => {
    createSpaceForm.classList.add('hidden');
    newUsernameInput.value = '';
    newUsernameError.classList.add('hidden');
    newUsernameInput.classList.remove('error');
  });

  createSpaceSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const username = newUsernameInput.value.trim();
    if (!username) {
      showError(newUsernameInput, newUsernameError, 'Username is required');
      return;
    }

    // Clear previous errors
    newUsernameInput.classList.remove('error');
    newUsernameError.classList.add('hidden');

    try {
      const response = await fetch('/api/auth/create-space', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create space' }));
        if (errorData.error === 'Username already taken') {
          showError(newUsernameInput, newUsernameError, 'Username already taken');
        } else {
          showError(newUsernameInput, newUsernameError, errorData.error || 'Failed to create space');
        }
        return;
      }

      // Success - navigate to new space
      const data = await response.json();
      if (data.user && data.user.username) {
        window.location.href = `/${data.user.username}`;
      } else {
        showError(newUsernameInput, newUsernameError, 'Failed to create space');
      }
    } catch (error) {
      console.error('Error creating space:', error);
      showError(newUsernameInput, newUsernameError, 'Failed to create space');
    }
  });

  newUsernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      createSpaceSubmit.click();
    } else if (e.key === 'Escape') {
      createSpaceCancel.click();
    }
  });
}

// Logout
if (logoutButton) {
  logoutButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Close the dropdown
    if (userMenuDropdown) {
      userMenuDropdown.classList.add('hidden');
    }

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

      // Clear any local state
      currentUser = null;
      isLoggedIn = false;

      // Force a hard redirect to root with cache busting to ensure fresh page load
      window.location.replace('/?logout=true&t=' + Date.now());
    } catch (error) {
      console.error('Error logging out:', error);
      // Still redirect even if logout fails
      currentUser = null;
      isLoggedIn = false;
      window.location.replace('/?logout=true&t=' + Date.now());
    }
  });
}

// Handle new space button - show inline form
const newSpaceButton = document.getElementById('new-space-button');
let isCreatingNewSpace = false;

if (newSpaceButton) {
  newSpaceButton.addEventListener('click', () => {
    if (isCreatingNewSpace) return;

    // Hide the button and show form
    newSpaceButton.style.display = 'none';
    isCreatingNewSpace = true;

    // Create form similar to edit form
    const newSpaceForm = document.createElement('div');
    newSpaceForm.className = 'space-edit-form';
    newSpaceForm.innerHTML = `
      <input type="text" class="space-edit-input" placeholder="Enter username" maxlength="40" />
      <div class="username-error hidden"></div>
      <div class="space-edit-buttons">
        <button class="space-edit-cancel">Cancel</button>
        <button class="space-edit-save">Create</button>
      </div>
    `;

    const input = newSpaceForm.querySelector('.space-edit-input');
    const errorDiv = newSpaceForm.querySelector('.username-error');
    const cancelBtn = newSpaceForm.querySelector('.space-edit-cancel');
    const saveBtn = newSpaceForm.querySelector('.space-edit-save');

    // Insert form before the button
    newSpaceButton.parentNode.insertBefore(newSpaceForm, newSpaceButton);

    input.focus();

    const cleanup = () => {
      newSpaceForm.remove();
      newSpaceButton.style.display = 'block';
      isCreatingNewSpace = false;
    };

    cancelBtn.addEventListener('click', cleanup);

    saveBtn.addEventListener('click', async () => {
      const trimmed = input.value.trim();
      if (!trimmed) {
        showError(input, errorDiv, 'Username is required');
        return;
      }

      try {
        const response = await fetch('/api/auth/create-space', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: trimmed })
        });

        const data = await response.json();

        if (!response.ok) {
          if (data.error === 'Username already taken') {
            showError(input, errorDiv, 'Username already taken');
          } else {
            showError(input, errorDiv, data.error || 'Failed to create space');
          }
          return;
        }

        // Navigate to the new space
        window.location.href = `/${data.user.username}`;
      } catch (error) {
        console.error('Error creating space:', error);
        showError(input, errorDiv, 'Failed to create space');
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cleanup();
      }
    });
  });
}

// Search modal removed - using autocomplete instead
