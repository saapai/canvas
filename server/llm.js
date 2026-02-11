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
          content: 'You are a LaTeX expert that converts plain text and math expressions into proper LaTeX notation. Respond ONLY with valid JSON, no other text.'
        },
        {
          role: 'user',
          content: `Convert the following text into LaTeX notation. Convert math expressions, equations, Greek letters, operations, fractions, integrals, summations, matrices, and any mathematical notation into proper LaTeX.

If the text is primarily a math expression or equation, wrap it in display math mode ($$...$$).
If the text contains inline math mixed with regular text, wrap math parts in inline math mode ($...$) and keep regular text as-is.

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

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Error converting text to LaTeX:', error);
    return { latex: text, isFullMath: false, error: error.message };
  }
}

export async function extractDeadlinesFromFile(buffer, mimetype, originalname) {
  // Compute today's date in Pacific time so relative terms resolve correctly
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayFull = `${dayNames[pacificNow.getDay()]}, ${monthNames[pacificNow.getMonth()]} ${pacificNow.getDate()}, ${pacificNow.getFullYear()}`;

  const deadlinePrompt = `IMPORTANT: Today's date is ${todayFull}. You MUST use this exact date as your reference when resolving ALL dates. The current year is ${pacificNow.getFullYear()}.

RULES:
1. Extract EVERY deadline, assignment, due date, exam, quiz, midterm, final, paper, essay, reading response, homework, project, presentation, and task with a specific or inferrable date.
2. For recurring assignments (e.g. "weekly reading responses due every Tuesday", or a schedule showing the same type of assignment multiple times), number them sequentially: "Reading Response 1", "Reading Response 2", etc. or "Homework 1", "Homework 2", etc.
3. Convert ALL dates to M/D/YYYY format. For dates shown as "T 2/10" or "Th 2/12" or "W 2/4" or "F 3/20", these are weekday abbreviations + month/day — convert to M/D/${pacificNow.getFullYear()} format.
4. If a course schedule shows topics/readings assigned on specific dates with due dates on the following Tuesday (or another pattern described in the syllabus), create a deadline entry for each one.
5. Look for patterns like "responses due on the Tuesday after assigned" — if a reading is assigned on T 1/13, the response is due T 1/20 (the next Tuesday).
6. Include exams with their specific date and time in the notes field.
7. Use the course name/number (e.g. "PSYCH 85", "PIC 10B") as the "class" value.
8. Only include items from today (${todayFull}) onwards.

Return a JSON array of objects with these fields:
- "assignment": name of the assignment (use numbered names for recurring items, e.g. "Reading Response 3", "Homework 2", "Quiz 4")
- "deadline": due date in M/D/YYYY format (e.g. "2/11/2026"). Do NOT include day-of-week names.
- "class": course name/number (empty string if not found)
- "notes": additional details like weight/percentage, time, location, reading name (empty string if none)

If no deadlines are found, return an empty array.
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

      // Truncate to ~12k chars to stay within token limits
      const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n...(truncated)' : text;

      messages = [
        { role: 'system', content: 'You extract deadlines and assignments from documents. Respond ONLY with valid JSON, no other text.' },
        { role: 'user', content: `${deadlinePrompt}\n\n---\nDocument content:\n${truncated}` }
      ];
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
