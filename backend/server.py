from flask import Flask, request, jsonify
from flask_cors import CORS
import re
import uuid
import requests

app = Flask(__name__)
CORS(app)

API_KEY = "AIzaSyC1IFECjeKr8tMNdB5byaIcT7xHo-aJ1as"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

sessions = {}

device_state = {
    "mode": "idle",
    "status": 0,
    "message": "Ready",
    "attempt": 0,
    "score": 0
}


CODE_PATTERNS = [
    r"\bdef\b", r"\bclass\b", r"\bfunction\b", r"\breturn\b",
    r"\bif\b", r"\belse\b", r"\bfor\b", r"\bwhile\b",
    r"\bprint\s*\(", r"console\.log\s*\(", r"#include",
    r"public\s+static\s+void", r"=>", r"\{", r"\}", r";"
]

GENERATION_PATTERNS = [
    r"\bwrite\b.*\bcode\b",
    r"\bgenerate\b.*\bcode\b",
    r"\bmake\b.*\bcode\b",
    r"\bcreate\b.*\bcode\b",
    r"\bgive\b.*\bcode\b",
    r"\bbuild\b.*\bcode\b",
    r"\bcode\b.*\bfor\b",
    r"\bprogram\b.*\bfor\b",
    r"\bc\s+code\b",
    r"\bpython\s+code\b",
    r"\bjava\s+code\b",
    r"\bjavascript\s+code\b"
]


HELP_MESSAGE = "How to use CodeSentinel: paste broken code, press Run, use Send Thought for your guess, use Next Hint for another clue, or switch to Fix mode for direct correction. Commands: /help, clear, clr"


def looks_like_code(text):
    if not text or not text.strip():
        return False

    stripped = text.strip()

    if "\n" in stripped:
        return True

    if any(ch in stripped for ch in ["{", "}", ";", "(", ")", "=", "[", "]"]):
        return True

    for pattern in CODE_PATTERNS:
        if re.search(pattern, stripped, re.IGNORECASE):
            return True

    words = stripped.split()
    if len(words) <= 6 and stripped.endswith((":", ";", "}", ")")):
        return True

    return False


def looks_like_code_generation_request(text):
    if not text or not text.strip():
        return False

    stripped = text.strip().lower()

    for pattern in GENERATION_PATTERNS:
        if re.search(pattern, stripped, re.IGNORECASE):
            return True

    return False


def call_gemini(prompt):
    if not API_KEY:
        raise RuntimeError("API key is not set")

    headers = {
        "x-goog-api-key": API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ]
    }

    response = requests.post(GEMINI_URL, headers=headers, json=payload, timeout=30)
    result = response.json()

    if response.status_code != 200:
        message = result.get("error", {}).get("message", "Gemini API request failed")
        raise RuntimeError(message)

    return result["candidates"][0]["content"]["parts"][0]["text"].strip()


@app.route("/debug", methods=["POST"])
def debug_code():
    data = request.get_json() or {}
    code = data.get("code", "")
    mode = data.get("mode", "debug")

    if not code.strip():
        return jsonify({"error": "No code provided"}), 400

    command = code.strip().lower()
    if command in {"clear", "clr"}:
        return jsonify({"command": "clear", "message": "CLEAR_COMMAND"})

    if command == "/help":
        return jsonify({"command": "help", "message": HELP_MESSAGE})

    if looks_like_code_generation_request(code):
        return jsonify({
            "error": "Nah bro, I am not your instant code vending machine. I am here to help roast bugs, not generate homework from vibes. Paste broken code and let's cook the error."
        }), 400

    if not looks_like_code(code):
        return jsonify({
            "error": "That does not look like code. Paste a code snippet or bug example first."
        }), 400

    if mode == "fix":
        prompt = f"""
You are CodeSentinel, a helpful coding assistant.

Fix this code:
{code}

Rules:
- Return the corrected code first.
- Then give a very short explanation in easy English.
- Keep the answer simple and direct.
"""

        try:
            message = call_gemini(prompt)
            return jsonify({
                "mode": "fix",
                "message": message
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "code": code,
        "mode": mode,
        "thought": "",
        "hint_step": 0
    }

    prompt = f"""
You are CodeSentinel, a friendly debugging coach.

The user is in {mode} mode.
Here is the code:
{code}

Do not solve the bug yet.
Ask the student where they think the problem is.
Use very easy English.
Keep it to 1 or 2 short sentences.
Sound encouraging.
"""

    try:
        message = call_gemini(prompt)
        return jsonify({
            "session_id": session_id,
            "message": message
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/submit-thought", methods=["POST"])
def submit_thought():
    data = request.get_json() or {}
    session_id = data.get("session_id", "")
    thought = data.get("thought", "").strip()

    session = sessions.get(session_id)
    if not session:
        return jsonify({"error": "Session not found. Run the code again."}), 404

    if not thought:
        return jsonify({"error": "Write what you think first."}), 400

    session["thought"] = thought

    prompt = f"""
You are CodeSentinel, a friendly debugging coach.

The student is trying to debug this code:
{session['code']}

The student thinks the issue might be here:
{thought}

Reply in very easy English.
Do not confirm the full answer yet.
Do not give the final fix.
In 1 or 2 short sentences:
1. Encourage the student.
2. Say whether they should keep checking that area or look a little earlier/later.
"""

    try:
        message = call_gemini(prompt)
        return jsonify({"message": message})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/hint", methods=["POST"])
def next_hint():
    data = request.get_json() or {}
    session_id = data.get("session_id", "")

    session = sessions.get(session_id)
    if not session:
        return jsonify({"error": "Session not found. Run the code again."}), 404

    session["hint_step"] += 1
    hint_step = session["hint_step"]
    thought = session.get("thought", "") or "The student has not shared a guess yet."

    prompt = f"""
You are CodeSentinel, a friendly debugging coach.

The student is debugging this code:
{session['code']}

The student's current guess is:
{thought}

Give hint number {hint_step}.
Rules:
- Use very easy English.
- Keep it short.
- Do not sound technical unless needed.
- Give only one hint.
- Do not dump the full solution too early.
- Hint 1: only point to the general area.
- Hint 2: point closer to the exact line or mistake.
- Hint 3: explain the exact thing to check.
- Hint 4 or later: you may clearly say what is wrong and what to change.
"""

    try:
        message = call_gemini(prompt)
        return jsonify({
            "message": message,
            "hint_step": hint_step
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/done", methods=["POST"])
def mark_done():
    data = request.get_json() or {}
    session_id = data.get("session_id", "")

    if session_id in sessions:
        sessions.pop(session_id, None)

    return jsonify({"message": "Yoo Thats My Boy You Did It"})


@app.route("/device-status", methods=["GET"])
def get_status():
    return jsonify(device_state)


@app.route("/update", methods=["POST"])
def update_status():
    global device_state
    data = request.get_json() or {}
    device_state.update(data)
    return jsonify({"success": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
