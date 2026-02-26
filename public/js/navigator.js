// navigator.js — Right-side scroll navigator for quick entry navigation

const navigatorEl = document.getElementById('navigator');
const navigatorList = document.getElementById('navigator-list');
let navigatorActiveId = null;
let navigatorRafId = null;

function buildNavigatorList() {
  if (!navigatorList) return;
  navigatorList.innerHTML = '';

  // Collect visible entries (matching current view context)
  const visible = [];
  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;
    if (!entryData || !entryData.element) return;
    if (entryData.element.style.display === 'none') return;
    visible.push(entryData);
  });

  // Hide navigator when no entries or in read-only with nothing to show
  if (visible.length === 0) {
    navigatorEl.classList.add('nav-hidden');
    return;
  }
  navigatorEl.classList.remove('nav-hidden');

  // Sort by vertical position (top to bottom), then left to right
  visible.sort((a, b) => {
    const dy = a.position.y - b.position.y;
    if (Math.abs(dy) > 40) return dy;
    return a.position.x - b.position.x;
  });

  visible.forEach(entryData => {
    const item = document.createElement('div');
    item.className = 'navigator-item';
    item.dataset.entryId = entryData.id;

    // Get display text: media title, first line of text, or "Untitled"
    let label = '';
    if (entryData.mediaCardData && entryData.mediaCardData.title) {
      label = entryData.mediaCardData.title;
    } else if (entryData.text) {
      label = entryData.text.split('\n')[0].trim();
    }
    // Strip HTML tags for display
    label = label.replace(/<[^>]+>/g, '').trim();
    if (!label) label = 'Untitled';
    // Truncate
    if (label.length > 40) label = label.substring(0, 38) + '…';

    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToEntryFromNav(entryData.id);
    });
    navigatorList.appendChild(item);
  });

  // Update active highlight immediately
  updateNavigatorActive();
}

function updateNavigatorActive() {
  if (!navigatorList || !navigatorEl) return;
  if (navigatorEl.classList.contains('nav-hidden')) return;

  const items = navigatorList.querySelectorAll('.navigator-item');
  if (items.length === 0) return;

  // Find entry closest to viewport center
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centerX = vw / 2;
  const centerY = vh / 2;

  let closestId = null;
  let closestDist = Infinity;

  entries.forEach((entryData, entryId) => {
    if (entryId === 'anchor') return;
    if (!entryData || !entryData.element) return;
    if (entryData.element.style.display === 'none') return;

    const screen = worldToScreen(entryData.position.x, entryData.position.y);
    const dx = screen.x - centerX;
    const dy = screen.y - centerY;
    const dist = dx * dx + dy * dy;
    if (dist < closestDist) {
      closestDist = dist;
      closestId = entryId;
    }
  });

  if (closestId !== navigatorActiveId) {
    navigatorActiveId = closestId;
    items.forEach(item => {
      item.classList.toggle('active', item.dataset.entryId === closestId);
    });
    // Scroll active item into view within the navigator
    const activeItem = navigatorList.querySelector('.navigator-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function navigateToEntryFromNav(entryId) {
  const entryData = entries.get(entryId);
  if (!entryData || !entryData.element) return;

  const el = entryData.element;
  const rect = el.getBoundingClientRect();
  const worldX = entryData.position.x;
  const worldY = entryData.position.y;
  const worldW = rect.width / cam.z;
  const worldH = rect.height / cam.z;

  // Target: center the entry in the viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetX = vw / 2 - (worldX + worldW / 2) * cam.z;
  const targetY = vh / 2 - (worldY + worldH / 2) * cam.z;

  // Animate camera
  const startX = cam.x;
  const startY = cam.y;
  const duration = 500;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic

    cam.x = startX + (targetX - startX) * ease;
    cam.y = startY + (targetY - startY) * ease;
    applyTransform();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      updateNavigatorActive();
    }
  }
  requestAnimationFrame(animate);
}

// Track active entry on pan/zoom using applyTransform hook
(function hookApplyTransform() {
  const origApplyTransform = applyTransform;
  applyTransform = function() {
    origApplyTransform.apply(this, arguments);
    // Throttle via rAF to avoid excessive updates
    if (!navigatorRafId) {
      navigatorRafId = requestAnimationFrame(() => {
        navigatorRafId = null;
        updateNavigatorActive();
      });
    }
  };
})();

// Hide on mobile (touch-primary devices)
function updateNavigatorVisibility() {
  if (!navigatorEl) return;
  const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;
  if (isTouchPrimary) {
    navigatorEl.classList.add('nav-touch-hidden');
  } else {
    navigatorEl.classList.remove('nav-touch-hidden');
  }
}
updateNavigatorVisibility();
window.matchMedia('(pointer: coarse)').addEventListener('change', updateNavigatorVisibility);
