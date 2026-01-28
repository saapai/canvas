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
```

**API Keys:**
- **TMDB_API_KEY**: Get a free API key from [themoviedb.org](https://www.themoviedb.org/settings/api) for movie search
- **Spotify credentials**: Get from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) for song search (optional)
- **Twilio**: Required for phone-based authentication

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
- **Canvas chat** (bottom-left **◇** button): Opens a proactive assistant that knows your entries as "trenches" (each entry) and "data points" (sub-entries). It uses (x,y) proximity and content (text, movies, songs, links) to offer observations and connections. Sign in required.

After committing, your text melts into the page, then disappears and reappears in a graph layout based on semantic relationships determined by the LLM.

## Project Structure

```
canvas/
├── server/
│   ├── index.js      # Express server with API endpoints
│   ├── llm.js        # LLM processing logic
│   ├── chat.js       # Canvas chat (trenches + proactive bot)
│   └── db.js         # Database operations
├── public/
│   ├── index.html    # Main HTML
│   ├── styles.css    # Styles
│   └── app.js        # Frontend JavaScript with persistence
├── package.json      # Dependencies
├── vercel.json       # Vercel configuration
├── .env              # Environment variables (not in git)
└── README.md         # This file
```

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