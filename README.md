# CodeSentinel

Portable AI-powered debugging trainer with guided coaching, direct fix mode, and progress tracking.

## Overview

CodeSentinel is a browser-first debugging trainer built to help users think through bugs instead of jumping straight to the final answer. It has two main workflows:

- `Debug` mode: guided coaching with thoughts, hints, progress tracking, and stats
- `Fix` mode: corrected code plus a separate change log

The current beta architecture is:

- static frontend on Vercel
- Flask backend on Render or Railway
- private beta-access gate before API registration unlocks
- each user brings their own supported AI provider API key
- the key is stored only in that user's browser session
- the backend does not store one shared key for everyone

## Key Features

- Guided debugging flow with `Send Thought`, `Next Hint`, and `I Did It`
- Direct fix mode with syntax-highlighted corrected code
- Separate change-log output in fix mode
- Progress bar with red, yellow, and green stages
- Stats tracking for debug runs, thoughts, hints, wrong turns, bug reads, and best progress
- Private beta-access gate with invite keys and a master bypass key
- Multi-provider API support: Gemini, OpenAI, Grok, Claude, and DeepSeek
- Separate `/admin` dashboard for live key status, key toggles, and session termination
- API registration gate before the app unlocks
- `/help`, `clear`, and `clr` commands
- Dark and light theme support
- Portable static frontend + lightweight Flask backend

## Privacy Model

CodeSentinel now uses a safer per-user API flow:

- invited users unlock the beta first with a beta-access key
- every user enters their own API key
- the key is stored in `sessionStorage` in that browser session only
- the key is not stored in the backend
- the key is removed when the user clicks `Remove API Key` or the browser session ends

Important:

- your frontend source is still visible to visitors because it is a web app
- the backend still receives the user's API key in each request so it can talk to the selected AI provider
- the backend no longer keeps one global key or one shared in-memory session for all users

## Tech Stack

- HTML
- CSS
- JavaScript
- Python
- Flask
- Flask-CORS
- Requests
- Gemini API
- OpenAI API
- xAI API
- Anthropic API
- DeepSeek API
- Vercel
- Render or Railway

## Project Structure

```text
CodeSentinel/
|-- assets/
|-- backend/
|   `-- server.py
|-- frontend/
|   |-- app.js
|   |-- config.js
|   |-- index.html
|   |-- style.css
|   `-- vercel.json
|-- Procfile
|-- railway.json
|-- render.yaml
|-- requirements.txt
`-- README.md
```

## Local Setup

### 1. Install dependencies

From the repo root:

```powershell
pip install -r requirements.txt
```

### 2. Run the backend

```powershell
cd backend
python server.py
```

Backend default:

```text
http://127.0.0.1:5000
```

### 3. Run the frontend

Open a second terminal:

```powershell
cd frontend
python -m http.server 5500
```

Frontend default:

```text
http://127.0.0.1:5500
```

### 4. Use the app

1. Open the frontend URL
2. Enter a valid beta-access key
3. Choose a provider in `API Registration`
4. Enter your own provider API key
5. Click `Submit API Key`
6. Choose `Debug` or `Fix`
7. Start using CodeSentinel

## How Debug Mode Works

1. Paste broken code
2. Click `Run`
3. CodeSentinel asks where you think the problem is
4. Use `Send Thought` to submit your guess
5. Use `Next Hint` when needed
6. Watch stats and progress change as you move closer or farther from the fix
7. Finish with `I Did It` or by submitting the correct fix

## How Fix Mode Works

1. Switch to `Fix`
2. Paste code
3. Click `Run`
4. Read the corrected code in the fixed-code card
5. Read the AI change summary in the change-log card
6. Use the copy icon to copy only the corrected code

## Deployment

## Backend on Render

This repo already includes:

- [render.yaml](./render.yaml)
- [Procfile](./Procfile)
- [requirements.txt](./requirements.txt)

Recommended Render setup:

1. Create a new `Web Service`
2. Connect your private GitHub repo
3. Keep the root directory as the repo root
4. Render should use:
   - build command: `pip install -r requirements.txt`
   - start command: `gunicorn --chdir backend server:app`
5. Deploy

Default health endpoint:

```text
/api-key-status
```

## Backend on Railway

This repo also includes:

- [railway.json](./railway.json)

Recommended Railway setup:

1. Create a new project from GitHub
2. Use the repo root
3. Railway will use:
   - start command: `gunicorn --chdir backend server:app`

## Frontend on Vercel

Frontend deploy target:

- set Vercel Root Directory to `frontend`

The frontend folder already includes:

- [frontend/vercel.json](./frontend/vercel.json)

That file adds:

- cleaner URLs
- basic security headers
- `no-store` caching for `config.js`

### Production API URL

Frontend API config lives in:

- [frontend/config.js](./frontend/config.js)

Local behavior:

- `localhost` or `127.0.0.1` -> `http://127.0.0.1:5000`

Production default:

- `https://codesentinel-api.onrender.com`

If your real backend URL is different, update this line in [frontend/config.js](./frontend/config.js).

## Why This Launch Model Is Better

Old risk:

- one user could overwrite the API key for everyone
- one user could remove the API key for everyone
- in-memory server sessions were weak for multi-user hosting

Current model:

- private beta keys gate access before API registration
- each user uses their own API key
- the key stays in that browser session only
- requests are stateless
- the backend does not depend on a shared session dictionary for user progress

## Commands

- `/help`
- `clear`
- `clr`

## Current Limitations

- the backend still sees the user API key in each request because it must forward prompts to the selected provider
- frontend code is public to browser users even if the GitHub repo is private
- long-term secure account-based key management is not implemented yet
- beta invite-key claims depend on backend storage persistence across redeploys/restarts
- fix quality still depends on the selected provider response quality

## Author

Built by Sourav.
