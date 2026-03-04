// SMS Management Modal — inline overlay for managing SMS pages
(function () {
  'use strict';

  let currentEntryId = null;
  let messagesInterval = null;

  const API_PREFIX = '/api/pages/';

  function api() {
    return API_PREFIX + currentEntryId;
  }

  // --- Utilities ---

  function maskPhone(phone) {
    if (!phone) return '***';
    const digits = phone.replace(/\D/g, '');
    return '***' + digits.slice(-4);
  }

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }

  function showToast(msg, type) {
    const container = document.getElementById('manage-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'manage-toast manage-toast-' + (type || 'success');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function confirmDialog(msg) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('manage-confirm-modal');
      const messageEl = document.getElementById('manage-confirm-message');
      const cancelBtn = document.getElementById('manage-confirm-cancel');
      const okBtn = document.getElementById('manage-confirm-ok');
      if (!overlay || !messageEl) { resolve(false); return; }

      messageEl.textContent = msg;
      overlay.classList.add('visible');

      function cleanup(result) {
        overlay.classList.remove('visible');
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        resolve(result);
      }
      function onCancel() { cleanup(false); }
      function onOk() { cleanup(true); }

      cancelBtn.addEventListener('click', onCancel);
      okBtn.addEventListener('click', onOk);
    });
  }

  async function apiFetch(path, options) {
    const opts = Object.assign({ credentials: 'include' }, options || {});
    if (opts.body && typeof opts.body === 'object') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => 'Request failed');
      throw new Error(text);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return null;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  function statusBadge(status) {
    const cls = { draft: 'manage-badge-draft', sent: 'manage-badge-sent', active: 'manage-badge-active', closed: 'manage-badge-closed' };
    return '<span class="manage-badge ' + (cls[status] || 'manage-badge-draft') + '">' + (status || 'draft') + '</span>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Tab system ---

  function setupTabs() {
    const tabs = document.querySelectorAll('.manage-tab');
    const panels = document.querySelectorAll('.manage-panel');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const panelId = 'manage-panel-' + tab.dataset.manageTab;
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
        loadTab(tab.dataset.manageTab);
      });
    });
  }

  function loadTab(name) {
    switch (name) {
      case 'members': loadMembers(); break;
      case 'announcements': loadAnnouncements(); break;
      case 'polls': loadPolls(); break;
      case 'meta-instructions': loadMetaInstructions(); break;
      case 'messages': loadMessages(); break;
    }
  }

  // --- Members ---

  async function loadMembers() {
    const list = document.getElementById('manage-members-list');
    if (!list) return;
    list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">Loading...</p>';
    try {
      const members = await apiFetch(api() + '/members');
      if (!members || members.length === 0) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">No members yet.</p>';
        return;
      }
      list.innerHTML = members.map((m) => {
        const optedOutClass = m.opted_out ? ' manage-opted-out' : '';
        const roleBadge = m.role === 'admin'
          ? '<span class="manage-badge manage-badge-admin">admin</span>'
          : '<span class="manage-badge manage-badge-member">member</span>';
        const optedTag = m.opted_out ? ' <span class="manage-badge manage-badge-closed">opted out</span>' : '';
        return '<div class="manage-card-item' + optedOutClass + '">' +
          '<div class="manage-card-body">' +
            '<div class="manage-name">' + escapeHtml(m.name || 'Unknown') + ' ' + roleBadge + optedTag + '</div>' +
            '<div class="manage-sub">' + maskPhone(m.phone) + '</div>' +
          '</div>' +
          '<div class="manage-card-actions">' +
            '<button class="manage-btn manage-btn-small manage-btn-secondary" data-manage-toggle-role="' + escapeHtml(m.phone) + '" data-current-role="' + (m.role || 'member') + '">' +
              (m.role === 'admin' ? 'Demote' : 'Make Admin') +
            '</button>' +
            '<button class="manage-btn manage-btn-small manage-btn-danger" data-manage-remove-member="' + escapeHtml(m.phone) + '">Remove</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Toggle role — uses URL path for phone
      list.querySelectorAll('[data-manage-toggle-role]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const phone = btn.dataset.manageToggleRole;
          const current = btn.dataset.currentRole;
          const newRole = current === 'admin' ? 'member' : 'admin';
          try {
            await apiFetch(api() + '/members/' + encodeURIComponent(phone), {
              method: 'PUT',
              body: { role: newRole },
            });
            showToast('Role updated', 'success');
            loadMembers();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      // Remove member — uses URL path for phone
      list.querySelectorAll('[data-manage-remove-member]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const phone = btn.dataset.manageRemoveMember;
          const ok = await confirmDialog('Remove this member?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/members/' + encodeURIComponent(phone), {
              method: 'DELETE',
            });
            showToast('Member removed', 'success');
            loadMembers();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="manage-sub" style="padding:12px;color:#c0392b;">Failed to load members.</p>';
    }
  }

  // --- Announcements ---

  async function loadAnnouncements() {
    const list = document.getElementById('manage-announcements-list');
    if (!list) return;
    list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">Loading...</p>';
    try {
      const items = await apiFetch(api() + '/announcements');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">No announcements yet.</p>';
        return;
      }
      list.innerHTML = items.map((a) =>
        '<div class="manage-card-item">' +
          '<div class="manage-card-body">' +
            '<div class="manage-preview">' + escapeHtml(truncate(a.content || a.text, 100)) + '</div>' +
            '<div class="manage-sub">' + statusBadge(a.status) + ' &middot; ' + relativeTime(a.created_at) + '</div>' +
          '</div>' +
          '<div class="manage-card-actions">' +
            (a.status === 'draft'
              ? '<button class="manage-btn manage-btn-small manage-btn-primary" data-manage-send-announcement="' + a.id + '">Send</button>'
              : '') +
            '<button class="manage-btn manage-btn-small manage-btn-danger" data-manage-delete-announcement="' + a.id + '">Delete</button>' +
          '</div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-manage-send-announcement]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Send this announcement to all members?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/announcements/' + btn.dataset.manageSendAnnouncement + '/send', { method: 'POST' });
            showToast('Announcement sent', 'success');
            loadAnnouncements();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('[data-manage-delete-announcement]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this announcement?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/announcements/' + btn.dataset.manageDeleteAnnouncement, { method: 'DELETE' });
            showToast('Announcement deleted', 'success');
            loadAnnouncements();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="manage-sub" style="padding:12px;color:#c0392b;">Failed to load announcements.</p>';
    }
  }

  // --- Polls ---

  async function loadPolls() {
    const list = document.getElementById('manage-polls-list');
    if (!list) return;
    list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">Loading...</p>';
    try {
      const items = await apiFetch(api() + '/polls');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">No polls yet.</p>';
        return;
      }
      list.innerHTML = items.map((p) =>
        '<div class="manage-card-item" style="flex-direction:column;align-items:stretch;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div class="manage-card-body">' +
              '<div class="manage-preview">' + escapeHtml(truncate(p.question || p.question_text, 120)) + '</div>' +
              '<div class="manage-sub">' + statusBadge(p.status) + ' &middot; ' + relativeTime(p.created_at) +
                (p.response_count != null ? ' &middot; ' + p.response_count + ' responses' : '') +
              '</div>' +
            '</div>' +
            '<div class="manage-card-actions">' +
              (p.status === 'draft'
                ? '<button class="manage-btn manage-btn-small manage-btn-primary" data-manage-send-poll="' + p.id + '">Send</button>'
                : '') +
              '<button class="manage-btn manage-btn-small manage-btn-secondary" data-manage-view-responses="' + p.id + '">Responses</button>' +
              '<button class="manage-btn manage-btn-small manage-btn-danger" data-manage-delete-poll="' + p.id + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="manage-responses-summary" id="manage-responses-' + p.id + '" style="display:none;"></div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-manage-send-poll]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Send this poll to all members?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/polls/' + btn.dataset.manageSendPoll + '/send', { method: 'POST' });
            showToast('Poll sent', 'success');
            loadPolls();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('[data-manage-view-responses]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pollId = btn.dataset.manageViewResponses;
          const container = document.getElementById('manage-responses-' + pollId);
          if (!container) return;
          if (container.style.display !== 'none') {
            container.style.display = 'none';
            return;
          }
          container.style.display = 'block';
          container.textContent = 'Loading...';
          try {
            const data = await apiFetch(api() + '/polls/' + pollId + '/responses');
            const responses = data.responses || data;
            if (!responses || responses.length === 0) {
              container.textContent = 'No responses yet.';
              return;
            }
            container.innerHTML = responses.map((r) =>
              '<div style="margin-bottom:6px;">' +
                '<strong>' + maskPhone(r.phone) + '</strong>: ' + escapeHtml(r.response || '(no response)') +
              '</div>'
            ).join('');
          } catch (e) {
            container.textContent = 'Failed to load responses.';
          }
        });
      });

      list.querySelectorAll('[data-manage-delete-poll]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this poll?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/polls/' + btn.dataset.manageDeletePoll, { method: 'DELETE' });
            showToast('Poll deleted', 'success');
            loadPolls();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="manage-sub" style="padding:12px;color:#c0392b;">Failed to load polls.</p>';
    }
  }

  // --- Meta Instructions ---

  async function loadMetaInstructions() {
    const list = document.getElementById('manage-instructions-list');
    if (!list) return;
    list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">Loading...</p>';
    try {
      const items = await apiFetch(api() + '/meta-instructions');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">No instructions yet.</p>';
        return;
      }
      list.innerHTML = items.map((inst) =>
        '<div class="manage-card-item">' +
          '<div class="manage-card-body">' +
            '<div class="manage-preview">' + escapeHtml(inst.instruction || inst.text || '') + '</div>' +
          '</div>' +
          '<div class="manage-card-actions">' +
            '<button class="manage-btn manage-btn-small manage-btn-danger" data-manage-delete-instruction="' + inst.id + '">Delete</button>' +
          '</div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-manage-delete-instruction]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this instruction?');
          if (!ok) return;
          try {
            await apiFetch(api() + '/meta-instructions/' + btn.dataset.manageDeleteInstruction, { method: 'DELETE' });
            showToast('Instruction deleted', 'success');
            loadMetaInstructions();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="manage-sub" style="padding:12px;color:#c0392b;">Failed to load instructions.</p>';
    }
  }

  // --- Messages ---

  async function loadMessages() {
    const list = document.getElementById('manage-messages-list');
    if (!list) return;
    const isInitialLoad = list.innerHTML === '' || list.querySelector('.manage-sub');
    if (isInitialLoad) {
      list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">Loading...</p>';
    }
    try {
      const items = await apiFetch(api() + '/messages');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;opacity:0.5;">No messages yet.</p>';
        return;
      }
      list.innerHTML = items.map((m) => {
        const isInbound = m.direction === 'inbound';
        const arrow = isInbound ? '\u2190' : '\u2192';
        const dirClass = isInbound ? 'inbound' : 'outbound';
        return '<div class="manage-card-item">' +
          '<span class="manage-direction ' + dirClass + '">' + arrow + '</span>' +
          '<div class="manage-card-body">' +
            '<div class="manage-preview">' + escapeHtml(m.text || m.body || '') + '</div>' +
            '<div class="manage-sub">' + maskPhone(m.phone || m.from || m.to) + ' &middot; ' + relativeTime(m.created_at || m.timestamp) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      if (isInitialLoad) {
        list.innerHTML = '<p class="manage-sub" style="padding:12px;color:#c0392b;">Failed to load messages.</p>';
      }
    }

    // Auto-refresh every 30s while messages tab is active
    if (!messagesInterval) {
      messagesInterval = setInterval(() => {
        const activeTab = document.querySelector('.manage-tab.active');
        if (activeTab && activeTab.dataset.manageTab === 'messages') {
          loadMessages();
        }
      }, 30000);
    }
  }

  // --- Forms ---

  function setupForms() {
    // Add member
    const addMemberForm = document.getElementById('manage-add-member-form');
    if (addMemberForm) {
      addMemberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phoneInput = document.getElementById('manage-member-phone');
        const nameInput = document.getElementById('manage-member-name');
        try {
          await apiFetch(api() + '/members', {
            method: 'POST',
            body: { phone: phoneInput.value.trim(), name: nameInput.value.trim(), role: 'member' },
          });
          phoneInput.value = '';
          nameInput.value = '';
          showToast('Member added', 'success');
          loadMembers();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    // Create announcement — sends { content } to match API
    const announcementForm = document.getElementById('manage-create-announcement-form');
    if (announcementForm) {
      announcementForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textarea = document.getElementById('manage-announcement-text');
        try {
          await apiFetch(api() + '/announcements', {
            method: 'POST',
            body: { content: textarea.value.trim() },
          });
          textarea.value = '';
          showToast('Announcement created', 'success');
          loadAnnouncements();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    // Create poll — sends { questionText, requiresReasonForNo } to match API
    const pollForm = document.getElementById('manage-create-poll-form');
    if (pollForm) {
      pollForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const questionEl = document.getElementById('manage-poll-question');
        const mandatoryEl = document.getElementById('manage-poll-mandatory');
        try {
          await apiFetch(api() + '/polls', {
            method: 'POST',
            body: { questionText: questionEl.value.trim(), requiresReasonForNo: mandatoryEl.checked },
          });
          questionEl.value = '';
          mandatoryEl.checked = false;
          showToast('Poll created', 'success');
          loadPolls();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    // Add instruction
    const instructionForm = document.getElementById('manage-add-instruction-form');
    if (instructionForm) {
      instructionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('manage-instruction-text');
        try {
          await apiFetch(api() + '/meta-instructions', {
            method: 'POST',
            body: { instruction: input.value.trim() },
          });
          input.value = '';
          showToast('Instruction added', 'success');
          loadMetaInstructions();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
  }

  // --- Open / Close ---

  function openManageModal(entryId) {
    currentEntryId = entryId;
    const modal = document.getElementById('manage-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Reset to members tab
    const tabs = modal.querySelectorAll('.manage-tab');
    const panels = modal.querySelectorAll('.manage-panel');
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    const firstTab = modal.querySelector('.manage-tab[data-manage-tab="members"]');
    const firstPanel = document.getElementById('manage-panel-members');
    if (firstTab) firstTab.classList.add('active');
    if (firstPanel) firstPanel.classList.add('active');

    loadMembers();
  }

  function closeManageModal() {
    const modal = document.getElementById('manage-modal');
    if (modal) modal.classList.add('hidden');
    if (messagesInterval) {
      clearInterval(messagesInterval);
      messagesInterval = null;
    }
    currentEntryId = null;
  }

  // --- Init ---

  setupTabs();
  setupForms();

  // Close button
  const closeBtn = document.getElementById('manage-close');
  if (closeBtn) closeBtn.addEventListener('click', closeManageModal);

  // Click backdrop to close
  const backdrop = document.querySelector('.manage-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeManageModal);

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('manage-modal');
      if (modal && !modal.classList.contains('hidden')) {
        // If confirm sub-modal is open, close that first
        const confirm = document.getElementById('manage-confirm-modal');
        if (confirm && confirm.classList.contains('visible')) {
          confirm.classList.remove('visible');
        } else {
          closeManageModal();
        }
      }
    }
  });

  // Expose globally
  window.openManageModal = openManageModal;
  window.closeManageModal = closeManageModal;
})();
