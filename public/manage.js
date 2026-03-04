(function () {
  'use strict';

  // --- URL parsing ---
  const pathParts = window.location.pathname.split('/');
  // /:username/page/:entryId/manage
  const entryId = pathParts[3];

  if (!entryId) {
    document.querySelector('main').innerHTML =
      '<p style="padding:40px;text-align:center;color:#e94560;">Invalid page URL. Entry ID not found.</p>';
    return;
  }

  const API = `/api/pages/${entryId}`;

  // --- Utilities ---

  function maskPhone(phone) {
    if (!phone) return '***';
    const digits = phone.replace(/\D/g, '');
    return '***' + digits.slice(-4);
  }

  function relativeTime(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
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
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'success');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function confirmDialog(msg) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirm-modal');
      const messageEl = document.getElementById('confirm-message');
      const cancelBtn = document.getElementById('confirm-cancel');
      const okBtn = document.getElementById('confirm-ok');

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
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return null;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  function statusBadge(status) {
    const cls = {
      draft: 'badge-draft',
      sent: 'badge-sent',
      active: 'badge-active',
      closed: 'badge-closed',
    };
    return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + (status || 'draft') + '</span>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Tab system ---

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = 'panel-' + tab.dataset.tab;
      document.getElementById(panelId).classList.add('active');
      loadTab(tab.dataset.tab);
    });
  });

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
    const list = document.getElementById('members-list');
    list.innerHTML = '<p class="sub" style="padding:12px;">Loading...</p>';
    try {
      const members = await apiFetch(API + '/members');
      if (!members || members.length === 0) {
        list.innerHTML = '<p class="sub" style="padding:12px;">No members yet.</p>';
        return;
      }
      list.innerHTML = members.map((m) => {
        const optedOutClass = m.opted_out ? ' opted-out' : '';
        const roleBadge = m.role === 'admin'
          ? '<span class="badge badge-admin">admin</span>'
          : '<span class="badge badge-member">member</span>';
        const optedTag = m.opted_out ? ' <span class="badge badge-closed">opted out</span>' : '';
        return '<div class="card' + optedOutClass + '">' +
          '<div class="card-body">' +
            '<div class="name">' + escapeHtml(m.name || 'Unknown') + ' ' + roleBadge + optedTag + '</div>' +
            '<div class="sub">' + maskPhone(m.phone) + '</div>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-small btn-secondary" data-toggle-role="' + escapeHtml(m.phone) + '" data-current-role="' + (m.role || 'member') + '">' +
              (m.role === 'admin' ? 'Demote' : 'Make Admin') +
            '</button>' +
            '<button class="btn btn-small btn-danger" data-remove-member="' + escapeHtml(m.phone) + '">Remove</button>' +
          '</div>' +
        '</div>';
      }).join('');

      list.querySelectorAll('[data-toggle-role]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const phone = btn.dataset.toggleRole;
          const current = btn.dataset.currentRole;
          const newRole = current === 'admin' ? 'member' : 'admin';
          try {
            await apiFetch(API + '/members', {
              method: 'PUT',
              body: { phone, role: newRole },
            });
            showToast('Role updated', 'success');
            loadMembers();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('[data-remove-member]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const phone = btn.dataset.removeMember;
          const ok = await confirmDialog('Remove this member?');
          if (!ok) return;
          try {
            await apiFetch(API + '/members', {
              method: 'DELETE',
              body: { phone },
            });
            showToast('Member removed', 'success');
            loadMembers();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="sub" style="padding:12px;color:#e94560;">Failed to load members.</p>';
    }
  }

  document.getElementById('add-member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('member-phone');
    const nameInput = document.getElementById('member-name');
    try {
      await apiFetch(API + '/members', {
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

  // --- Announcements ---

  async function loadAnnouncements() {
    const list = document.getElementById('announcements-list');
    list.innerHTML = '<p class="sub" style="padding:12px;">Loading...</p>';
    try {
      const items = await apiFetch(API + '/announcements');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="sub" style="padding:12px;">No announcements yet.</p>';
        return;
      }
      list.innerHTML = items.map((a) =>
        '<div class="card">' +
          '<div class="card-body">' +
            '<div class="preview">' + escapeHtml(truncate(a.text, 100)) + '</div>' +
            '<div class="sub">' + statusBadge(a.status) + ' &middot; ' + relativeTime(a.created_at) + '</div>' +
          '</div>' +
          '<div class="card-actions">' +
            (a.status === 'draft'
              ? '<button class="btn btn-small btn-primary" data-send-announcement="' + a.id + '">Send</button>'
              : '') +
            '<button class="btn btn-small btn-danger" data-delete-announcement="' + a.id + '">Delete</button>' +
          '</div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-send-announcement]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Send this announcement to all members?');
          if (!ok) return;
          try {
            await apiFetch(API + '/announcements/' + btn.dataset.sendAnnouncement + '/send', { method: 'POST' });
            showToast('Announcement sent', 'success');
            loadAnnouncements();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('[data-delete-announcement]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this announcement?');
          if (!ok) return;
          try {
            await apiFetch(API + '/announcements/' + btn.dataset.deleteAnnouncement, { method: 'DELETE' });
            showToast('Announcement deleted', 'success');
            loadAnnouncements();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="sub" style="padding:12px;color:#e94560;">Failed to load announcements.</p>';
    }
  }

  document.getElementById('create-announcement-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const textarea = document.getElementById('announcement-text');
    try {
      await apiFetch(API + '/announcements', {
        method: 'POST',
        body: { text: textarea.value.trim() },
      });
      textarea.value = '';
      showToast('Announcement created', 'success');
      loadAnnouncements();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  // --- Polls ---

  async function loadPolls() {
    const list = document.getElementById('polls-list');
    list.innerHTML = '<p class="sub" style="padding:12px;">Loading...</p>';
    try {
      const items = await apiFetch(API + '/polls');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="sub" style="padding:12px;">No polls yet.</p>';
        return;
      }
      list.innerHTML = items.map((p) =>
        '<div class="card" style="flex-direction:column;align-items:stretch;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div class="card-body">' +
              '<div class="preview">' + escapeHtml(truncate(p.question, 120)) + '</div>' +
              '<div class="sub">' + statusBadge(p.status) + ' &middot; ' + relativeTime(p.created_at) +
                (p.response_count != null ? ' &middot; ' + p.response_count + ' responses' : '') +
              '</div>' +
            '</div>' +
            '<div class="card-actions">' +
              (p.status === 'draft'
                ? '<button class="btn btn-small btn-primary" data-send-poll="' + p.id + '">Send</button>'
                : '') +
              '<button class="btn btn-small btn-secondary" data-view-responses="' + p.id + '">Responses</button>' +
              '<button class="btn btn-small btn-danger" data-delete-poll="' + p.id + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="responses-summary" id="responses-' + p.id + '" style="display:none;"></div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-send-poll]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Send this poll to all members?');
          if (!ok) return;
          try {
            await apiFetch(API + '/polls/' + btn.dataset.sendPoll + '/send', { method: 'POST' });
            showToast('Poll sent', 'success');
            loadPolls();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('[data-view-responses]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pollId = btn.dataset.viewResponses;
          const container = document.getElementById('responses-' + pollId);
          if (container.style.display !== 'none') {
            container.style.display = 'none';
            return;
          }
          container.style.display = 'block';
          container.textContent = 'Loading...';
          try {
            const responses = await apiFetch(API + '/polls/' + pollId + '/responses');
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

      list.querySelectorAll('[data-delete-poll]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this poll?');
          if (!ok) return;
          try {
            await apiFetch(API + '/polls/' + btn.dataset.deletePoll, { method: 'DELETE' });
            showToast('Poll deleted', 'success');
            loadPolls();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="sub" style="padding:12px;color:#e94560;">Failed to load polls.</p>';
    }
  }

  document.getElementById('create-poll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const questionEl = document.getElementById('poll-question');
    const mandatoryEl = document.getElementById('poll-mandatory');
    try {
      await apiFetch(API + '/polls', {
        method: 'POST',
        body: { question: questionEl.value.trim(), mandatory: mandatoryEl.checked },
      });
      questionEl.value = '';
      mandatoryEl.checked = false;
      showToast('Poll created', 'success');
      loadPolls();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  // --- Meta Instructions ---

  async function loadMetaInstructions() {
    const list = document.getElementById('instructions-list');
    list.innerHTML = '<p class="sub" style="padding:12px;">Loading...</p>';
    try {
      const items = await apiFetch(API + '/meta-instructions');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="sub" style="padding:12px;">No instructions yet.</p>';
        return;
      }
      list.innerHTML = items.map((inst) =>
        '<div class="card">' +
          '<div class="card-body">' +
            '<div class="preview">' + escapeHtml(inst.instruction || inst.text || '') + '</div>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-small btn-danger" data-delete-instruction="' + inst.id + '">Delete</button>' +
          '</div>' +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-delete-instruction]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this instruction?');
          if (!ok) return;
          try {
            await apiFetch(API + '/meta-instructions/' + btn.dataset.deleteInstruction, { method: 'DELETE' });
            showToast('Instruction deleted', 'success');
            loadMetaInstructions();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="sub" style="padding:12px;color:#e94560;">Failed to load instructions.</p>';
    }
  }

  document.getElementById('add-instruction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('instruction-text');
    try {
      await apiFetch(API + '/meta-instructions', {
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

  // --- Messages ---

  let messagesInterval = null;

  async function loadMessages() {
    const list = document.getElementById('messages-list');
    const isInitialLoad = list.innerHTML === '' || list.querySelector('.sub');
    if (isInitialLoad) {
      list.innerHTML = '<p class="sub" style="padding:12px;">Loading...</p>';
    }
    try {
      const items = await apiFetch(API + '/messages');
      if (!items || items.length === 0) {
        list.innerHTML = '<p class="sub" style="padding:12px;">No messages yet.</p>';
        return;
      }
      list.innerHTML = items.map((m) => {
        const isInbound = m.direction === 'inbound';
        const arrow = isInbound ? '\u2190' : '\u2192';
        const dirClass = isInbound ? 'inbound' : 'outbound';
        return '<div class="card">' +
          '<span class="direction ' + dirClass + '">' + arrow + '</span>' +
          '<div class="card-body">' +
            '<div class="preview">' + escapeHtml(m.text || m.body || '') + '</div>' +
            '<div class="sub">' + maskPhone(m.phone || m.from || m.to) + ' &middot; ' + relativeTime(m.created_at || m.timestamp) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      if (isInitialLoad) {
        list.innerHTML = '<p class="sub" style="padding:12px;color:#e94560;">Failed to load messages.</p>';
      }
    }

    // Set up auto-refresh
    if (!messagesInterval) {
      messagesInterval = setInterval(() => {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.dataset.tab === 'messages') {
          loadMessages();
        }
      }, 30000);
    }
  }

  // --- Init ---

  loadMembers();
})();
