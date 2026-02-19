import OpenAI from 'openai';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function processTextWithLLM(text, existingCards) {
  const existingContext = existingCards
    .map(c => `- "${c.text}" (id: ${c.id}, category: ${c.category || 'uncategorized'})`)
    .join('\n');

  const prompt = `You are organizing information cards in a semantic graph. Given a new card with text: "${text}"

Existing cards:
${existingContext || '(none)'}

Analyze the semantic relationships and determine:
1. A category for this card (e.g., "personal", "work", "ideas", "tasks", "notes", etc.)
2. Which existing card(s) it relates to most strongly by semantic meaning (list card IDs), or empty array if standalone
3. A brief summary/title (max 5 words)
4. Key topics/concepts (array of 2-4 keywords)

Respond ONLY with valid JSON in this exact format:
{
  "category": "category_name",
  "relatedCardIds": ["card-id-1"] or [],
  "summary": "brief summary",
  "topics": ["topic1", "topic2"],
  "position": {"x": 0, "y": 0}
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a semantic graph organizer. Analyze text and determine relationships. Respond ONLY with valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = completion.choices[0].message.content.trim();
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const result = JSON.parse(jsonStr);
    
    // Calculate position based on related cards
    if (result.relatedCardIds && result.relatedCardIds.length > 0) {
      const relatedCard = existingCards.find(c => c.id === result.relatedCardIds[0]);
      if (relatedCard && relatedCard.position) {
        // Position near related card with slight offset
        result.position = {
          x: relatedCard.position.x + 250 + (Math.random() * 100 - 50),
          y: relatedCard.position.y + 80 + (Math.random() * 100 - 50)
        };
      }
    }
    
    // If no position set, use default
    if (!result.position) {
      result.position = { x: 0, y: 0 };
    }
    
    return result;
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    // Fallback response
    return {
      category: 'general',
      relatedCardIds: [],
      summary: text.slice(0, 30),
      topics: [],
      position: { x: 0, y: 0 }
    };
  }
}

function extractYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
  } catch {}
  return null;
}

export async function fetchLinkMetadata(url) {
  // YouTube: use oEmbed API for accurate metadata
  const videoId = extractYouTubeVideoId(url);
  if (videoId) {
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        return {
          title: oembed.title,
          description: oembed.author_name,
          image: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          siteName: 'YouTube',
          url,
          videoId,
          isVideo: true
        };
      }
    } catch (e) {
      console.error('YouTube oEmbed failed, falling back to generic fetch:', e);
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract Open Graph tags, fallback to standard meta tags
    const metadata = {
      title: $('meta[property="og:title"]').attr('content') ||
             $('meta[name="twitter:title"]').attr('content') ||
             $('title').text() ||
             url,
      description: $('meta[property="og:description"]').attr('content') ||
                   $('meta[name="twitter:description"]').attr('content') ||
                   $('meta[name="description"]').attr('content') ||
                   '',
      image: $('meta[property="og:image"]').attr('content') ||
             $('meta[name="twitter:image"]').attr('content') ||
             $('meta[name="twitter:image:src"]').attr('content') ||
             '',
      siteName: $('meta[property="og:site_name"]').attr('content') ||
                new URL(url).hostname.replace('www.', ''),
      url: url
    };

    // Clean up description
    if (metadata.description) {
      metadata.description = metadata.description.trim().substring(0, 300);
    }

    return metadata;
  } catch (error) {
    console.error('Error fetching link metadata:', error);
    return {
      title: new URL(url).hostname,
      description: '',
      image: '',
      siteName: new URL(url).hostname.replace('www.', ''),
      url: url
    };
  }
}

export async function generateLinkCard(metadata) {
  const prompt = `You are creating a link preview card similar to Substack. Given this link metadata:

Title: ${metadata.title}
Description: ${metadata.description || 'No description available'}
Site: ${metadata.siteName}
URL: ${metadata.url}

Generate a concise, engaging card preview that:
1. Has a compelling title (use the provided title or create a better one if needed, max 80 chars)
2. Has a brief, engaging description (2-3 sentences, max 150 chars) that summarizes the content
3. Maintains the original site name

Respond ONLY with valid JSON in this exact format:
{
  "title": "compelling title",
  "description": "brief engaging description",
  "siteName": "${metadata.siteName}",
  "image": "${metadata.image || ''}",
  "url": "${metadata.url}"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a content curator creating link preview cards. Make them engaging and informative. Respond ONLY with valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 200
    });

    const content = completion.choices[0].message.content.trim();
    
    // Extract JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const result = JSON.parse(jsonStr);
    
    // Ensure image is included
    if (!result.image && metadata.image) {
      result.image = metadata.image;
    }
    
    return result;
  } catch (error) {
    console.error('OpenAI API error generating card:', error);
    
    // Fallback to original metadata
    return {
      title: metadata.title,
      description: metadata.description || 'Click to view article',
      siteName: metadata.siteName,
      image: metadata.image,
      url: metadata.url
    };
  }
}

export async function convertTextToLatex(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a LaTeX expert that converts plain text and math expressions into proper LaTeX notation (KaTeX-compatible). Respond ONLY with valid JSON, no other text.

PARENTHESES AND SCOPE (critical):
- If the user writes explicit parentheses, respect them exactly.
- When there are NO parentheses, infer the natural scope and make the best guess:
  - "sin of 3x squared" or "sin 3x squared" → argument of sin is 3x^2: \\sin(3x^2).
  - "cos of x squared" → \\cos(x^2). "integral of 3x squared" → \\int 3x^2\\,dx.
  - "integral of sin of 3x squared" → \\int \\sin(3x^2)\\,dx. Always wrap integrands and function arguments in parentheses when converting from plain English.
- For "X of Y" or "X of Y squared", the "of Y" (or "of Y squared") is the argument of X.
- INTEGRALS: "integral of X" must always become \\int X \\,dx. "integral of 3x squared" → $$\\int 3x^2\\,dx$$. Never leave as plain English.
- FRACTIONS: "one fifth" → \\frac{1}{5}; "one half" → \\frac{1}{2}; "x over 2" → \\frac{x}{2}. "400 minus one fifth" → 400 - \\frac{1}{5}.
- POLYNOMIALS AND EQUATIONS: "x squared" → x^2; "3x squared plus 23 equals 400 minus one fifth" → $$3x^2 + 23 = 400 - \\frac{1}{5}$$. "plus" → +, "minus" → -, "equals" → =. Never leave equations as English.
- Produce complete, valid LaTeX only. No partial or placeholder expressions. Output only the JSON with "latex" and "isFullMath" keys.`
        },
        {
          role: 'user',
          content: `Convert the following text into LaTeX notation. Convert math expressions, equations, Greek letters, operations, fractions, integrals, summations, polynomials, and any mathematical notation into proper KaTeX-compatible LaTeX.

If the text is primarily a math expression or equation, wrap it in display math mode ($$...$$).
If the text contains inline math mixed with regular text, wrap math parts in inline math mode ($...$) and keep regular text as-is.

CRITICAL: Convert ALL math to LaTeX. Never leave as English.
- Integrals: "integral of 3x squared" → $$\\int 3x^2\\,dx$$
- Fractions: "one fifth" → \\frac{1}{5}; "400 minus one fifth" → 400 - \\frac{1}{5}
- Equations: "3x squared plus 23 equals 400 minus one fifth" → $$3x^2 + 23 = 400 - \\frac{1}{5}$$
Respect parentheses when present; when there are none, infer scope. Always output complete, valid LaTeX.

Text to convert:
"${text}"

Respond ONLY with valid JSON in this exact format:
{
  "latex": "the LaTeX source string",
  "isFullMath": true
}

Where "isFullMath" is true if the entire content is mathematical, false if it's mixed text and math.`
        }
      ],
      temperature: 0.1,
      max_tokens: 1000
    });

    const content = completion.choices[0].message.content.trim();

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // LaTeX contains backslashes (\sin, \int). JSON only allows \" \\ \/ \b \f \n \r \t \uXXXX.
    // Double any invalid escape so JSON.parse succeeds. Don't touch \uXXXX (unicode).
    function fixJsonLatexEscapes(str) {
      return str.replace(/\\(?!["\\\/bfnrt])(?!u[0-9a-fA-F]{4})(.)/g, '\\\\$1');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (_) {
      jsonStr = fixJsonLatexEscapes(jsonStr);
      parsed = JSON.parse(jsonStr);
    }
    return parsed;
  } catch (error) {
    console.error('Error converting text to LaTeX:', error);
    return { latex: text, isFullMath: false, error: error.message };
  }
}

export async function generateResearchEntries(thoughtChain, canvasContext) {
  // Legacy wrapper — delegates to planResearch for backward compatibility
  const result = await planResearch(thoughtChain, canvasContext);
  const entries = [];
  if (result.answer) entries.push(result.answer);
  result.webResults.forEach(r => entries.push(`${r.title}\n${r.snippet}`));
  result.followUps.forEach(q => entries.push(q));
  return { entries: entries.slice(0, 5) };
}

// Ask GPT-4o-mini for real, cited sources — no external search API needed
async function searchWeb(query) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You recommend real, authoritative web resources. ONLY suggest URLs you are highly confident exist and are stable — Wikipedia articles, official documentation, well-known educational sites (Stanford Encyclopedia, MIT OpenCourseWare, Khan Academy), major publications (Nature, NYT, BBC, The Atlantic), and government/org sites (.gov, .org). NEVER fabricate or guess URLs. If unsure a page exists, do not include it. Respond ONLY with valid JSON.' },
        { role: 'user', content: `Cite 3 real, authoritative sources about: "${query}"

Each source must have a real URL that definitely exists, the exact page title, and a 1-2 sentence summary of what the page covers.

Respond ONLY with valid JSON:
{"results":[{"title":"...","link":"https://...","snippet":"..."}]}` }
      ],
      temperature: 0.2,
      max_tokens: 400
    });
    const content = completion.choices[0].message.content.trim();
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    const parsed = JSON.parse(jsonStr);
    return (parsed.results || []).slice(0, 3).map(r => {
      const link = r.link || r.url || '';
      let favicon = '';
      try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(link).hostname}&sz=32`; } catch {}
      return { title: r.title || '', link, snippet: r.snippet || r.description || '', favicon };
    });
  } catch (e) {
    console.error('[RESEARCH] Web search failed:', e.message);
    return [];
  }
}

async function searchPexels(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=2&orientation=landscape`, {
      headers: { Authorization: apiKey }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos || []).slice(0, 2).map(p => ({
      url: p.src?.medium || p.src?.original || '',
      alt: p.alt || query,
      photographer: p.photographer || ''
    }));
  } catch (e) {
    console.error('[RESEARCH] Pexels search failed:', e.message);
    return [];
  }
}

export async function planResearch(thoughtChain, canvasContext) {
  const contextSnippet = (canvasContext || [])
    .slice(0, 20)
    .map(c => `- "${c.text}"`)
    .join('\n');

  const chainFormatted = thoughtChain
    .map((t, i) => `  ${i + 1}. "${t}"`)
    .join('\n');

  const currentFocus = thoughtChain[thoughtChain.length - 1];

  // Step 1: LLM call to extract search query + follow-up questions
  let searchQuery = currentFocus;
  let followUps = [];
  try {
    const planCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Extract the optimal web search query and generate follow-up questions. Respond ONLY with valid JSON.' },
        { role: 'user', content: `The user is researching: "${currentFocus}"
${thoughtChain.length > 1 ? `\nThought chain:\n${chainFormatted}` : ''}

Generate:
1. An optimal Google search query (concise, specific) for this topic
2. Exactly 2 follow-up questions that would deepen understanding

Respond ONLY with valid JSON:
{"query": "search query here", "followUps": ["question 1?", "question 2?"]}` }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    const planContent = planCompletion.choices[0].message.content.trim();
    let planJson = planContent;
    const planMatch = planContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (planMatch) planJson = planMatch[1];
    const planResult = JSON.parse(planJson);
    if (planResult.query) searchQuery = planResult.query;
    if (Array.isArray(planResult.followUps)) followUps = planResult.followUps.slice(0, 2);
  } catch (e) {
    console.error('[RESEARCH] Plan extraction failed, using raw query:', e.message);
  }

  // Step 2: Fire 3 parallel requests
  const answerPrompt = `The user is researching: "${currentFocus}"
${thoughtChain.length > 1 ? `\nThought chain:\n${chainFormatted}\n` : ''}
Other canvas context:
${contextSnippet || '(none)'}

Write a comprehensive answer in 2–3 paragraphs (like a Google AI Overview). Be direct, specific, and informative. Do NOT use filler phrases. Use \\n between paragraphs.

Respond ONLY with valid JSON:
{"answer": "your answer here"}`;

  const [answerResult, webResults, images] = await Promise.all([
    // LLM answer synthesis
    (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a precise research assistant. Answer directly like a Google AI Overview. Respond ONLY with valid JSON.' },
            { role: 'user', content: answerPrompt }
          ],
          temperature: 0.5,
          max_tokens: 600
        });
        const content = completion.choices[0].message.content.trim();
        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        const parsed = JSON.parse(jsonStr);
        return parsed.answer || '';
      } catch (e) {
        console.error('[RESEARCH] Answer synthesis failed:', e.message);
        return '';
      }
    })(),
    // Web search (Brave first, Serper fallback)
    searchWeb(searchQuery),
    // Pexels image search
    searchPexels(searchQuery)
  ]);

  return {
    answer: answerResult,
    webResults,
    images,
    followUps,
    query: searchQuery
  };
}

export async function extractDeadlinesFromFile(buffer, mimetype, originalname) {
  // Compute today's date in Pacific time so relative terms resolve correctly
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayFull = `${dayNames[pacificNow.getDay()]}, ${monthNames[pacificNow.getMonth()]} ${pacificNow.getDate()}, ${pacificNow.getFullYear()}`;

  const m = pacificNow.getMonth() + 1;
  const d = pacificNow.getDate();
  const y = pacificNow.getFullYear();
  const todayNumeric = `${m}/${d}/${y}`;

  const deadlinePrompt = `Today is ${todayFull} (${todayNumeric}).

Extract EVERY upcoming deadline from the document. Be thorough — scan the ENTIRE document including course schedules, assignment lists, exam dates, and grading sections.

CRITICAL FORMAT RULE: The "deadline" field MUST be in M/D/YYYY numeric format (e.g. "2/17/2026"). NEVER use words like "today", "tomorrow", "next Tuesday", or day names. Always use numbers.

Instructions:
- For recurring assignments (weekly readings, homework sets, etc.), number them: "Reading Response 1", "Homework 2", "Quiz 3", etc. Start numbering from 1 for the first occurrence in the course, even if earlier ones are past.
- Dates like "T 2/10", "Th 2/12", "W 2/4", "F 3/20" are weekday abbreviations + month/day — convert to M/D/${y}.
- If the syllabus says responses are "due on the Tuesday after assigned", compute the actual due date for each one.
- Dates with * (like "Th 1/15*") usually indicate quiz/discussion dates — include those too.
- Include midterms, finals, quizzes, discussion sections with quizzes, project deadlines, extra credit deadlines.
- Put exam times (e.g. "8am to 11am"), reading/paper names, and weight percentages in the "notes" field.
- Use the course name/number (e.g. "PSYCH 85", "PIC 10B") as the "class" value.
- Only include items from ${todayNumeric} onwards (today or future).

Example output:
{"deadlines":[
  {"assignment":"Reading Response 5","deadline":"2/10/2026","class":"PSYCH 85","notes":"Murphy (2019), 40% of grade"},
  {"assignment":"Midterm 2","deadline":"2/25/2026","class":"PIC 10B","notes":"In-class, 25%"},
  {"assignment":"Final Exam","deadline":"3/20/2026","class":"PSYCH 85","notes":"8am to 11am, 60% of grade"}
]}

Respond ONLY with valid JSON: { "deadlines": [...] }`;

  try {
    let messages;

    if (mimetype.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64}`;
      messages = [
        { role: 'system', content: 'You extract deadlines and assignments from documents. Respond ONLY with valid JSON, no other text.' },
        { role: 'user', content: [
          { type: 'text', text: deadlinePrompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]}
      ];
    } else {
      let text;
      if (mimetype === 'application/pdf') {
        const parsed = await pdfParse(buffer);
        text = parsed.text;
      } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        text = buffer.toString('utf-8');
      }

      if (!text || !text.trim()) {
        return { deadlines: [] };
      }

      // Truncate to ~20k chars to stay within token limits
      const truncated = text.length > 20000 ? text.slice(0, 20000) + '\n...(truncated)' : text;

      messages = [
        { role: 'system', content: 'You extract deadlines and assignments from documents. Respond ONLY with valid JSON, no other text.' },
        { role: 'user', content: `${deadlinePrompt}\n\n---\nDocument content:\n${truncated}` }
      ];
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.1,
      max_tokens: 4000
    });

    const content = completion.choices[0].message.content.trim();
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const result = JSON.parse(jsonStr);
    return { deadlines: Array.isArray(result.deadlines) ? result.deadlines : [] };
  } catch (error) {
    console.error('Error extracting deadlines:', error);
    return { deadlines: [], error: error.message };
  }
}
