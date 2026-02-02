# Canvas Diary

An infinite canvas diary page with graph-based semantic organization. Type anywhere on the page, and your entries are processed by an LLM to organize them in a meaningful graph layout. All entries are persisted to a database and synced across sessions.

## Features

- **Infinite Canvas**: Pan and zoom infinitely
- **Click-to-Type**: Click anywhere to start typing
- **Ink Bleed Animation**: Text melts into the page with an ink-bleed effect
- **Graph-Based Organization**: Entries are processed by LLM and positioned based on semantic relationships
- **Sketchbook Aesthetic**: Paper-like background with subtle textures
- **Persistent Storage**: All entries are saved to a database and persist across sessions
- **Per-User Accounts**: Phone-based sign-in with per-user canvases and greetings

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env` file in the root directory:
```
OPENAI_API_KEY=your_openai_api_key_here
JWT_SECRET=your_jwt_secret_here
PORT=3000
TMDB_API_KEY=your_tmdb_api_key_here
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_VERIFY_SERVICE_SID=your_verify_service_sid
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=canvas-image
```

**API Keys:**
- **TMDB_API_KEY**: Get a free API key from [themoviedb.org](https://www.themoviedb.org/settings/api) for movie search
- **Spotify credentials**: Get from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) for song search (optional)
- **Twilio**: Required for phone-based authentication
- **Supabase** (optional): For drag-and-drop image uploads. Create a project at [supabase.com](https://supabase.com), create a **public** storage bucket named `canvas-image`, add policies so the app can read/write (or use the dashboard’s “New policy” for your folder pattern). Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=canvas-image` in your env (and in Vercel → Project → Settings → Environment Variables if you deploy there).

3. Start the server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

4. Open your browser to `http://localhost:3000`

## Usage

- **Click anywhere** on the canvas to start typing
- **Cmd/Ctrl+Enter** to commit your text (triggers melt animation)
- **Escape** to cancel typing
- **Drag** to pan around
- **Scroll** to zoom in/out
- **Drag and drop images** onto the canvas to place them; click-and-drag to move. Right-click or click on an image only selects it (no edit).
- **Canvas chat** (bottom-left **◇** button): Opens a proactive assistant that knows your entries as "trenches" (each entry) and "data points" (sub-entries). It uses (x,y) proximity and content (text, movies, songs, links) to offer observations and connections. Sign in required.

After committing, your text melts into the page, then disappears and reappears in a graph layout based on semantic relationships determined by the LLM.

## Project Structure

```
canvas/
├── api/                    # Vercel serverless functions (deployment)
│   ├── index.js            # Main API handler for Vercel
│   ├── db.js               # Database operations
│   └── llm.js              # LLM processing logic
├── server/                 # Local development server
│   ├── index.js            # Express server with API endpoints
│   ├── llm.js              # LLM processing logic
│   ├── chat.js             # Canvas chat functionality
│   └── db.js               # Database operations
├── public/                 # Frontend assets
│   ├── index.html          # Main HTML template
│   ├── styles.css          # Organized stylesheet (with section comments)
│   ├── stats.html          # Statistics dashboard page
│   └── js/                 # Modular JavaScript (loaded in order)
│       ├── 01-state.js     # Global state and DOM references
│       ├── 02-utils.js     # Utility functions
│       ├── 03-camera.js    # Camera/viewport transformations
│       ├── 04-auth.js      # Authentication UI
│       ├── 05-entries.js   # Entry persistence (CRUD)
│       ├── 06-navigation.js # Navigation and breadcrumb
│       ├── 07-cursor.js    # Cursor positioning
│       ├── 08-editor.js    # Editor operations
│       ├── 09-meltify.js   # Ink-bleed animation
│       ├── 10-links.js     # Link card generation
│       ├── 11-media.js     # Media card creation
│       ├── 12-autocomplete.js # Media search autocomplete
│       ├── 13-images.js    # Image upload handling
│       ├── 14-hub.js       # LLM hub organization
│       ├── 15-chat.js      # Chat panel functionality
│       ├── 16-spaces.js    # User spaces management
│       ├── 17-selection.js # Entry selection and undo
│       ├── 18-events.js    # Event handlers
│       └── 19-init.js      # Application initialization
├── package.json            # Dependencies and scripts
├── vercel.json             # Vercel routing configuration
├── .env                    # Environment variables (not in git)
└── README.md               # This file
```

### Architecture Notes

- **api/ vs server/**: The `api/` directory contains Vercel serverless functions used in production deployment. The `server/` directory is used for local development. Both implement the same API but with slight differences for their respective environments.
- **Modular Frontend**: The frontend JavaScript is split into 19 logical modules loaded in dependency order. Each module focuses on a specific feature area for maintainability.
- **CSS Organization**: The stylesheet includes section headers for easy navigation (Variables, Base, Viewport, Entries, Editor, Animations, etc.).

## Deployment to Vercel

### Prerequisites
1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. A GitHub repository with your code
3. An OpenAI API key

### Steps

1. **Install Vercel CLI** (optional, for local deployment):
   ```bash
   npm i -g vercel
   ```

2. **Create a Vercel Postgres Database**:
   - Go to your Vercel dashboard
   - Navigate to your project → Storage → Create Database
   - Select "Postgres" and create a new database
   - Note the connection string (you'll need this)

3. **Deploy to Vercel**:
   ```bash
   vercel
   ```
   Or connect your GitHub repository directly in the Vercel dashboard.

4. **Set Environment Variables**:
   In your Vercel project settings, add these environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `POSTGRES_URL`: Your Vercel Postgres connection string (automatically set if using Vercel Postgres)
   - `POSTGRES_PRISMA_URL`: Same as POSTGRES_URL (for compatibility)
   - `POSTGRES_URL_NON_POOLING`: Same as POSTGRES_URL (for migrations)

5. **Deploy**:
   - If using CLI: `vercel --prod`
   - If using GitHub: Push to your main branch (auto-deploys)

The database will be automatically initialized on first deployment. All entries will be persisted and synced across all sessions.

### Local Development with Database

For local development, you can use the Vercel Postgres connection string in your `.env` file:
```
OPENAI_API_KEY=your_openai_api_key_here
POSTGRES_URL=your_vercel_postgres_connection_string
PORT=3000
```

## Feature Branch Development Workflow

This project is configured to use Vercel's automatic preview deployments for feature branches. This allows you to test experimental features in an isolated environment before merging to production.

### How It Works

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes and commit**:
   ```bash
   git add .
   git commit -m "Add my new feature"
   ```

3. **Push to GitHub**:
   ```bash
   git push origin feature/my-new-feature
   ```

4. **Vercel automatically deploys**:
   - Every branch gets a unique preview URL: `canvas-git-feature-my-new-feature-{org}.vercel.app`
   - Uses the same environment variables as production (same Supabase database)
   - You can test with real data and experimental features

5. **Test your changes**:
   - Visit `/login` to test the authentication flow
   - After login, you're redirected to `/home` which takes you to your canvas
   - All changes are isolated to the preview deployment

6. **Merge to production when ready**:
   ```bash
   git checkout master
   git merge feature/my-new-feature
   git push origin master
   ```

### New Routes for Testing (Preview Deployments Only)

**Important**: These routes are ONLY available on preview deployments (feature branches) and local development. They are automatically disabled in production to keep the main deployment clean.

- `/login` - Explicit login page (redirects to `/home` if already authenticated)
- `/home` - Authenticated-only route that redirects to your `/{username}` canvas page

These routes make it easy to test the full authentication flow on feature branches without affecting production.

## Notes

- The API key is stored server-side for security
- Authentication uses a phone number + one-time code flow. Codes are logged to the server console by default; you can wire this up to an SMS provider using the same codes.
- Each account has its own set of entries (stored with a `user_id`), so data is separated between users.
- Text processing uses OpenAI's GPT-4o-mini model
- Cards are positioned using a graph-based algorithm that considers semantic relationships
- All entries are stored in Vercel Postgres and persist across sessions