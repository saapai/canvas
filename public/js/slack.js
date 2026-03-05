// slack.js — Slack sync card: channel picker, sync status, fact display

// Keywords that indicate announcement-like channels (sorted to top)
const ANNOUNCEMENT_KEYWORDS = ['announce', 'announcement', 'announcements', 'bulletin', 'news', 'updates', 'notices', 'broadcast', 'important', 'general', 'alerts'];

function sortChannels(channels) {
  return channels.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const aPurpose = (a.purpose || '').toLowerCase();
    const bPurpose = (b.purpose || '').toLowerCase();
    const aIsAnnouncement = ANNOUNCEMENT_KEYWORDS.some(k => aName.includes(k) || aPurpose.includes(k));
    const bIsAnnouncement = ANNOUNCEMENT_KEYWORDS.some(k => bName.includes(k) || bPurpose.includes(k));
    if (aIsAnnouncement && !bIsAnnouncement) return -1;
    if (!aIsAnnouncement && bIsAnnouncement) return 1;
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

  // Sort: announcement-adjacent channels first
  const sorted = sortChannels(channels);

  const optionsHtml = sorted.map(ch => {
    const isAnnouncement = ANNOUNCEMENT_KEYWORDS.some(k =>
      (ch.name || '').toLowerCase().includes(k) || (ch.purpose || '').toLowerCase().includes(k)
    );
    const star = isAnnouncement ? '\u2605 ' : '';
    const desc = ch.purpose ? ' \u2014 ' + ch.purpose.substring(0, 50) : '';
    return `<option value="${ch.id}" data-name="${ch.name}">${star}#${ch.name}${desc}</option>`;
  }).join('');

  editor.innerHTML = `
    <div class="slack-sync-card" contenteditable="false">
      <div class="slack-sync-header">
        <span class="slack-sync-icon">#</span>
        <span class="slack-sync-title">Connect Slack Channel</span>
      </div>
      <div class="slack-channel-picker">
        <select class="slack-channel-select">${optionsHtml}</select>
        <button class="slack-connect-btn" type="button">Connect</button>
      </div>
    </div>`;
  editor.classList.add('has-content');

  const card = editor.querySelector('.slack-sync-card');
  if (card) setupSlackSyncCardHandlers(card);
}

function setupSlackSyncCardHandlers(cardElement) {
  // Ensure all interactive elements inside the card work
  cardElement.addEventListener('mousedown', (e) => {
    if (e.target.closest('select, button, input, label, a')) {
      e.stopPropagation();
    }
  });

  // Connect button in channel picker
  const connectBtn = cardElement.querySelector('.slack-connect-btn');
  if (connectBtn) {
    connectBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const select = cardElement.querySelector('.slack-channel-select');
      if (!select) return;
      const channelId = select.value;
      const channelName = select.options[select.selectedIndex]?.dataset?.name || channelId;

      const entryId = editingEntryId || currentViewEntryId;
      if (!entryId) {
        alert('Please save this entry first before connecting Slack.');
        return;
      }

      connectBtn.textContent = 'Connecting...';
      connectBtn.disabled = true;

      try {
        const res = await fetch(`/api/pages/${entryId}/slack/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ channelId, channelName })
        });
        if (!res.ok) throw new Error('Failed to connect');

        renderSlackConnectedCard(cardElement, channelName, channelId, entryId);

        // Trigger initial sync in background
        fetch(`/api/pages/${entryId}/slack/sync/trigger`, {
          method: 'POST',
          credentials: 'include'
        }).then(r => r.json()).then(data => {
          if (data.newFacts > 0) refreshSlackFacts(cardElement, entryId);
        }).catch(() => {});
      } catch (err) {
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        alert('Failed to connect: ' + err.message);
      }
    };
  }

  // Refresh button on connected card
  const refreshBtn = cardElement.querySelector('.slack-refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entryId = cardElement.dataset.entryId || editingEntryId || currentViewEntryId;
      if (!entryId) return;

      refreshBtn.textContent = 'Syncing...';
      refreshBtn.disabled = true;
      try {
        await fetch(`/api/pages/${entryId}/slack/sync/trigger`, {
          method: 'POST',
          credentials: 'include'
        });
        await refreshSlackFacts(cardElement, entryId);
      } catch (err) {
        console.error('Slack sync failed:', err);
      }
      refreshBtn.textContent = 'Sync Now';
      refreshBtn.disabled = false;
    };
  }

  // Disconnect button
  const disconnectBtn = cardElement.querySelector('.slack-disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entryId = cardElement.dataset.entryId || editingEntryId || currentViewEntryId;
      if (!entryId) return;
      if (!confirm('Disconnect this Slack channel? Future syncs will stop.')) return;

      try {
        await fetch(`/api/pages/${entryId}/slack/sync`, {
          method: 'DELETE',
          credentials: 'include'
        });
        cardElement.innerHTML = `
          <div class="slack-sync-header">
            <span class="slack-sync-icon">#</span>
            <span class="slack-sync-title">Slack Disconnected</span>
          </div>
          <p class="slack-disconnected-msg">Channel disconnected. No future syncs will occur.</p>`;
      } catch (err) {
        alert('Failed to disconnect: ' + err.message);
      }
    };
  }
}

function renderSlackConnectedCard(cardElement, channelName, channelId, entryId) {
  cardElement.dataset.entryId = entryId;
  cardElement.dataset.channelId = channelId;
  cardElement.innerHTML = `
    <div class="slack-sync-header">
      <span class="slack-sync-icon">#</span>
      <span class="slack-sync-title">${channelName}</span>
      <span class="slack-sync-status">Connected</span>
    </div>
    <div class="slack-sync-info">Syncs every 30 minutes</div>
    <div class="slack-sync-actions">
      <button class="slack-refresh-btn" type="button">Sync Now</button>
      <button class="slack-disconnect-btn" type="button">Disconnect</button>
    </div>
    <div class="slack-facts-list">
      <div class="slack-facts-loading">Loading facts...</div>
    </div>`;
  setupSlackSyncCardHandlers(cardElement);
  refreshSlackFacts(cardElement, entryId);
}

async function refreshSlackFacts(cardElement, entryId) {
  const factsList = cardElement.querySelector('.slack-facts-list');
  if (!factsList) return;

  try {
    const res = await fetch(`/api/pages/${entryId}/slack/facts?currentOnly=true&limit=20`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to load facts');
    const data = await res.json();
    const facts = data.facts || [];

    if (facts.length === 0) {
      factsList.innerHTML = '<div class="slack-facts-empty">No facts extracted yet. Click "Sync Now" to fetch messages.</div>';
      return;
    }

    factsList.innerHTML = facts.map(f => {
      const date = f.message_date ? new Date(f.message_date).toLocaleDateString() : '';
      const typeClass = f.fact_type !== 'info' ? ` slack-fact-${f.fact_type}` : '';
      const deadlineTag = f.deadline_date ? `<span class="slack-fact-deadline">${new Date(f.deadline_date).toLocaleDateString()}</span>` : '';
      return `<div class="slack-fact-item${typeClass}">
        <span class="slack-fact-date">${date}</span>
        <span class="slack-fact-text">${f.extracted_fact}</span>
        ${deadlineTag}
        ${f.fact_type !== 'info' ? `<span class="slack-fact-type">${f.fact_type}</span>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    factsList.innerHTML = '<div class="slack-facts-empty">Failed to load facts.</div>';
  }
}

function handleSlackCardKeydown(e) {
  if (editor.querySelector('.slack-sync-card')) {
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  }
}

// Make functions available globally
window.insertSlackSyncTemplate = insertSlackSyncTemplate;
window.setupSlackSyncCardHandlers = setupSlackSyncCardHandlers;
