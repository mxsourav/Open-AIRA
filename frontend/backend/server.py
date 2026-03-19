from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import re
import uuid
import requests

app = Flask(__name__)
CORS(app)

API_KEY = "AIzaSyC1IFECjeKr8tMNdB5byaIcT7xHo-aJ1as"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
REQUEST_TIMEOUT = 30

sessions = {}

device_state = {
    "mode": "idle",
    "status": 0,
    "message": "Ready",
    "attempt": 0,
    "score": 0
}

HELP_MESSAGE = (
    "How to use CodeSentinel: paste broken code, press Run, use Send Thought for your guess, "
    "use Next Hint for another clue, or switch to Fix mode for direct correction. Commands: /help, clear, clr"
)
DONE_MESSAGE = "Yoo Thats My Boy You Did It"
FOUND_MESSAGE = "Good Job you found the bug now try to debug it."
COMMAND_ALIASES = {
    "clear": "clear",
    "clr": "clear",
    "/help": "help"
}

CODE_PATTERNS = [
    r"\bdef\b", r"\bclass\b", r"\bfunction\b", r"\breturn\b",
    r"\bif\b", r"\belse\b", r"\bfor\b", r"\bwhile\b",
    r"\bprint\s*\(", r"console\.log\s*\(", r"#include",
    r"public\s+static\s+void", r"=>", r"\{", r"\}", r";"
]

GENERATION_PATTERNS = [
    r"\b(write|generate|make|create|build|develop|implement|give)\b.*\b(code|program|script|snippet|function|app|website|project)\b",
    r"\b(code|program|script|snippet|function)\b.*\bfor\b",
    r"\b(c|python|java|javascript|js|html|css|cpp|c\+\+)\s+code\b",
    r"\bmake\s+me\b.*\b(code|program|script)\b",
    r"\bcan\s+you\s+(write|create|make|build|generate)\b"
]


def normalize_command(text):
    stripped = (text or "").strip().lower()
    return COMMAND_ALIASES.get(stripped)


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
    return any(re.search(pattern, stripped, re.IGNORECASE) for pattern in GENERATION_PATTERNS)


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

    response = requests.post(GEMINI_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
    result = response.json()

    if response.status_code != 200:
        message = result.get("error", {}).get("message", "Gemini API request failed")
        raise RuntimeError(message)

    try:
        return result["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("Gemini returned an unexpected response")


def parse_json_response(raw_text):
    cleaned = (raw_text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        cleaned = match.group(0)

    return json.loads(cleaned)


def evaluate_thought(code, thought):
    prompt = f"""
You are evaluating a student's debugging thought.

Broken code:
{code}

Student thought:
{thought}

Return ONLY valid JSON in this exact shape:
{{
  "bug_found": true or false,
  "fixed_code_provided": true or false,
  "reply": "short easy-English reply to the student"
}}

Rules:
- bug_found is true only if the student correctly identified the actual bug.
- fixed_code_provided is true only if the student has provided a corrected version of the code that fixes the main issue.
- If bug_found is true but fixed_code_provided is false, set reply to: "{FOUND_MESSAGE}"
- If fixed_code_provided is true, set reply to: "{DONE_MESSAGE}"
- If both are false, reply in very easy English and guide the student a little.
- Do not include markdown fences.
"""

    data = parse_json_response(call_gemini(prompt))
    return {
        "bug_found": bool(data.get("bug_found")),
        "fixed_code_provided": bool(data.get("fixed_code_provided")),
        "reply": str(data.get("reply", "")).strip() or "Keep going."
    }


def coach_after_bug_found(code, thought):
    prompt = f"""
You are CodeSentinel, a friendly debugging coach.

The student has already found the main bug in this broken code:
{code}

Now the student sent this next attempt:
{thought}

Reply in very easy English.
Do not repeat the sentence "{FOUND_MESSAGE}"
Do not say the exact same thing again.
If the student only gave part of the fix, tell them what is still missing in a short helpful way.
If they are close, say that clearly.
Keep it to 1 or 2 short sentences.
"""
    return call_gemini(prompt)


@app.route("/debug", methods=["POST"])
def debug_code():
    data = request.get_json() or {}
    code = data.get("code", "")
    mode = data.get("mode", "debug")

    if not code.strip():
        return jsonify({"error": "No code provided"}), 400

    command = normalize_command(code)
    if command == "clear":
        return jsonify({"command": "clear", "message": "CLEAR_COMMAND"})

    if command == "help":
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
            return jsonify({
                "mode": "fix",
                "message": call_gemini(prompt)
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "code": code,
        "mode": mode,
        "thought": "",
        "hint_step": 0,
        "bug_found": False
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
        return jsonify({
            "session_id": session_id,
            "message": call_gemini(prompt)
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

    try:
        evaluation = evaluate_thought(session["code"], thought)

        if evaluation["fixed_code_provided"]:
            sessions.pop(session_id, None)
            return jsonify({"message": DONE_MESSAGE, "done": True})

        if evaluation["bug_found"] and not session.get("bug_found"):
            session["bug_found"] = True
            return jsonify({"message": FOUND_MESSAGE, "bug_found": True})

        if session.get("bug_found"):
            return jsonify({
                "message": coach_after_bug_found(session["code"], thought),
                "bug_found": True
            })

        return jsonify({
            "message": evaluation["reply"],
            "bug_found": evaluation["bug_found"]
        })
    except Exception:
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
            return jsonify({"message": call_gemini(prompt), "bug_found": False})
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
        return jsonify({
            "message": call_gemini(prompt),
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

    return jsonify({"message": DONE_MESSAGE})


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
