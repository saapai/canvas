// slack.js — Slack sync card: checkbox channel list, auto-connect all, green for connected

const ANNOUNCEMENT_KEYWORDS = ['announce', 'announcement', 'announcements', 'bulletin', 'news', 'updates', 'notices', 'broadcast', 'important', 'general', 'alerts'];

function sortChannels(channels) {
  return channels.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const aPurpose = (a.purpose || '').toLowerCase();
    const bPurpose = (b.purpose || '').toLowerCase();
    const aIs = ANNOUNCEMENT_KEYWORDS.some(k => aName.includes(k) || aPurpose.includes(k));
    const bIs = ANNOUNCEMENT_KEYWORDS.some(k => bName.includes(k) || bPurpose.includes(k));
    if (aIs && !bIs) return -1;
    if (!aIs && bIs) return 1;
    return aName.localeCompare(bName);
  });
}

async function insertSlackSyncTemplate() {
  let channels = [];
  try {
    const res = await fetch('/api/slack/channels', { credentials: 'include' });
    if (!res.ok) throw new Error('Slack not configured');
    const data = await res.json();
    channels = data.channels || [];
  } catch (err) {
    alert('Slack is not configured. Please add SLACK_BOT_TOKEN to your environment.');
    return;
  }

  if (channels.length === 0) {
    alert('No accessible Slack channels found. Ensure the bot is added to channels.');
    return;
  }

  const sorted = sortChannels(channels);

  // Build checkbox list — all checked by default
  const listHtml = sorted.map(ch => {
    const isAnnouncement = ANNOUNCEMENT_KEYWORDS.some(k =>
      (ch.name || '').toLowerCase().includes(k) || (ch.purpose || '').toLowerCase().includes(k)
    );
    const tag = isAnnouncement ? '<span class="slack-ch-tag">announcements</span>' : '';
    return `<label class="slack-ch-row slack-ch-connected" data-channel-id="${ch.id}" data-channel-name="${ch.name}">
      <input type="checkbox" checked class="slack-ch-check" value="${ch.id}">
      <span class="slack-ch-name">#${ch.name}</span>
      ${tag}
    </label>`;
  }).join('');

  editor.innerHTML = `
    <div class="slack-sync-card" contenteditable="false">
      <div class="slack-sync-header">
        <span class="slack-sync-icon">#</span>
        <span class="slack-sync-title">Slack Channels</span>
        <button class="slack-save-btn" type="button">Save & Sync</button>
      </div>
      <div class="slack-sync-info">All channels connected — syncs every 30 min. Uncheck to stop syncing a channel.</div>
      <div class="slack-channel-list">${listHtml}</div>
    </div>`;
  editor.classList.add('has-content');

  const card = editor.querySelector('.slack-sync-card');
  if (card) setupSlackSyncCardHandlers(card);

  // Auto-connect all channels on first creation
  const entryId = editingEntryId || currentViewEntryId;
  if (entryId) {
    const bulk = sorted.map(ch => ({ channelId: ch.id, channelName: ch.name, enabled: true }));
    fetch(`/api/pages/${entryId}/slack/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ channels: bulk })
    }).then(r => r.json()).then(data => {
      console.log('[Slack] Auto-connected all channels:', data);
      // Trigger initial sync
      fetch(`/api/pages/${entryId}/slack/sync/trigger`, {
        method: 'POST',
        credentials: 'include'
      }).then(r => r.json()).then(syncData => {
        console.log('[Slack] Initial sync result:', syncData);
      }).catch(() => {});
    }).catch(err => console.error('[Slack] Auto-connect failed:', err));
  }
}

function setupSlackSyncCardHandlers(cardElement) {
  // Stop canvas drag on interactive elements
  cardElement.addEventListener('mousedown', (e) => {
    if (e.target.closest('input, button, label, select, a')) {
      e.stopPropagation();
    }
  });

  // Checkbox toggle — update row styling
  cardElement.querySelectorAll('.slack-ch-check').forEach(cb => {
    cb.onchange = () => {
      const row = cb.closest('.slack-ch-row');
      if (row) row.classList.toggle('slack-ch-connected', cb.checked);
    };
  });

  // Save button
  const saveBtn = cardElement.querySelector('.slack-save-btn');
  if (saveBtn) {
    saveBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entryId = cardElement.dataset.entryId || editingEntryId || currentViewEntryId;
      if (!entryId) return;

      const rows = cardElement.querySelectorAll('.slack-ch-row');
      const channels = [];
      rows.forEach(row => {
        const cb = row.querySelector('.slack-ch-check');
        channels.push({
          channelId: row.dataset.channelId,
          channelName: row.dataset.channelName,
          enabled: cb?.checked || false
        });
      });

      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      try {
        const res = await fetch(`/api/pages/${entryId}/slack/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ channels })
        });
        const data = await res.json();
        console.log('[Slack] Bulk save result:', data);

        saveBtn.textContent = 'Saved!';
        setTimeout(() => { saveBtn.textContent = 'Save & Sync'; saveBtn.disabled = false; }, 1500);

        // Trigger sync for newly enabled channels
        fetch(`/api/pages/${entryId}/slack/sync/trigger`, {
          method: 'POST',
          credentials: 'include'
        }).then(r => r.json()).then(syncData => {
          console.log('[Slack] Sync after save:', syncData);
        }).catch(() => {});
      } catch (err) {
        saveBtn.textContent = 'Save & Sync';
        saveBtn.disabled = false;
        alert('Failed to save: ' + err.message);
      }
    };
  }
}

// Re-hydrate a saved card: fetch sync state from backend and update checkboxes
async function hydrateSlackCard(cardElement) {
  const entryId = cardElement.dataset.entryId || editingEntryId || currentViewEntryId;
  if (!entryId) return;

  try {
    const res = await fetch(`/api/pages/${entryId}/slack/sync`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const syncs = data.syncs || [];

    // Build a map of channel_id -> sync_enabled
    const syncMap = {};
    syncs.forEach(s => { syncMap[s.channel_id] = s.sync_enabled; });

    // Update checkboxes
    cardElement.querySelectorAll('.slack-ch-row').forEach(row => {
      const chId = row.dataset.channelId;
      const cb = row.querySelector('.slack-ch-check');
      if (cb && chId in syncMap) {
        cb.checked = syncMap[chId];
        row.classList.toggle('slack-ch-connected', syncMap[chId]);
      }
    });
  } catch (e) {
    console.log('[Slack] Hydrate failed:', e.message);
  }
}

function handleSlackCardKeydown(e) {
  if (editor.querySelector('.slack-sync-card')) {
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  }
}

window.insertSlackSyncTemplate = insertSlackSyncTemplate;
window.setupSlackSyncCardHandlers = setupSlackSyncCardHandlers;
