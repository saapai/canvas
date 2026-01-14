# Canvas Diary

An infinite canvas diary page with graph-based semantic organization. Type anywhere on the page, and your entries are processed by an LLM to organize them in a meaningful graph layout.

## Features

- **Infinite Canvas**: Pan and zoom infinitely
- **Click-to-Type**: Click anywhere to start typing
- **Ink Bleed Animation**: Text melts into the page with an ink-bleed effect
- **Graph-Based Organization**: Entries are processed by LLM and positioned based on semantic relationships
- **Sketchbook Aesthetic**: Paper-like background with subtle textures

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env` file in the root directory:
```
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

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

After committing, your text melts into the page, then disappears and reappears in a graph layout based on semantic relationships determined by the LLM.

## Project Structure

```
canvas/
├── server/
│   ├── index.js      # Express server
│   └── llm.js        # LLM processing logic
├── public/
│   ├── index.html    # Main HTML
│   ├── styles.css    # Styles
│   └── app.js        # Frontend JavaScript
├── package.json      # Dependencies
├── .env              # Environment variables (not in git)
└── README.md         # This file
```

## Notes

- The API key is stored server-side for security
- Text processing uses OpenAI's GPT-4o-mini model
- Cards are positioned using a graph-based algorithm that considers semantic relationships