# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install
npm run dev    # node --watch server/index.js (auto-reload, port 3000)
npm start      # production: node server/index.js
```

Environment variables go in `.env` (see `variables.env` for the full list). Required: `POSTGRES_URL`, `JWT_SECRET`, `OPENAI_API_KEY`.

## Architecture

**Infinite canvas diary** — users click anywhere to type, entries persist on a 2D canvas with pan/zoom. Text "melts" into the page with ink-bleed animation, then an LLM semantically organizes entries into a graph layout.

### Three-layer stack

| Layer | Files | Notes |
|-------|-------|-------|
| Frontend | `public/app.js` (~8.9k lines), `styles.css`, `index.html` | Vanilla JS, no framework. Single-page canvas app. |
| Server | `server/index.js`, `server/db.js`, `server/llm.js`, `server/chat.js` | Express.js REST API |
| Vercel mirror | `api/index.js`, `api/db.js`, `api/llm.js` | Duplicate of server/ for Vercel serverless. **Changes to server/ must be mirrored in api/** |

### Frontend core concepts

- **Camera**: `cam = { x, y, z }` — pan (x, y) and zoom (z). `screenToWorld()` / `worldToScreen()` convert coordinates.
- **Entry Map**: `entries = new Map()` — all entry data lives in memory, keyed by ID. Each entry has `{ id, text, textHtml, position, parentEntryId, mediaCardData, linkCardsData, latexData, element }`.
- **Editor**: A single `contenteditable` div repositioned on click. `placeEditorAtWorld()` opens it; `commitEditor()` saves.
- **Trenches**: Entries can be nested (double-click navigates into an entry's children). `navigationStack` tracks breadcrumb path, `currentViewEntryId` filters visible entries.
- **Melt animation**: `meltify()` wraps each character in a `<span>` with staggered delay for the ink-bleed effect.

### Special entry types

All follow the same pattern — check `insertDeadlinesTemplate()` / `insertCalendarTemplate()` for examples:

1. **Deadline table** (`deadline-table` class): Contenteditable grid for assignments. `setupDeadlineTableHandlers()` wires interactive cells. Detected via `htmlContent.includes('deadline-table')`.
2. **Calendar card** (`gcal-card` class): Notion-like month grid. `setupCalendarCardHandlers()` manages per-card state (`card._gcalState`). Events fetched from Google Calendar API.
3. **Media cards**: Movie (TMDB) / Song (Spotify) / Image (Supabase upload). Stored in `mediaCardData`.
4. **Link cards**: Auto-generated previews for URLs in entries. Stored in `linkCardsData` array.
5. **LaTeX entries**: Plain English → GPT-4o-mini → KaTeX rendering. Stored in `latexData`.

When adding new entry types, update these integration points:
- Entry loading (3 locations: main load ~line 696, sub-page load ~line 1291, undo/restore ~line 7209)
- `commitEditor()` — detect and preserve raw HTML
- `updateEntryDimensions()` — measure actual DOM size
- Click handler — prevent double-click navigation
- Enter key handler — prevent commit on Enter
- CSS — add `.entry:has(.new-type)` overrides for whitespace/borders

### Backend

- **Auth**: Phone → Twilio SMS → JWT (30-day, HTTP-only cookie). Same phone can have multiple usernames.
- **Database**: PostgreSQL with soft deletes (`deleted_at`). Schema auto-migrates on startup in `db.js`.
- **LLM**: GPT-4o-mini for text analysis (`processText`), LaTeX conversion (`convertTextToLatex`), deadline extraction, and canvas chat.
- **LaTeX JSON parsing**: The `fixJsonLatexEscapes()` function in `llm.js` is critical — LaTeX backslashes (`\frac`, `\theta`) conflict with JSON escape sequences (`\f` = form feed, `\t` = tab). The parser double-escapes all backslashes inside JSON string values before `JSON.parse`.

### Key API endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/entries` | Fetch entries (supports `page`, `limit`, `parentEntryId`) |
| `POST /api/entries` | Create entry |
| `PUT /api/entries/:id` | Update entry |
| `POST /api/process-text` | LLM semantic analysis |
| `POST /api/convert-latex` | English → LaTeX conversion |
| `POST /api/upload-image` | Image upload to Supabase |
| `POST /api/extract-deadlines` | Parse deadlines from PDF/DOCX |
| `POST /api/chat` | Canvas chat with entry context |
| `GET /api/google/calendar/events` | Google Calendar events |

## Deployment

- **Vercel**: `vercel.json` rewrites all routes to `/api` entry point. Push to main auto-deploys.
- **Local**: `npm run dev` on port 3000.
- Routes: `/:username` renders a user's canvas, `/:username/path/*` navigates nested entries.
