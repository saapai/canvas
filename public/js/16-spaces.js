/**
 * User Spaces Management
 * Handles user spaces (multiple canvases per phone number)
 */

// User menu DOM elements
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
const newSpaceButton = document.getElementById('new-space-button');

// Load user's spaces
async function loadSpaces() {
  if (!spacesList) return;

  console.log('[SPACES] Loading spaces...');

  try {
    const response = await fetch('/api/auth/spaces', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      console.error('[SPACES] Failed to load spaces');
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5);">No spaces found</div>';
      return;
    }

    const data = await response.json();

    spacesList.innerHTML = '';

    if (data && data.spaces && data.spaces.length > 0) {
      data.spaces.forEach(space => {
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

        spaceItem.querySelector('.space-item-content').addEventListener('click', () => {
          window.location.href = `/${space.username}`;
        });

        spaceItem.querySelector('.space-edit-button').addEventListener('click', (e) => {
          e.stopPropagation();
          startEditingSpace(space.id, space.username);
        });

        spacesList.appendChild(spaceItem);
      });
    } else {
      spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: rgba(0,0,0,0.5); font-style: italic;">No spaces yet</div>';
    }
  } catch (error) {
    console.error('[SPACES] Error loading spaces:', error);
    spacesList.innerHTML = '<div class="space-item" style="padding: 12px 16px; color: #dc2626;">Error loading spaces</div>';
  }
}

// Start editing a space username
function startEditingSpace(spaceId, currentUsername) {
  editingSpaceId = spaceId;

  const spaceItem = Array.from(spacesList.children).find(item =>
    item.querySelector('.space-edit-button')?.dataset.spaceId === spaceId
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
      showSpaceError(input, errorDiv, 'Username is required');
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
        showSpaceError(input, errorDiv, error.error || 'Failed to update username');
        return;
      }

      const data = await response.json();
      window.location.href = `/${data.user.username}`;
    } catch (error) {
      showSpaceError(input, errorDiv, 'Failed to update username');
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

// Restore space item after editing
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

// Show error in space form
function showSpaceError(input, errorDiv, message) {
  input.classList.add('error');
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

// Handle logout
async function handleLogout() {
  if (userMenuDropdown) {
    userMenuDropdown.classList.add('hidden');
  }

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });

    currentUser = null;
    window.location.replace('/?logout=true&t=' + Date.now());
  } catch (error) {
    console.error('Error logging out:', error);
    currentUser = null;
    window.location.replace('/?logout=true&t=' + Date.now());
  }
}

// Initialize spaces listeners
function initSpacesListeners() {
  // User menu toggle
  if (userMenuButton && userMenuDropdown) {
    userMenuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('hidden');
      if (!userMenuDropdown.classList.contains('hidden')) {
        loadSpaces();
      }
    });

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

  // Create space button
  if (createSpaceButton && createSpaceForm) {
    createSpaceButton.addEventListener('click', () => {
      createSpaceForm.classList.toggle('hidden');
      if (!createSpaceForm.classList.contains('hidden') && newUsernameInput) {
        newUsernameInput.focus();
      }
    });
  }

  // Create space form
  if (createSpaceCancel) {
    createSpaceCancel.addEventListener('click', () => {
      createSpaceForm.classList.add('hidden');
      if (newUsernameInput) newUsernameInput.value = '';
      if (newUsernameError) newUsernameError.classList.add('hidden');
      if (newUsernameInput) newUsernameInput.classList.remove('error');
    });
  }

  if (createSpaceSubmit) {
    createSpaceSubmit.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const username = newUsernameInput?.value?.trim();
      if (!username) {
        showSpaceError(newUsernameInput, newUsernameError, 'Username is required');
        return;
      }

      try {
        const response = await fetch('/api/auth/create-space', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to create space' }));
          showSpaceError(newUsernameInput, newUsernameError, errorData.error || 'Failed to create space');
          return;
        }

        const data = await response.json();
        if (data.user && data.user.username) {
          window.location.href = `/${data.user.username}`;
        }
      } catch (error) {
        console.error('Error creating space:', error);
        showSpaceError(newUsernameInput, newUsernameError, 'Failed to create space');
      }
    });
  }

  if (newUsernameInput) {
    newUsernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        createSpaceSubmit?.click();
      } else if (e.key === 'Escape') {
        createSpaceCancel?.click();
      }
    });
  }

  // New space button (inline form)
  if (newSpaceButton) {
    newSpaceButton.addEventListener('click', () => {
      if (isCreatingNewSpace) return;

      newSpaceButton.style.display = 'none';
      isCreatingNewSpace = true;

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
          showSpaceError(input, errorDiv, 'Username is required');
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
            showSpaceError(input, errorDiv, data.error || 'Failed to create space');
            return;
          }

          window.location.href = `/${data.user.username}`;
        } catch (error) {
          console.error('Error creating space:', error);
          showSpaceError(input, errorDiv, 'Failed to create space');
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

  // Logout button
  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleLogout();
    });
  }
}
