/**
 * Conversation History Module
 * Weighted conversation context for SMS classification
 * Ported from Jarvis history.ts
 */

const HISTORY_WEIGHTS = [1.0, 0.8, 0.6, 0.4, 0.2];
const MAX_HISTORY_LENGTH = 5;

/**
 * Build weighted history from Message objects (from sms_messages table)
 * @param {Array} messages - Array of { direction, text, created_at, meta }
 * @returns {Array} WeightedTurn[]
 */
export function buildWeightedHistoryFromMessages(messages) {
  const turns = messages.map(msg => ({
    role: msg.direction === 'inbound' ? 'user' : 'assistant',
    content: msg.text,
    timestamp: new Date(msg.created_at).getTime(),
    action: msg.meta?.action || null
  }));

  const recentTurns = turns.slice(-MAX_HISTORY_LENGTH);

  return recentTurns.map((turn, index) => {
    const reverseIndex = recentTurns.length - 1 - index;
    const weight = HISTORY_WEIGHTS[reverseIndex] ?? 0.2;
    return { ...turn, weight };
  });
}

export { HISTORY_WEIGHTS, MAX_HISTORY_LENGTH };
