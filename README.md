# Authently

Authently is a desktop assistant for spotting potentially misleading content while you browse. It combines a lightweight Electron overlay with a FastAPI backend, using Fishjam for live audio transport and Gemini for article and spoken-claim analysis.

This repository was built in a hackathon context, so the project is intentionally focused: it aims to demonstrate a strong end-to-end concept, not a finished production product.

## What it does

- Detects the frontmost app and active browser tab.
- Classifies the current context into `idle`, `news`, or `video`.
- For supported news pages, sends the article URL to the backend for AI-assisted credibility and manipulation analysis.
- Highlights potentially provocative text fragments directly in the page.
- For video mode, creates a live session, streams captured system audio through Fishjam, transcribes it with Gemini Live, and returns fast fact-check style verdicts to the overlay.
- Runs as a compact desktop overlay with tray controls instead of a traditional full-window app.

## Why this matters

The idea behind Authently is simple: misinformation often wins because checking claims takes more effort than consuming them. Authently tries to shorten that gap by bringing analysis closer to the moment of consumption, whether the user is reading an article or listening to live commentary.

For hackathon evaluation, the value of the project is in the integration:

- Desktop context awareness
- Real-time overlay UX
- Browser-page augmentation
- LLM-based article analysis
- Live audio transcription and claim classification

## Architecture

### Frontend

The frontend lives in [`frontend`](./frontend) and is an Electron + React application.

- `Electron main process`: detects the frontmost app, reads browser tab metadata, manages permissions, controls the tray, and forwards events to the renderer.
- `React renderer`: displays the overlay UI, article analysis, and live verdict stream.
- `Fishjam client integration`: publishes captured system audio to a room for live processing.

Notable frontend characteristics:

- Vite-based renderer build
- Transparent always-on-top overlay window
- macOS-first system audio capture flow, with fallback guidance for virtual audio devices such as BlackHole
- Browser support in code for macOS: Chrome, Safari, Arc, Brave
- Browser support in code for Windows: Chrome, Edge, Brave

### Backend

The backend lives in [`backend`](./backend) and is a FastAPI service.

- `POST /check-article`: analyzes supported article URLs and returns credibility and manipulation signals
- `POST /check-video`: analyzes supported video URLs
- `POST /create-session`: creates a Fishjam room and peer token for live analysis
- `GET /ws/analysis/{session_id}`: streams live analysis messages back to the app
- `GET /health`: simple health check

Backend integrations:

- `Gemini`: article analysis, title evaluation, live transcript chunk analysis
- `Fishjam`: room creation, agent connection, real-time audio ingestion
- `Custom parsers`: article and video metadata extraction for supported sources

## Current scope

This is the honest current implementation based on the code in the repo:

- News/article analysis is implemented for `bbc.com` and `cnbc.com`.
- Video source analysis is implemented for YouTube URLs.
- Domain classification includes more sites than the parsers currently support, so detection is broader than full analysis coverage.
- Live audio analysis is implemented through a Fishjam + Gemini pipeline.
- The frontend currently contains hardcoded `ngrok` backend URLs for session creation, article checks, and WebSocket analysis.
- The local backend can be run independently, but the frontend will only talk to it after those endpoint constants are updated.

## Tech stack

- Frontend: Electron, React, TypeScript, Vite
- Backend: Python, FastAPI, Pydantic
- AI: Google Gemini and Gemini Live
- Realtime media: Fishjam

## Repository structure

```text
.
├── backend
│   ├── src/api
│   ├── src/parsers
│   ├── src/services
│   └── requirements.txt
└── frontend
    ├── src/main
    ├── src/renderer
    ├── package.json
    └── vite.config.ts
```

## Local setup

### Prerequisites

- Node.js 18+
- npm
- Python 3.11+
- A Fishjam project with:
  - `FISHJAM_ID`
  - `FISHJAM_MANAGEMENT_TOKEN`
- A Google AI API key for Gemini

For the live video flow on macOS, system audio capture may also require:

- Screen Recording permission
- Microphone permission
- A virtual audio device such as BlackHole, Loopback, Soundflower, or Background Music if native system-audio capture is unavailable

### 1. Backend

Create [`backend/.env`](./backend/.env) based on [`backend/.env.example`](./backend/.env.example):

```env
FISHJAM_ID=your_fishjam_id
FISHJAM_MANAGEMENT_TOKEN=your_management_token
GOOGLE_API_KEY=your_google_api_key
GEMINI_MODEL=gemini-live-2.5-flash-preview
```

Install and run:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

Create [`frontend/.env`](./frontend/.env) based on [`frontend/.env.example`](./frontend/.env.example):

```env
VITE_FISHJAM_ID=your_fishjam_id
```

Install and run:

```bash
cd frontend
npm install
npm run dev
```

## Running the full project locally

To run the repo fully on your machine, there is one important implementation detail:

- The frontend currently points to a hardcoded remote `ngrok` backend.
- If you want the desktop app to use your local FastAPI server, update the backend base URLs in:
  - [`frontend/src/main/index.ts`](./frontend/src/main/index.ts)
  - [`frontend/src/main/services/backend-client.ts`](./frontend/src/main/services/backend-client.ts)
  - [`frontend/src/renderer/services/analysis-ws.ts`](./frontend/src/renderer/services/analysis-ws.ts)
  - [`frontend/src/renderer/services/session-api.ts`](./frontend/src/renderer/services/session-api.ts)

## Evaluation notes

If this project is being reviewed in a hackathon setting, the most important thing to know is that Authently already demonstrates the complete product loop:

1. Detect user context
2. Decide whether the content is news or video
3. Send the relevant signal to an analysis pipeline
4. Return feedback in an always-available overlay
5. Augment the browsing experience with inline cues

What is still limited is source coverage, hardening, and configuration polish, not the core concept itself.

## Known limitations

- The frontend is currently coupled to a specific remote backend URL.
- News parsing support is narrower than the domain-classification list.
- Video title analysis and live spoken-claim analysis are separate flows and are not yet unified into one review model.
- There is no automated test suite in this repo yet.
- Packaging and platform behavior are more mature for macOS than for Linux.

## Next steps

- Replace hardcoded backend URLs with environment-based configuration
- Expand parser support for more publishers and video platforms
- Add structured logging and better failure states in the UI
- Add tests for parsers, API routes, and critical frontend services
- Improve onboarding for permissions and audio routing

## Pitch summary

Authently is a hackathon prototype for real-time misinformation assistance. It does not claim to be a final truth engine, but it already shows a credible product direction: context-aware detection, fast AI-assisted analysis, and a UI that appears exactly where the user needs it.
