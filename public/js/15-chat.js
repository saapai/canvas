/**
 * Chat Panel
 * Canvas chat with trenches and proactive bot
 */

// Chat DOM elements
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatClose = document.getElementById('chat-close');
const chatButton = document.getElementById('chat-button');

// Get entry title for chat
function entryTitle(ed) {
  if (!ed) return 'Untitled';
  if (ed.mediaCardData && ed.mediaCardData.title) return ed.mediaCardData.title;
  const first = (ed.text || '').split('\n')[0].trim();
  return first ? first.substring(0, 80) : 'Untitled';
}

// Extract data points from entry
function dataPointsFromEntry(ed) {
  const out = [];
  const base = { id: ed.id, position: ed.position };

  if (ed.mediaCardData) {
    out.push({
      ...base,
      type: ed.mediaCardData.type === 'song' ? 'song' : ed.mediaCardData.type === 'movie' ? 'movie' : 'media',
      title: ed.mediaCardData.title,
      artist: ed.mediaCardData.artist,
      year: ed.mediaCardData.year,
      url: ed.mediaCardData.url
    });
  } else if (ed.linkCardsData && ed.linkCardsData.length) {
    for (const l of ed.linkCardsData) {
      if (!l) continue;
      out.push({
        ...base,
        type: 'link',
        title: l.title,
        url: l.url,
        description: l.description || null,
        siteName: l.siteName || null
      });
    }
  }

  if (out.length === 0) {
    out.push({
      ...base,
      type: 'text',
      text: (ed.text || '').trim().slice(0, 500)
    });
  }

  return out;
}

// Calculate distance between entries
function dist(a, b) {
  const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
  const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

// Build trenches payload for chat API
function buildTrenchesPayload() {
  const all = Array.from(entries.values()).filter(e => e.id);
  const roots = all.filter(e => !e.parentEntryId);
  const k = 4;

  function buildTrenchRecursive(entry, allEntries, depth = 0) {
    const children = allEntries.filter(e => e.parentEntryId === entry.id);
    const hasChild = (e) => allEntries.some(c => c.parentEntryId === e.id);
    const directDataPoints = children.filter(e => !hasChild(e));
    const subTrenches = children.filter(hasChild);

    const trench = {
      id: entry.id,
      title: entryTitle(entry),
      position: entry.position,
      dataPoints: directDataPoints.flatMap(dataPointsFromEntry),
      subTrenches: subTrenches.map(st => buildTrenchRecursive(st, allEntries, depth + 1))
    };

    const others = allEntries.filter(x => x.id !== entry.id && x.position);
    const sorted = others.map(o => ({ id: o.id, d: dist(entry, o) })).sort((a, b) => a.d - b.d);
    trench.nearbyIds = sorted.slice(0, k).map(x => x.id);

    return trench;
  }

  const payload = [];
  for (const r of roots) {
    payload.push(buildTrenchRecursive(r, all));
  }

  let focusedTrench = null;
  if (currentViewEntryId) {
    const focusedEntry = all.find(e => e.id === currentViewEntryId);
    if (focusedEntry) {
      focusedTrench = buildTrenchRecursive(focusedEntry, all);
    }
  }

  return { trenches: payload, currentViewEntryId, focusedTrench };
}

// Check if focus is in chat panel
function isFocusInChatPanel() {
  const p = document.getElementById('chat-panel');
  return p && !p.classList.contains('hidden') && p.contains(document.activeElement);
}

// Add message to chat
function addChatMessage(text, role, loading = false) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}` + (loading ? ' loading' : '');
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

// Send chat request
async function sendChatRequest(userMessage = null) {
  const payload = buildTrenchesPayload();
  const body = { ...payload, userMessage };

  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Chat failed');
  }

  const data = await res.json();
  return data.message;
}

// Open chat and fetch opener message
function openChatAndFetchOpener() {
  if (!chatPanel || !chatMessages) return;

  chatPanel.classList.remove('hidden');
  chatMessages.innerHTML = '';

  const loader = addChatMessage('...', 'bot', true);

  sendChatRequest(null)
    .then(msg => {
      loader.remove();
      addChatMessage(msg, 'bot');
    })
    .catch(err => {
      loader.remove();
      addChatMessage(err.message || 'Something went wrong.', 'bot');
    });
}

// Handle chat send
function handleChatSend() {
  if (!currentUser) return;

  const raw = (chatInput?.value || '').trim();
  if (!raw) return;

  chatInput.value = '';
  addChatMessage(raw, 'user');

  const loader = addChatMessage('...', 'bot', true);

  sendChatRequest(raw)
    .then(msg => {
      loader.remove();
      addChatMessage(msg, 'bot');
    })
    .catch(err => {
      loader.remove();
      addChatMessage(err.message || 'Something went wrong.', 'bot');
    });
}

// Initialize chat listeners
function initChatListeners() {
  if (chatButton) {
    chatButton.addEventListener('click', () => {
      if (currentUser) {
        openChatAndFetchOpener();
      } else if (chatPanel) {
        chatPanel.classList.remove('hidden');
        chatMessages.innerHTML = '';
        addChatMessage('Sign in to use canvas chat.', 'bot');
      }
    });
  }

  if (chatClose && chatPanel) {
    chatClose.addEventListener('click', () => chatPanel.classList.add('hidden'));
  }

  if (chatSend) {
    chatSend.addEventListener('click', handleChatSend);
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleChatSend();
      }
    });
  }

  if (chatPanel) {
    chatPanel.addEventListener('mousedown', (e) => e.stopPropagation());
  }
}
