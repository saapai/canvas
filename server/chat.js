import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a witty, proactive canvas companion. You see the user's "trenches"—each trench is an entry (a bucket) and its "data points" are the sub-entries inside it: text, movies, songs, links, etc. You also know (x,y) positions: what's physically close on the canvas is often related.

Your job: be proactive. Don't wait for questions. When you get context, immediately offer something interesting:
- Unusual connections between nearby items (e.g. a song next to a movie, or two links that seem to tell a story)
- A concise observation about a trench's theme or its data points
- A playful riff on a movie/song/link they've saved
- A pattern you notice across trenches (genre, mood, era)

Keep it short (2–4 sentences usually), clever, and specific to their content. No generic small talk. No "How can I help?"—you're the one starting the conversation. Tone: warm, slightly irreverent, curious. If they've written something poignant or funny, acknowledge it. If they ask a direct question, answer it concisely then add one extra observation.

When you have no or very little context, say something brief and inviting about their empty or sparse canvas—still distinctive, not corporate.`;

function buildContextBlock(payload) {
  const { trenches, currentViewEntryId } = payload;
  if (!trenches || trenches.length === 0) {
    return 'The canvas is empty or has no trenches yet.';
  }

  const lines = [];
  lines.push('Current view: ' + (currentViewEntryId ? `inside trench "${currentViewEntryId}"` : 'root (all trenches visible).'));
  lines.push('');

  for (const t of trenches) {
    const px = t.position && t.position.x != null ? t.position.x : '?';
    const py = t.position && t.position.y != null ? t.position.y : '?';
    const parts = [`Trench "${t.title || t.id}" (id: ${t.id}) at (${px}, ${py})`];
    if (t.nearbyIds && t.nearbyIds.length) {
      parts.push(`— spatially near: ${t.nearbyIds.join(', ')}`);
    }
    lines.push(parts.join(' '));

    const points = t.dataPoints || [];
    if (points.length === 0) {
      lines.push('  (no data points)');
    } else {
      for (const p of points) {
        let desc = p.type || 'text';
        if (p.type === 'movie' && p.title) desc = `movie: ${p.title}${p.year ? ` (${p.year})` : ''}`;
        else if (p.type === 'song' && p.title) desc = `song: ${p.title}${p.artist ? ` — ${p.artist}` : ''}`;
        else if (p.type === 'link' && p.title) desc = `link: ${p.title} | ${p.url || ''}`;
        else if (p.text) desc = `text: ${p.text.slice(0, 200)}${p.text.length > 200 ? '…' : ''}`;
        lines.push(`  - ${desc}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function chatWithCanvas(payload) {
  const { userMessage } = payload;
  const context = buildContextBlock(payload);

  const userContent = userMessage
    ? `Canvas context:\n${context}\n\nUser says: ${userMessage}`
    : `Canvas context:\n${context}\n\nNo user message—provide a proactive, interesting opener about their canvas.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      temperature: 0.7,
      max_tokens: 400
    });

    const content = completion.choices[0]?.message?.content?.trim();
    return { ok: true, message: content || "Your canvas is waiting. Add a trench or two and I'll have something to say." };
  } catch (err) {
    console.error('[chat] OpenAI error:', err);
    return { ok: false, error: err.message || 'Chat failed' };
  }
}
