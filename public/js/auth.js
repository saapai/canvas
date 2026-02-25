// auth.js — Authentication flow (phone verification, username selection)
function setAnchorGreeting() {
  const pageUsername = window.PAGE_USERNAME;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const usernameFromPath = pathParts.length > 0 && pathParts[0] !== 'index.html' ? pathParts[0] : null;
  const displayUsername = pageUsername || usernameFromPath || (currentUser && currentUser.username);

  if (displayUsername) {
    anchor.textContent = `Hello, ${displayUsername}`;
  } else {
    anchor.textContent = 'Hello';
  }

  const userMenuLabel = document.getElementById('user-menu-label');
  if (userMenuLabel) {
    userMenuLabel.textContent = displayUsername || '';
  }
}

function showAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.remove('hidden');
  authError.classList.add('hidden');
  authError.textContent = '';
  if (authTitle) {
    authTitle.textContent = 'What\u2019s your phone number?';
  }
  if (authSubtitle) {
    authSubtitle.textContent = 'We\u2019ll text you a code to sign in.';
  }
  authStepPhone.classList.remove('hidden');
  authStepCode.classList.add('hidden');
  authStepSelectUsername.classList.add('hidden');
  authStepUsername.classList.add('hidden');
  // Clear phone input
  authPhoneInput.value = '';
  updatePhoneBoxes();
  authCodeInput.value = '';
  authUsernameInput.value = '';
  verifiedPhone = null;
  existingUsernames = [];
  // Focus phone input after a short delay to ensure DOM is ready
  setTimeout(() => {
    authPhoneInput.focus();
  }, 100);
}

function hideAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.add('hidden');
}

function setAuthError(message) {
  if (!authError) return;
  if (!message) {
    authError.classList.add('hidden');
    authError.textContent = '';
    return;
  }
  authError.textContent = message;
  authError.classList.remove('hidden');
}

async function handleSendCode() {
  const phoneDigits = authPhoneInput.value.replace(/\D/g, '');
  if (phoneDigits.length !== 10) {
    setAuthError('Enter a complete phone number.');
    return;
  }
  const phone = '+1' + phoneDigits;
  setAuthError('');
  authSendCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send code');
    }
    if (authTitle) {
      authTitle.textContent = 'Enter your verification code';
    }
    if (authSubtitle) {
      authSubtitle.textContent = '';
    }
    if (authCodeHint) {
      authCodeHint.textContent = `Sent SMS to ${phone}`;
    }
    authStepPhone.classList.add('hidden');
    authStepCode.classList.remove('hidden');
    authCodeInput.focus();
    updateCodeBoxes();
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authSendCodeBtn.disabled = false;
  }
}

async function handleVerifyCode() {
  const phoneDigits = authPhoneInput.value.replace(/\D/g, '');
  const phone = '+1' + phoneDigits;
  const code = authCodeInput.value.trim();
  if (phoneDigits.length !== 10 || !code) {
    setAuthError('Enter your phone and the code.');
    return;
  }
  setAuthError('');
  authVerifyCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify code');
    }

    // Check if there are existing usernames to select from
    if (data.existingUsernames && data.existingUsernames.length > 0) {
      verifiedPhone = data.phone;
      existingUsernames = data.existingUsernames;
      showUsernameSelection();
    } else if (data.needsUsername) {
      // No existing usernames, create new one
      currentUser = data.user;
      setAnchorGreeting();
      authStepCode.classList.add('hidden');
      authStepUsername.classList.remove('hidden');
      if (authTitle) {
        authTitle.textContent = 'Choose a name';
      }
      if (authSubtitle) {
        authSubtitle.textContent = '';
      }
      authUsernameInput.focus();
    } else {
      // User already has a username, redirect to their page
      currentUser = data.user;
      setAnchorGreeting();
      if (currentUser && currentUser.username) {
        window.location.href = `/${currentUser.username}`;
      } else {
        hideAuthOverlay();
        await loadEntriesFromServer();
      }
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authVerifyCodeBtn.disabled = false;
  }
}

function updateCodeBoxes() {
  if (!authCodeBoxes) return;
  const value = authCodeInput.value.slice(0, 6);
  const chars = value.split('');
  const boxes = authCodeBoxes.querySelectorAll('.auth-code-box');
  boxes.forEach((box, index) => {
    box.textContent = chars[index] || '';
  });
}

function updatePhoneBoxes() {
  if (!authPhoneBoxes) return;
  const value = authPhoneInput.value.replace(/\D/g, '').slice(0, 10);
  const chars = value.split('');
  const boxes = authPhoneBoxes.querySelectorAll('.auth-phone-box');
  boxes.forEach((box, index) => {
    box.textContent = chars[index] || '';
  });
}

function showUsernameSelection() {
  authStepCode.classList.add('hidden');
  authStepSelectUsername.classList.remove('hidden');
  if (authTitle) {
    authTitle.textContent = 'Select your account';
  }
  if (authSubtitle) {
    authSubtitle.textContent = '';
  }

  // Populate the select dropdown
  authUsernameSelect.innerHTML = '';
  existingUsernames.forEach(user => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.username;
    authUsernameSelect.appendChild(option);
  });

  // Add "Add new" option at the end
  const addNewOption = document.createElement('option');
  addNewOption.value = '__add_new__';
  addNewOption.textContent = '+ Add new';
  authUsernameSelect.appendChild(addNewOption);

  authUsernameSelect.focus();
}

async function handleContinueUsername() {
  const selectedValue = authUsernameSelect.value;
  if (!selectedValue) {
    setAuthError('Please select an account.');
    return;
  }

  setAuthError('');
  authContinueUsernameBtn.disabled = true;

  try {
    if (selectedValue === '__add_new__') {
      // User wants to create a new username
      const res = await fetch('/api/auth/create-new-user', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: verifiedPhone })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create new user');
      }

      currentUser = data.user;
      setAnchorGreeting();
      authStepSelectUsername.classList.add('hidden');
      authStepUsername.classList.remove('hidden');
      if (authTitle) {
        authTitle.textContent = 'Choose a name';
      }
      if (authSubtitle) {
        authSubtitle.textContent = '';
      }
      authUsernameInput.focus();
    } else {
      // User selected an existing username
      const res = await fetch('/api/auth/select-username', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedValue })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to select username');
      }

      currentUser = data.user;
      setAnchorGreeting();
      // Redirect to the user's page
      if (currentUser && currentUser.username) {
        window.location.href = `/${currentUser.username}`;
      } else {
        window.location.href = '/';
      }
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authContinueUsernameBtn.disabled = false;
  }
}

async function handleSaveUsername() {
  const username = authUsernameInput.value.trim();
  if (!username) {
    setAuthError('Enter a name.');
    return;
  }
  setAuthError('');
  authSaveUsernameBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/set-username', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save username');
    }
    currentUser = data.user;

    // Redirect to user's page (just like existing users do when they log in)
    if (currentUser && currentUser.username) {
      window.location.href = `/${currentUser.username}`;
      return;
    }
  } catch (error) {
    console.error(error);
    setAuthError(error.message);
  } finally {
    authSaveUsernameBtn.disabled = false;
  }
}

function initAuthUI() {
  if (!authOverlay) return;
  authSendCodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleSendCode();
  });
  authVerifyCodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleVerifyCode();
  });
  authSaveUsernameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleSaveUsername();
  });
  authContinueUsernameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleContinueUsername();
  });
  authEditPhoneBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthError('');
    authStepCode.classList.add('hidden');
    authStepPhone.classList.remove('hidden');
    authCodeInput.value = '';
    updateCodeBoxes();
    authPhoneInput.focus();
  });
  authCodeBoxes.addEventListener('click', () => {
    authCodeInput.focus();
  });
  authCodeInput.addEventListener('input', (e) => {
    const currentVal = e.target.value;
    // Extract only digits
    const digits = currentVal.replace(/\D/g, '');
    // Limit to max length
    const maxLen = 6;
    const newVal = digits.slice(0, maxLen);

    if (currentVal !== newVal) {
      e.target.value = newVal;
    }

    // Always place cursor at end
    e.target.setSelectionRange(newVal.length, newVal.length);

    // Update visual boxes
    updateCodeBoxes();
  });
  authCodeInput.addEventListener('keydown', (e) => {
    // Backspace/Delete: remove last character
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const currentVal = e.target.value;
      if (currentVal.length > 0) {
        e.target.value = currentVal.slice(0, -1);
        updateCodeBoxes();
      }
      return;
    }
    // Prevent arrow keys, Home, End, Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
      e.preventDefault();
      return;
    }
  });
  authPhoneBoxes.addEventListener('click', () => {
    authPhoneInput.focus();
  });
  authPhoneInput.addEventListener('input', (e) => {
    const currentVal = e.target.value;
    // Extract only digits
    const digits = currentVal.replace(/\D/g, '');
    // Limit to max length
    const maxLen = 10;
    const newVal = digits.slice(0, maxLen);

    if (currentVal !== newVal) {
      e.target.value = newVal;
    }

    // Always place cursor at end
    e.target.setSelectionRange(newVal.length, newVal.length);

    // Update visual boxes
    updatePhoneBoxes();
  });
  authPhoneInput.addEventListener('keydown', (e) => {
    // Backspace/Delete: remove last character
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const currentVal = e.target.value;
      if (currentVal.length > 0) {
        e.target.value = currentVal.slice(0, -1);
        updatePhoneBoxes();
      }
      return;
    }
    // Prevent arrow keys, Home, End, Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
      e.preventDefault();
      return;
    }
  });
  authPhoneInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    // Remove all non-digits and limit to 10
    const digits = paste.replace(/\D/g, '').slice(0, 10);
    authPhoneInput.value = digits;
    updatePhoneBoxes();
    // Move cursor to end after paste
    authPhoneInput.setSelectionRange(digits.length, digits.length);
  });
}
