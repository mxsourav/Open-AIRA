from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import re
import uuid
import requests

app = Flask(__name__)
CORS(app)

API_KEY = ""
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
ALREADY_CLEAN_MESSAGE = "Yo this code is already clean, no bug drama here. You cooked fine."
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


@app.route("/api-key-status", methods=["GET"])
def api_key_status():
    return jsonify({"configured": bool(API_KEY)})


@app.route("/api-key", methods=["POST"])
def set_api_key():
    global API_KEY
    data = request.get_json() or {}
    api_key = str(data.get("api_key", "")).strip()

    if not api_key:
        return jsonify({"error": "API key is required."}), 400

    API_KEY = api_key
    return jsonify({"success": True, "message": "API key accepted. CodeSentinel is unlocked."})


@app.route("/api-key", methods=["DELETE"])
def clear_api_key():
    global API_KEY
    API_KEY = ""
    return jsonify({"success": True, "message": "API key removed. Submit a new key to start again."})


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


def call_gemini(prompt, response_mime_type=None):
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
    if response_mime_type:
        payload["generationConfig"] = {
            "responseMimeType": response_mime_type
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


def extract_fenced_code(raw_text):
    match = re.search(r"```[a-zA-Z0-9_+-]*\n([\s\S]*?)```", raw_text or "")
    if match:
        return match.group(1).strip()
    return ""


def parse_fix_result_fallback(raw_text):
    text = (raw_text or "").strip()
    fixed_code = ""
    change_log = []

    try:
        data = parse_json_response(text)
        fixed_code = str(data.get("fixed_code", "")).strip()
        raw_changes = data.get("change_log", [])
        if isinstance(raw_changes, list):
            change_log = [str(item).strip() for item in raw_changes if str(item).strip()]
        elif raw_changes:
            change_log = [line.strip().lstrip("-* ").strip() for line in str(raw_changes).splitlines() if line.strip()]
    except Exception:
        fixed_code = extract_fenced_code(text)

        if not fixed_code:
            markers = [
                "Fixed code:",
                "Corrected code:",
                "Here is the fixed code:",
                "fixed_code:"
            ]
            for marker in markers:
                if marker.lower() in text.lower():
                    start = text.lower().find(marker.lower()) + len(marker)
                    fixed_code = text[start:].strip()
                    break

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        bullet_lines = [
            line.lstrip("-* ").strip()
            for line in lines
            if line.startswith(("-", "*")) or re.match(r"^\d+\.", line)
        ]
        change_log = [line for line in bullet_lines if line]

    if not change_log:
        change_log = [
            "Fixed the main code issue.",
            "Cleaned the broken part so the code can run."
        ]

    return {
        "fixed_code": fixed_code.strip(),
        "change_log": change_log[:6]
    }


def extract_fixed_code_text(raw_text):
    text = (raw_text or "").strip()
    if not text:
        return ""

    fenced = extract_fenced_code(text)
    if fenced:
        return fenced

    markers = [
        "Fixed code:",
        "Corrected code:",
        "Here is the fixed code:",
        "fixed_code:"
    ]
    for marker in markers:
        if marker.lower() in text.lower():
            start = text.lower().find(marker.lower()) + len(marker)
            return text[start:].strip()

    return text


def parse_change_log_text(raw_text):
    text = (raw_text or "").strip()
    if not text:
        return [
            "Fixed the main code issue.",
            "Cleaned the broken part so the code can run."
        ]

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    bullets = []

    for line in lines:
        cleaned = re.sub(r"^[-*]\s*", "", line)
        cleaned = re.sub(r"^\d+\.\s*", "", cleaned)
        if cleaned:
            bullets.append(cleaned)

    if not bullets:
        bullets = [text]

    return bullets[:6]


def build_fix_result(code):
    code_prompt = f"""
You are CodeSentinel, a coding assistant.

Fix this code and return ONLY the corrected code.

Code:
{code}

Rules:
- Return only the corrected code.
- Do not explain anything.
- Do not add labels.
- Markdown fences are allowed if needed.
"""

    fixed_code = extract_fixed_code_text(call_gemini(code_prompt))

    if not fixed_code:
        raise RuntimeError("Fix result did not include corrected code")

    change_prompt = f"""
You are CodeSentinel, a coding assistant.

Broken code:
{code}

Fixed code:
{fixed_code}

Give 2 to 5 short change-log points in very easy English.

Rules:
- One fix per line.
- No markdown table.
- Keep each line short.
"""

    change_log = parse_change_log_text(call_gemini(change_prompt))

    return {
        "fixed_code": fixed_code,
        "change_log": change_log[:6]
    }


def check_code_health(code):
    prompt = f"""
You are checking whether code already looks correct.

Code:
{code}

Return ONLY valid JSON in this exact shape:
{{
  "has_bug": true or false,
  "reply": "short reply"
}}

Rules:
- has_bug must be false only when the code already looks correct and does not need debugging.
- If has_bug is false, make the reply chill, gen-z style, and say the code is already fine.
- If has_bug is true, keep the reply short and say the code still has a bug.
- Do not include markdown fences.
"""

    data = parse_json_response(call_gemini(prompt, response_mime_type="application/json"))
    has_bug = bool(data.get("has_bug"))
    reply = str(data.get("reply", "")).strip()

    if has_bug:
        reply = reply or "There is still a bug in this code."
    else:
        reply = reply or ALREADY_CLEAN_MESSAGE

    return {
        "has_bug": has_bug,
        "reply": reply
    }


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
  "thought_state": "correct_bug" or "wrong",
  "reply": "short easy-English reply to the student"
}}

Rules:
- bug_found is true only if the student correctly identified the real main bug.
- fixed_code_provided is true only if the student has provided a corrected version of the code that fixes the main issue.
- thought_state must be "correct_bug" only when the student clearly caught the real bug.
- thought_state must be "wrong" when the student's guess is not the real bug.
- If bug_found is true but fixed_code_provided is false, set reply to: "{FOUND_MESSAGE}"
- If fixed_code_provided is true, set reply to: "{DONE_MESSAGE}"
- If thought_state is "wrong", reply in very easy English and directly say the guess is wrong.
- Keep replies short.
- Do not include markdown fences.
"""

    data = parse_json_response(call_gemini(prompt, response_mime_type="application/json"))
    thought_state = str(data.get("thought_state", "wrong")).strip().lower()
    if thought_state not in {"correct_bug", "wrong"}:
        thought_state = "correct_bug" if bool(data.get("bug_found")) else "wrong"

    return {
        "bug_found": bool(data.get("bug_found")),
        "fixed_code_provided": bool(data.get("fixed_code_provided")),
        "thought_state": thought_state,
        "reply": str(data.get("reply", "")).strip() or "Keep going."
    }


def coach_after_bug_found(code, thought):
    prompt = f"""
You are CodeSentinel, a friendly debugging coach.

The student has already found the main bug in this broken code:
{code}

Now the student sent this next attempt:
{thought}

Return ONLY valid JSON in this exact shape:
{{
  "fixed_code_provided": true or false,
  "thought_state": "close_fix" or "wrong_fix",
  "reply": "short easy-English reply to the student"
}}

Rules:
- fixed_code_provided is true only if the student has now given the corrected code or a clearly correct final fix.
- thought_state is "close_fix" only if the student is moving in the right direction.
- thought_state is "wrong_fix" if the student is still going the wrong way.
- If fixed_code_provided is true, set reply to: "{DONE_MESSAGE}"
- If thought_state is "wrong_fix", directly say the attempt is still wrong in easy English.
- Do not repeat the sentence "{FOUND_MESSAGE}"
- Keep replies to 1 or 2 short sentences.
- Do not include markdown fences.
"""

    data = parse_json_response(call_gemini(prompt, response_mime_type="application/json"))
    thought_state = str(data.get("thought_state", "wrong_fix")).strip().lower()
    if thought_state not in {"close_fix", "wrong_fix"}:
        thought_state = "close_fix"

    return {
        "fixed_code_provided": bool(data.get("fixed_code_provided")),
        "thought_state": thought_state,
        "reply": str(data.get("reply", "")).strip() or "Keep going."
    }


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

    if mode == "debug":
        try:
            health = check_code_health(code)
            if not health["has_bug"]:
                return jsonify({
                    "session_id": "",
                    "message": health["reply"],
                    "already_clean": True
                })
        except Exception:
            pass

    if mode == "fix":
        try:
            fix_result = build_fix_result(code)
            return jsonify({
                "mode": "fix",
                "fixed_code": fix_result["fixed_code"],
                "change_log": fix_result["change_log"]
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
        if session.get("bug_found"):
            follow_up = coach_after_bug_found(session["code"], thought)

            if follow_up["fixed_code_provided"]:
                sessions.pop(session_id, None)
                return jsonify({"message": DONE_MESSAGE, "done": True, "thought_state": "fixed"})

            return jsonify({
                "message": follow_up["reply"],
                "bug_found": True,
                "thought_state": follow_up["thought_state"]
            })

        evaluation = evaluate_thought(session["code"], thought)

        if evaluation["fixed_code_provided"]:
            sessions.pop(session_id, None)
            return jsonify({"message": DONE_MESSAGE, "done": True, "thought_state": "fixed"})

        if evaluation["bug_found"]:
            session["bug_found"] = True
            return jsonify({"message": FOUND_MESSAGE, "bug_found": True, "thought_state": "correct_bug"})

        wrong_reply = evaluation["reply"] or "Wrong catch. That is not the real issue. Look again near the actual error area."
        return jsonify({
            "message": wrong_reply,
            "bug_found": False,
            "thought_state": "wrong"
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
            return jsonify({"message": call_gemini(prompt), "bug_found": False, "thought_state": "wrong"})
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
