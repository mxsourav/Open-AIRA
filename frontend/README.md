# CodeSentinel

User Interface For Portable AI-Powered Debugging.

## Overview

CodeSentinel is a portable AI-powered debugging interface with a futuristic web UI and a lightweight Flask backend. It is designed to help users paste code, get AI-assisted debugging feedback, and learn through guided responses instead of only receiving direct fixes.

## Features

- Clean debugging dashboard with a Nothing-inspired visual style
- Dark and light theme switching
- Animated status text in the hero section
- Code input panel with response output area
- Debug and Fix mode controls
- Flask backend API for AI-powered debugging responses
- Device status endpoints prepared for future ESP32 integration
- Responsive frontend layout for desktop and smaller screens

## Tech Stack

- HTML5
- CSS3
- JavaScript
- Python
- Flask
- Gemini API

## Project Structure

```text
CodeSentinel/
|-- assets/
|-- backend/
|   `-- server.py
|-- frontend/
|   |-- index.html
|   |-- style.css
|   `-- app.js
`-- README.md
```

## How It Works

The frontend provides the interface where users can paste code and choose a debugging mode. When `Run` is clicked, the frontend sends the code to the Flask backend at `http://127.0.0.1:5000/debug`. The backend forwards the prompt to the Gemini API and returns the AI response back to the UI.

## Setup

### 1. Clone the repository

```bash
git clone <your-repo-link>
cd CodeSentinel
```

### 2. Install backend dependencies

```bash
pip install flask requests
```

### 3. Set your Gemini API key

On Windows PowerShell:

```powershell
$env:GEMINI_API_KEY="your_api_key_here"
```

### 4. Run the backend

```bash
cd backend
python server.py
```

The backend will start on:

```text
http://127.0.0.1:5000
```

### 5. Open the frontend

Open `frontend/index.html` in your browser.

## API Endpoints

### `POST /debug`

Sends code to the AI debugging trainer and returns the generated response.

### `GET /device-status`

Returns the current device state.

### `POST /update`

Updates the in-memory device state for future hardware integration.

## Usage

- Open the frontend in your browser.
- Paste your code into the input panel.
- Click `Run` to send the code to the backend.
- Read the returned AI debugging response in the response panel.
- Use `Debug` or `Fix` mode depending on your workflow.
- Toggle the theme using the settings button in the navbar.

## Vision

CodeSentinel is built to make debugging feel interactive, guided, and approachable. The aim is to create a portable AI-powered debugging experience that encourages problem solving and active learning instead of passive copy-paste fixing.

## Author

Built by Sourav.
