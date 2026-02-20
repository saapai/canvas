import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a witty, insightful canvas companion who deeply understands the user's creative space. You see their "trenches"—nested organizational structures where each trench can contain data points (text, movies, songs, links) AND sub-trenches that go deeper. You also know (x,y) positions: spatial proximity often reveals connections.

CRITICAL: Traverse ALL nested trenches recursively. If a trench has sub-trenches, explore them fully. Don't just mention the top level—dive deep into nested structures. For example, if there's a "movies" trench with a "best" sub-trench containing movies, you MUST mention those movies specifically.

Your job: be proactive and genuinely interesting. When you get context:
- Traverse nested trenches completely—mention specific movies, songs, links from deep sub-trenches
- Make unexpected connections between spatially nearby items across different trenches
- Synthesize patterns: genre clusters, thematic threads, emotional arcs
- For vague entries (like "horrible > sink not wide enough"), use your knowledge to infer context and make it meaningful
- For specific entries (like "acura vs subaru"), enrich with external knowledge and synthesize with their personal context
- Reference specific media: "I see you've got [Movie Title] in your 'best' collection—that's a bold choice because..."

Be specific, curious, and insightful. Reference actual titles, artists, years. Make connections they might not see. Tone: warm, slightly irreverent, genuinely curious. No generic responses. If they ask about something, traverse ALL relevant trenches to find the answer.

When you have no context, say something brief and inviting—still distinctive, not corporate.`;

function buildTrenchContext(trench, depth = 0, indent = '') {
  const lines = [];
  const px = trench.position && trench.position.x != null ? trench.position.x : '?';
  const py = trench.position && trench.position.y != null ? trench.position.y : '?';
  const prefix = indent + (depth > 0 ? '└─ ' : '');
  const parts = [`${prefix}Trench "${trench.title || trench.id}" (id: ${trench.id}) at (${px}, ${py})`];
  if (trench.nearbyIds && trench.nearbyIds.length) {
    parts.push(`— spatially near: ${trench.nearbyIds.join(', ')}`);
  }
  lines.push(parts.join(' '));

  // Data points (direct children that are leaves or media)
  const points = trench.dataPoints || [];
  if (points.length > 0) {
    for (const p of points) {
      let desc = '';
      if (p.type === 'movie' && p.title) {
        desc = `movie: "${p.title}"${p.year ? ` (${p.year})` : ''}`;
      } else if (p.type === 'song' && p.title) {
        desc = `song: "${p.title}"${p.artist ? ` by ${p.artist}` : ''}`;
      } else if (p.type === 'link' && p.title) {
        desc = `link: "${p.title}" | ${p.url || ''}`;
        if (p.description) desc += ` | ${p.description.slice(0, 120)}`;
        if (p.siteName) desc += ` (${p.siteName})`;
      } else if (p.text) {
        desc = `text: "${p.text.slice(0, 300)}${p.text.length > 300 ? '…' : ''}"`;
      } else {
        desc = `${p.type || 'unknown'}: ${p.title || p.id}`;
      }
      lines.push(`${indent}  • ${desc}`);
    }
  }

  // Sub-trenches (nested structures)
  const subTrenches = trench.subTrenches || [];
  if (subTrenches.length > 0) {
    for (const st of subTrenches) {
      lines.push(...buildTrenchContext(st, depth + 1, indent + '  '));
    }
  }

  return lines;
}

function buildContextBlock(payload) {
  const { trenches, currentViewEntryId, focusedTrench } = payload;
  if (!trenches || trenches.length === 0) {
    return 'The canvas is empty or has no trenches yet.';
  }

  const lines = [];
  lines.push('Current view: ' + (currentViewEntryId ? `inside trench "${currentViewEntryId}"` : 'root (all trenches visible).'));
  lines.push('');

  // If focused on a specific trench, show it first with full detail
  if (focusedTrench) {
    lines.push('=== FOCUSED TRENCH (current view) ===');
    lines.push(...buildTrenchContext(focusedTrench, 0, ''));
    lines.push('');
    lines.push('=== ALL ROOT TRENCHES ===');
  }

  // Show all root trenches with full nested structure
  for (const t of trenches) {
    lines.push(...buildTrenchContext(t, 0, ''));
    lines.push('');
  }

  return lines.join('\n');
}

async function enrichWithExternalContext(contextText, userMessage) {
  const truncate = contextText.length > 6000 ? contextText.slice(0, 6000) + '\n...[truncated]' : contextText;
  const enrichmentPrompt = `Given this canvas context, identify 2–4 entries that would benefit from external knowledge:

${truncate}

${userMessage ? `User asked: ${userMessage}` : ''}

For vague entries (e.g. "sink not wide enough", "venmo comments") or specific ones (e.g. "acura vs subaru", "analog vs digital"): 
- externalContext: brief external knowledge that illuminates the entry
- synthesis: combine the user's entry with that knowledge in 1–2 sentences

Return ONLY a JSON array, e.g. [{"entry":"...","externalContext":"...","synthesis":"..."}]. If none apply, return [].`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a context enrichment assistant. Return ONLY a valid JSON array, no other text.' },
        { role: 'user', content: enrichmentPrompt }
      ],
      temperature: 0.4,
      max_tokens: 600
    });

    const content = completion.choices[0]?.message?.content?.trim();
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.log('[CHAT] Enrichment parse/run failed (non-critical):', e.message);
  }
  return [];
}

export async function organizeDroppedContent(payload) {
  const { content, userReply, previousPlacements } = payload;

  console.log('[DROP] organizeDroppedContent called:', {
    contentType: content?.type,
    itemCount: content?.items?.length,
    hasUserReply: !!userReply
  });

  const context = buildContextBlock(payload);

  const items = (content?.items || []).map((it, i) => `${i + 1}. [${it.type}] ${it.url || it.text || it.name || '(empty)'}`).join('\n');

  let userContent;
  if (userReply) {
    const prev = previousPlacements ? JSON.stringify(previousPlacements) : '[]';
    userContent = `Canvas structure:\n${context}\n\nDropped items:\n${items}\n\nYou previously suggested placements: ${prev}\nUser replied: "${userReply}"\n\nBased on the user's reply, decide where to place the items.`;
  } else {
    userContent = `Canvas structure:\n${context}\n\nThe user dropped the following items onto the canvas:\n${items}\n\nDecide where to place each item. If the structure makes it obvious (e.g. an image dropped and there's an "images" trench), place it directly. If ambiguous, ask the user.`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a canvas organization assistant. The canvas has "trenches" (nested pages). Each trench has an id and may contain data points and sub-trenches.

Your job: Given dropped items and the canvas structure, decide which trench (page) each item belongs in.

RESPOND WITH ONLY valid JSON matching one of these shapes:

If you can decide placement:
{"action":"place","placements":[{"targetPageId":"trench-id-or-null","content":{"type":"image|link|text|file","url":"...","text":"...","name":"..."}}],"message":"Brief explanation"}

Use targetPageId: null to place at root level.

If you need to ask the user:
{"action":"ask","message":"Your question to the user","placements":[]}

Keep messages concise. Prefer placing items when the intent is clear.`
        },
        { role: 'user', content: userContent }
      ],
      temperature: 0.3,
      max_tokens: 800
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    console.log('[DROP] LLM response:', raw?.substring(0, 200));

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ok: true,
          action: parsed.action || 'ask',
          placements: Array.isArray(parsed.placements) ? parsed.placements : [],
          message: parsed.message || ''
        };
      }
    } catch (parseErr) {
      console.log('[DROP] JSON parse failed, falling back to ask:', parseErr.message);
    }

    return { ok: true, action: 'ask', placements: [], message: raw || 'Where should I place these items?' };
  } catch (err) {
    console.error('[DROP] OpenAI error:', err.message);
    return { ok: false, error: err.message || 'Organization failed' };
  }
}

export async function chatWithCanvas(payload) {
  const { userMessage } = payload;
  
  console.log('[CHAT] Request received:', {
    hasUserMessage: !!userMessage,
    trenchesCount: payload.trenches?.length || 0,
    hasFocusedTrench: !!payload.focusedTrench,
    currentViewEntryId: payload.currentViewEntryId || null
  });

  const context = buildContextBlock(payload);
  
  console.log('[CHAT] Context built:', {
    contextLength: context.length,
    preview: context.substring(0, 200) + '...'
  });

  // Enrich with external context for vague/specific entries
  const enrichments = await enrichWithExternalContext(context, userMessage);
  let enrichedContext = context;
  if (enrichments.length > 0) {
    console.log('[CHAT] Enrichments found:', enrichments.length);
    enrichedContext += '\n\n=== EXTERNAL CONTEXT & SYNTHESIS ===\n';
    for (const e of enrichments) {
      enrichedContext += `Entry: "${e.entry}"\n`;
      enrichedContext += `External context: ${e.externalContext}\n`;
      enrichedContext += `Synthesis: ${e.synthesis}\n\n`;
    }
  }

  const userContent = userMessage
    ? `Canvas context:\n${enrichedContext}\n\nUser says: ${userMessage}`
    : `Canvas context:\n${enrichedContext}\n\nNo user message—provide a proactive, interesting opener about their canvas. Traverse ALL nested trenches and mention specific movies, songs, links you find.`;

  try {
    console.log('[CHAT] Calling OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      temperature: 0.8,
      max_tokens: 600
    });

    const content = completion.choices[0]?.message?.content?.trim();
    console.log('[CHAT] Response received:', {
      length: content?.length || 0,
      preview: content?.substring(0, 100) + '...'
    });

    return { ok: true, message: content || "Your canvas is waiting. Add a trench or two and I'll have something to say." };
  } catch (err) {
    console.error('[CHAT] OpenAI error:', err);
    console.error('[CHAT] Error details:', {
      message: err.message,
      status: err.status,
      code: err.code
    });
    return { ok: false, error: err.message || 'Chat failed' };
  }
}
