/**
 * Authentication UI
 * Phone-based authentication with verification codes
 */

// Show authentication overlay
function showAuthOverlay(mode = 'login') {
  if (authOverlay) {
    authOverlay.classList.remove('hidden');
    authStepPhone.classList.remove('hidden');
    authStepCode.classList.add('hidden');
    authStepSelectUsername.classList.add('hidden');
    authStepUsername.classList.add('hidden');
    authError.classList.add('hidden');
    authError.textContent = '';

    if (authPhoneInput) authPhoneInput.value = '';
    if (authCodeInput) authCodeInput.value = '';

    // Reset title/subtitle for login mode
    if (authTitle) authTitle.textContent = 'Welcome to Canvas';
    if (authSubtitle) authSubtitle.textContent = 'Enter your phone number to continue';

    // Update phone boxes display
    updatePhoneBoxes('');
  }
}

// Hide authentication overlay
function hideAuthOverlay() {
  if (authOverlay) {
    authOverlay.classList.add('hidden');
  }
}

// Update phone box display
function updatePhoneBoxes(value) {
  if (!authPhoneBoxes) return;
  const boxes = authPhoneBoxes.querySelectorAll('.auth-phone-box');
  for (let i = 0; i < boxes.length; i++) {
    boxes[i].textContent = value[i] || '';
  }
}

// Update code box display
function updateCodeBoxes(value) {
  if (!authCodeBoxes) return;
  const boxes = authCodeBoxes.querySelectorAll('.auth-code-box');
  for (let i = 0; i < boxes.length; i++) {
    boxes[i].textContent = value[i] || '';
  }
}

// Handle phone input
function handlePhoneInput(e) {
  let value = e.target.value.replace(/\D/g, '');
  if (value.length > 10) value = value.substring(0, 10);
  e.target.value = value;
  updatePhoneBoxes(value);

  // Enable/disable send button
  if (authSendCodeBtn) {
    authSendCodeBtn.disabled = value.length !== 10;
  }
}

// Handle code input
function handleCodeInput(e) {
  let value = e.target.value.replace(/\D/g, '');
  if (value.length > 6) value = value.substring(0, 6);
  e.target.value = value;
  updateCodeBoxes(value);

  // Enable/disable verify button
  if (authVerifyCodeBtn) {
    authVerifyCodeBtn.disabled = value.length !== 6;
  }

  // Auto-submit when 6 digits entered
  if (value.length === 6) {
    handleVerifyCode();
  }
}

// Send verification code
async function handleSendCode() {
  const phone = authPhoneInput?.value?.replace(/\D/g, '');
  if (!phone || phone.length !== 10) return;

  const fullPhone = '+1' + phone;

  authSendCodeBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: fullPhone })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send code');
    }

    // Move to code verification step
    verifiedPhone = fullPhone;
    authStepPhone.classList.add('hidden');
    authStepCode.classList.remove('hidden');

    if (authCodeHint) {
      authCodeHint.textContent = `Code sent to ${fullPhone}`;
    }

    // Focus code input
    if (authCodeInput) {
      authCodeInput.value = '';
      updateCodeBoxes('');
      authCodeInput.focus();
    }
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    authSendCodeBtn.disabled = false;
  }
}

// Verify code
async function handleVerifyCode() {
  const code = authCodeInput?.value?.replace(/\D/g, '');
  if (!code || code.length !== 6 || !verifiedPhone) return;

  authVerifyCodeBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: verifiedPhone, code })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Invalid code');
    }

    // Check if user needs to select/create username
    if (data.needsUsername) {
      existingUsernames = data.existingUsernames || [];

      if (existingUsernames.length > 0) {
        // Show username selection
        authStepCode.classList.add('hidden');
        authStepSelectUsername.classList.remove('hidden');

        // Populate select dropdown
        if (authUsernameSelect) {
          authUsernameSelect.innerHTML = '<option value="">Select a space...</option>';
          existingUsernames.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            authUsernameSelect.appendChild(opt);
          });
          const newOpt = document.createElement('option');
          newOpt.value = '__new__';
          newOpt.textContent = '+ Create new space';
          authUsernameSelect.appendChild(newOpt);
        }
      } else {
        // Show username creation
        authStepCode.classList.add('hidden');
        authStepUsername.classList.remove('hidden');
        if (authUsernameInput) authUsernameInput.focus();
      }
    } else {
      // User is logged in and has a username
      currentUser = data.user;
      hideAuthOverlay();

      // Navigate to user's canvas
      if (currentUser && currentUser.username) {
        window.location.href = '/' + currentUser.username;
      } else {
        // Fallback: reload
        window.location.reload();
      }
    }
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    authVerifyCodeBtn.disabled = false;
  }
}

// Handle username selection
async function handleContinueUsername() {
  const selected = authUsernameSelect?.value;
  if (!selected) return;

  if (selected === '__new__') {
    // Show username creation step
    authStepSelectUsername.classList.add('hidden');
    authStepUsername.classList.remove('hidden');
    if (authUsernameInput) authUsernameInput.focus();
    return;
  }

  // Login with existing username
  authContinueUsernameBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/select-username', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selected })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to select username');
    }

    currentUser = data.user;
    hideAuthOverlay();

    // Navigate to selected canvas
    window.location.href = '/' + selected;
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    authContinueUsernameBtn.disabled = false;
  }
}

// Handle username creation
async function handleSaveUsername() {
  const username = authUsernameInput?.value?.trim();
  if (!username) return;

  authSaveUsernameBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/set-username', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create username');
    }

    currentUser = data.user;
    hideAuthOverlay();

    // Navigate to new canvas
    window.location.href = '/' + username;
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    authSaveUsernameBtn.disabled = false;
  }
}

// Edit phone (go back)
function handleEditPhone() {
  authStepCode.classList.add('hidden');
  authStepPhone.classList.remove('hidden');
  authError.classList.add('hidden');
  if (authPhoneInput) authPhoneInput.focus();
}

// Initialize auth event listeners
function initAuthListeners() {
  // Phone input
  if (authPhoneInput) {
    authPhoneInput.addEventListener('input', handlePhoneInput);
    authPhoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && authPhoneInput.value.length === 10) {
        handleSendCode();
      }
    });
  }

  // Phone boxes click to focus input
  if (authPhoneBoxes) {
    authPhoneBoxes.addEventListener('click', () => {
      if (authPhoneInput) authPhoneInput.focus();
    });
  }

  // Code input
  if (authCodeInput) {
    authCodeInput.addEventListener('input', handleCodeInput);
    authCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && authCodeInput.value.length === 6) {
        handleVerifyCode();
      }
    });
  }

  // Code boxes click to focus input
  if (authCodeBoxes) {
    authCodeBoxes.addEventListener('click', () => {
      if (authCodeInput) authCodeInput.focus();
    });
  }

  // Buttons
  if (authSendCodeBtn) authSendCodeBtn.addEventListener('click', handleSendCode);
  if (authVerifyCodeBtn) authVerifyCodeBtn.addEventListener('click', handleVerifyCode);
  if (authEditPhoneBtn) authEditPhoneBtn.addEventListener('click', handleEditPhone);
  if (authContinueUsernameBtn) authContinueUsernameBtn.addEventListener('click', handleContinueUsername);
  if (authSaveUsernameBtn) authSaveUsernameBtn.addEventListener('click', handleSaveUsername);

  // Username input
  if (authUsernameInput) {
    authUsernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSaveUsername();
      }
    });
  }

  // Username select
  if (authUsernameSelect) {
    authUsernameSelect.addEventListener('change', () => {
      if (authContinueUsernameBtn) {
        authContinueUsernameBtn.disabled = !authUsernameSelect.value;
      }
    });
  }
}
