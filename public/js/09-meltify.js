/**
 * Meltify Animation
 * Applies ink-bleed animation effect to text
 */

// Convert text to meltify HTML with animation spans
function meltify(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const chars = [...line]; // Handle unicode properly

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const escaped = escapeHtml(char);

      // Randomly add drip class to some characters
      const drip = Math.random() < 0.05 ? ' drip' : '';

      // Add random animation delay for organic feel
      const delay = (lineIndex * 0.02 + i * 0.015 + Math.random() * 0.08).toFixed(3);

      result.push(
        `<span class="char${drip}" data-ch="${escaped}" style="animation-delay:${delay}s">${escaped}</span>`
      );
    }

    // Add line break between lines (except last line)
    if (lineIndex < lines.length - 1) {
      result.push('<br>');
    }
  }

  return result.join('');
}

// Fade out an element
function fadeOutElement(element, callback) {
  if (!element) return;

  element.classList.add('fade-out');

  setTimeout(() => {
    if (callback) callback();
  }, 600);
}

// Remove melt class from entry (after animation completes)
function removeMeltClass(element, delay = 1200) {
  setTimeout(() => {
    if (element) {
      element.classList.remove('melt');
    }
  }, delay);
}
