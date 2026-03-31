import json
import os

from flask import Flask, jsonify, request
from flask_cors import CORS
import re
import requests

from admin_routes import admin_bp
from key_manager import authenticate_access_key, init_key_store, record_key_provider, verify_access_key

app = Flask(__name__)
CORS(
    app,
    supports_credentials=True,
    origins=[
        re.compile(r"https://.*\.vercel\.app"),
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
)
def get_env(*names, default=""):
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


app.config["SECRET_KEY"] = get_env("OPEN_AIRA_SESSION_SECRET", "CODESENTINEL_SESSION_SECRET", default="open-aira-dev-admin-secret")
is_production = os.getenv("RENDER") is not None or get_env("OPEN_AIRA_ENV", "CODESENTINEL_ENV", default="").lower() == "production"
app.config["SESSION_COOKIE_SAMESITE"] = "None" if is_production else "Lax"
app.config["SESSION_COOKIE_SECURE"] = is_production
init_key_store()
app.register_blueprint(admin_bp)

GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_COUNT_URL = "https://api.anthropic.com/v1/messages/count_tokens"
NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
REQUEST_TIMEOUT = 30
DEMO_API_KEY = get_env("OPEN_AIRA_DEMO_API_KEY", "CODESENTINEL_DEMO_API_KEY")

device_state = {
    "mode": "idle",
    "status": 0,
    "message": "Ready",
    "attempt": 0,
    "score": 0
}

HELP_MESSAGE = (
    "How to use Open AIRA: paste broken code, press Run or Shift + Enter in Input Code, "
    "use Send or Shift + Enter in Thought Input, press normal Enter for a new line, "
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

DEBUG_MODES = {
    "beginner": {
        "initial": (
            "Use beginner coaching style. Break the problem into small steps, ask guiding questions when helpful, "
            "explain mistakes clearly, and encourage the student's own thinking. Do not give the direct final answer "
            "or a full instant fix."
        ),
        "thought": (
            "Use beginner coaching style. Make replies warm, clear, and step-by-step. If the thought is wrong, say "
            "it gently and redirect the student. Do not dump the final answer."
        ),
        "hint": (
            "Use beginner coaching style. Give simple hints, explain what to inspect, and make the clue easy to follow."
        ),
    },
    "intermediate": {
        "initial": (
            "Use intermediate coaching style. Give directional hints, highlight the key problem area, and keep the "
            "reasoning partial. Expect the student to fill in missing steps."
        ),
        "thought": (
            "Use intermediate coaching style. Be more concise than beginner mode, point toward the right area, and "
            "avoid full step-by-step teaching or full solutions."
        ),
        "hint": (
            "Use intermediate coaching style. Give sharper hints with less explanation depth. Keep the clue focused."
        ),
    },
    "pro": {
        "initial": (
            "Use pro coaching style. Be terse, professional, and observation-driven. Point out only critical issues. "
            "No hand-holding, no beginner framing, and no extra explanation unless needed."
        ),
        "thought": (
            "Use pro coaching style. Keep replies short and direct. Confirm or reject the thought with minimal text."
        ),
        "hint": (
            "Use pro coaching style. Give compact debugger-like hints, focused on the critical issue only."
        ),
    },
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

PROVIDERS = {
    "gemini": {
        "label": "Gemini",
        "kind": "gemini",
        "model": "gemini-2.5-flash",
    },
    "openai": {
        "label": "OpenAI",
        "kind": "openai_compatible",
        "base_url": OPENAI_CHAT_URL,
        "validate_url": OPENAI_MODELS_URL,
        "model": "gpt-4.1-mini",
    },
    "xai": {
        "label": "Grok",
        "kind": "openai_compatible",
        "base_url": "https://api.x.ai/v1/chat/completions",
        "validate_url": "https://api.x.ai/v1/models",
        "model": "grok-3",
    },
    "deepseek": {
        "label": "DeepSeek",
        "kind": "openai_compatible",
        "base_url": DEEPSEEK_CHAT_URL,
        "validate_url": None,
        "model": "deepseek-chat",
    },
    "claude": {
        "label": "Claude",
        "kind": "anthropic",
        "model": "claude-sonnet-4-5",
    },
    "demo": {
        "label": "Demo",
        "kind": "openai_compatible",
        "base_url": NVIDIA_CHAT_URL,
        "validate_url": None,
        "model": "tiiuae/falcon3-7b-instruct",
        "uses_server_key": True,
    },
}

INITIAL_DEBUG_MESSAGES = {
    "beginner": (
        "Let's break it down step by step. Read the code once, then tell me which line or area feels suspicious first."
    ),
    "intermediate": (
        "Scan the code and call out the first area that looks broken. Keep your guess specific."
    ),
    "pro": (
        "Point to the first suspicious line or failure point."
    ),
}
def normalize_command(text):
    stripped = (text or "").strip().lower()
    return COMMAND_ALIASES.get(stripped)


def normalize_debug_mode(value):
    raw = str(value or "").strip().lower()
    return raw if raw in DEBUG_MODES else "beginner"


def normalize_provider(value):
    raw = str(value or "").strip().lower()
    return raw if raw in PROVIDERS else "gemini"


def get_provider_details(provider):
    return PROVIDERS[normalize_provider(provider)]


def get_provider_label(provider):
    return get_provider_details(provider)["label"]


def get_mode_instruction(debug_mode, stage):
    selected_mode = normalize_debug_mode(debug_mode)
    return DEBUG_MODES[selected_mode][stage]


def build_initial_debug_message(debug_mode):
    return INITIAL_DEBUG_MESSAGES[normalize_debug_mode(debug_mode)]


def require_beta_access(data):
    return None


def get_api_context(data):
    provider = normalize_provider((data or {}).get("provider"))
    provider_details = get_provider_details(provider)

    if provider_details.get("uses_server_key"):
        if not DEMO_API_KEY:
            raise ValueError("Demo connection is not configured on the server right now.")
        return DEMO_API_KEY, provider

    api_key = str((data or {}).get("api_key", "")).strip()
    if not api_key:
        raise ValueError("API key is required. Enter your own key to unlock Open AIRA.")
    return api_key, provider


def touch_beta_provider(data, provider):
    return None


def normalize_debug_state(raw_state):
    state = raw_state if isinstance(raw_state, dict) else {}

    try:
        hint_step = int(state.get("hint_step", 0))
    except (TypeError, ValueError):
        hint_step = 0

    return {
        "code": str(state.get("code", "")).strip(),
        "hint_step": max(0, hint_step),
        "bug_found": bool(state.get("bug_found", False)),
        "last_thought": str(state.get("last_thought", "")).strip(),
        "debug_mode": normalize_debug_mode(state.get("debug_mode")),
        "provider": normalize_provider(state.get("provider"))
    }


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


def parse_api_error(response):
    try:
        result = response.json()
    except ValueError:
        result = {}

    error = result.get("error", {})

    if isinstance(error, dict):
        message = error.get("message")
        if message:
            return message

    if isinstance(error, str) and error.strip():
        return error

    message = result.get("message")
    if isinstance(message, str) and message.strip():
        return message

    details = result.get("details")
    if isinstance(details, str) and details.strip():
        return details

    return "Provider API request failed"


POSITIVE_THOUGHT_PATTERNS = [
    r"\byou(?:'re| are)? right\b",
    r"\bcorrect\b",
    r"\bgood catch\b",
    r"\bnice catch\b",
    r"\bexactly\b",
    r"\byes[,!\s]",
]


def thought_matches_obvious_bug(code, thought):
    code_text = str(code or "")
    thought_text = str(thought or "").lower()

    if "colon" in thought_text:
        if re.search(r"^\s*(if|elif|else|for|while|def|class)\b[^:\n]*$", code_text, re.MULTILINE):
            return True

    if any(token in thought_text for token in ["string", "number", "int", "concatenate", "concat"]):
        if re.search(r'print\s*\(\s*["\'][^"\']*["\']\s*\+\s*[A-Za-z_]\w*\s*\)', code_text):
            return True

    if any(token in thought_text for token in ["typo", "misspell", "spelling", "wrong variable", "invoice", "invoce"]):
        if "invoce" in code_text and "invoice" in thought_text:
            return True
        if "return invoce" in code_text.lower():
            return True

    if "semicolon" in thought_text:
        if re.search(r"^\s*(?:int|float|double|char|bool|printf|return)\b[^;\n]*$", code_text, re.MULTILINE):
            return True

    return False


def response_sounds_positive(reply_text):
    text = str(reply_text or "").strip().lower()
    return any(re.search(pattern, text) for pattern in POSITIVE_THOUGHT_PATTERNS)


def normalize_evaluation_result(result, code, thought):
    normalized = {
        "bug_found": bool(result.get("bug_found")),
        "fixed_code_provided": bool(result.get("fixed_code_provided")),
        "thought_state": str(result.get("thought_state", "wrong")).strip().lower(),
        "reply": str(result.get("reply", "")).strip() or "Keep going.",
    }

    if normalized["thought_state"] not in {"correct_bug", "wrong"}:
        normalized["thought_state"] = "correct_bug" if normalized["bug_found"] else "wrong"

    if normalized["fixed_code_provided"]:
        normalized["bug_found"] = True
        normalized["thought_state"] = "correct_bug"
        normalized["reply"] = DONE_MESSAGE
        return normalized

    if normalized["bug_found"]:
        normalized["thought_state"] = "correct_bug"
        normalized["reply"] = FOUND_MESSAGE
        return normalized

    if response_sounds_positive(normalized["reply"]) or thought_matches_obvious_bug(code, thought):
        normalized["bug_found"] = True
        normalized["thought_state"] = "correct_bug"
        normalized["reply"] = FOUND_MESSAGE

    return normalized


def validate_openai_compatible_key(api_key, provider):
    provider_details = get_provider_details(provider)
    validate_url = provider_details.get("validate_url")
    headers = {"Authorization": f"Bearer {api_key}"}

    if validate_url:
        response = requests.get(validate_url, headers=headers, timeout=REQUEST_TIMEOUT)
    else:
        response = requests.post(
            provider_details["base_url"],
            headers={**headers, "Content-Type": "application/json"},
            json={
                "model": provider_details["model"],
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            },
            timeout=REQUEST_TIMEOUT
        )

    if response.status_code != 200:
        raise RuntimeError(parse_api_error(response))


def validate_anthropic_key(api_key, provider):
    response = requests.post(
        ANTHROPIC_COUNT_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": get_provider_details(provider)["model"],
            "messages": [{"role": "user", "content": "ping"}],
        },
        timeout=REQUEST_TIMEOUT
    )

    if response.status_code == 200:
        return

    fallback = requests.post(
        ANTHROPIC_MESSAGES_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": get_provider_details(provider)["model"],
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}],
        },
        timeout=REQUEST_TIMEOUT
    )

    if fallback.status_code != 200:
        raise RuntimeError(parse_api_error(fallback))


def validate_api_key_value(api_key, provider):
    provider_details = get_provider_details(provider)

    if provider_details["kind"] == "gemini":
        response = requests.get(
            GEMINI_MODELS_URL,
            headers={"x-goog-api-key": api_key},
            timeout=REQUEST_TIMEOUT
        )

        if response.status_code != 200:
            raise RuntimeError(parse_api_error(response))
        return

    if provider_details["kind"] == "anthropic":
        validate_anthropic_key(api_key, provider)
        return

    validate_openai_compatible_key(api_key, provider)


def request_openai_compatible(api_key, prompt, provider):
    provider_details = get_provider_details(provider)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": provider_details["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }

    response = requests.post(
        provider_details["base_url"],
        headers=headers,
        json=payload,
        timeout=REQUEST_TIMEOUT
    )

    if response.status_code != 200:
        raise RuntimeError(parse_api_error(response))

    try:
        result = response.json()
        return result["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, ValueError):
        raise RuntimeError(f"{provider_details['label']} returned an unexpected response")


def request_anthropic(api_key, prompt, provider):
    response = requests.post(
        ANTHROPIC_MESSAGES_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": get_provider_details(provider)["model"],
            "max_tokens": 1800,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=REQUEST_TIMEOUT
    )

    if response.status_code != 200:
        raise RuntimeError(parse_api_error(response))

    try:
        result = response.json()
        blocks = result.get("content", [])
        texts = [block.get("text", "").strip() for block in blocks if block.get("type") == "text"]
        content = "\n".join([text for text in texts if text]).strip()
        if not content:
            raise RuntimeError("empty")
        return content
    except (AttributeError, TypeError, ValueError, RuntimeError):
        raise RuntimeError("Claude returned an unexpected response")


def call_gemini(api_key, prompt, response_mime_type=None):
    headers = {
        "x-goog-api-key": api_key,
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

    if response.status_code != 200:
        raise RuntimeError(parse_api_error(response))

    try:
        result = response.json()
        return result["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError, ValueError):
        raise RuntimeError("Gemini returned an unexpected response")


def call_model(api_key, prompt, provider, response_mime_type=None):
    provider_details = get_provider_details(provider)

    if provider_details["kind"] == "gemini":
        return call_gemini(api_key, prompt, response_mime_type=response_mime_type)

    if provider_details["kind"] == "anthropic":
        return request_anthropic(api_key, prompt, provider)

    return request_openai_compatible(api_key, prompt, provider)


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


def build_fix_result(api_key, code, provider):
    code_prompt = f"""
You are Open AIRA, a coding assistant.

Fix this code and return ONLY the corrected code.

Code:
{code}

Rules:
- Return only the corrected code.
- Do not explain anything.
- Do not add labels.
- Markdown fences are allowed if needed.
"""

    fixed_code = extract_fixed_code_text(call_model(api_key, code_prompt, provider))

    if not fixed_code:
        raise RuntimeError("Fix result did not include corrected code")

    change_prompt = f"""
You are Open AIRA, a coding assistant.

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

    change_log = parse_change_log_text(call_model(api_key, change_prompt, provider))

    return {
        "fixed_code": fixed_code,
        "change_log": change_log[:6]
    }


def check_code_health(api_key, code, provider):
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

    data = parse_json_response(call_model(api_key, prompt, provider, response_mime_type="application/json"))
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


def evaluate_thought(api_key, code, thought, debug_mode, provider):
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
- Response mode: {normalize_debug_mode(debug_mode)}
- {get_mode_instruction(debug_mode, "thought")}
- bug_found is true if the student correctly identified any real bug or valid issue in the code.
- fixed_code_provided is true only if the student has provided a corrected version of the code that fixes the main issue.
- thought_state must be "correct_bug" when the student clearly points to a real bug.
- thought_state must be "wrong" only when the student's guess is not a real bug.
- If bug_found is true but fixed_code_provided is false, set reply to: "{FOUND_MESSAGE}"
- If fixed_code_provided is true, set reply to: "{DONE_MESSAGE}"
- If thought_state is "wrong", reply in very easy English and directly say the guess is wrong.
- Keep replies short.
- Do not include markdown fences.
"""

    data = parse_json_response(call_model(api_key, prompt, provider, response_mime_type="application/json"))
    return normalize_evaluation_result(data, code, thought)


def coach_after_bug_found(api_key, code, thought, debug_mode, provider):
    prompt = f"""
You are Open AIRA, a friendly debugging coach.

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
- Response mode: {normalize_debug_mode(debug_mode)}
- {get_mode_instruction(debug_mode, "thought")}
- fixed_code_provided is true only if the student has now given the corrected code or a clearly correct final fix.
- thought_state is "close_fix" only if the student is moving in the right direction.
- thought_state is "wrong_fix" if the student is still going the wrong way.
- If fixed_code_provided is true, set reply to: "{DONE_MESSAGE}"
- If thought_state is "wrong_fix", directly say the attempt is still wrong in easy English.
- Do not repeat the sentence "{FOUND_MESSAGE}"
- Keep replies to 1 or 2 short sentences.
- Do not include markdown fences.
"""

    data = parse_json_response(call_model(api_key, prompt, provider, response_mime_type="application/json"))
    thought_state = str(data.get("thought_state", "wrong_fix")).strip().lower()
    if thought_state not in {"close_fix", "wrong_fix"}:
        thought_state = "close_fix"

    return {
        "fixed_code_provided": bool(data.get("fixed_code_provided")),
        "thought_state": thought_state,
        "reply": str(data.get("reply", "")).strip() or "Keep going."
    }


@app.route("/api-key-status", methods=["GET"])
def api_key_status():
    return jsonify({
        "configured": False,
        "storage": "browser_session",
        "message": "API keys are stored only in the user's browser session.",
        "beta_access_required": False,
        "providers": [
            {"id": provider_id, "label": details["label"]}
            for provider_id, details in PROVIDERS.items()
            if provider_id != "demo"
        ]
    })


@app.route("/verify-key", methods=["POST"])
@app.route("/beta-access", methods=["POST"])
def validate_beta_access():
    data = request.get_json() or {}

    try:
        access = verify_access_key((data or {}).get("beta_access_key"), data, request)
        record = access["record"]

        return jsonify({
            "success": True,
            "label": record["label"],
            "master": record["is_master"],
            "tester_number": record["tester_number"],
            "session_token": access["session_token"],
            "message": access["message"]
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 403


@app.route("/beta-access", methods=["DELETE"])
def clear_beta_access():
    return jsonify({
        "success": True,
        "message": "Beta access key removed from this browser."
    })


@app.route("/api-key", methods=["POST"])
def validate_api_key():
    data = request.get_json() or {}

    try:
        require_beta_access(data)
        api_key, provider = get_api_context(data)
        validate_api_key_value(api_key, provider)
        touch_beta_provider(data, provider)
        return jsonify({
            "success": True,
            "provider": provider,
            "provider_label": get_provider_label(provider),
            "message": f"{get_provider_label(provider)} API key verified for this browser session. It is not stored on the server."
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api-key", methods=["DELETE"])
def clear_api_key():
    return jsonify({
        "success": True,
        "message": "API key removed from this browser session."
    })


@app.route("/debug", methods=["POST"])
def debug_code():
    data = request.get_json() or {}
    code = str(data.get("code", "")).strip()
    mode = str(data.get("mode", "debug")).strip().lower()
    debug_mode = normalize_debug_mode(data.get("debug_mode"))
    provider = normalize_provider(data.get("provider"))

    if not code:
        return jsonify({"error": "No code provided"}), 400

    command = normalize_command(code)
    if command == "clear":
        return jsonify({"command": "clear", "message": "CLEAR_COMMAND"})

    if command == "help":
        return jsonify({"command": "help", "message": HELP_MESSAGE})

    try:
        require_beta_access(data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 403

    if looks_like_code_generation_request(code):
        return jsonify({
            "error": "Nah bro, I am not your instant code vending machine. I am here to help roast bugs, not generate homework from vibes. Paste broken code and let's cook the error."
        }), 400

    if not looks_like_code(code):
        return jsonify({
            "error": "That does not look like code. Paste a code snippet or bug example first."
        }), 400

    try:
        api_key, provider = get_api_context(data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    touch_beta_provider(data, provider)

    if mode == "debug":
        try:
            health = check_code_health(api_key, code, provider)
            if not health["has_bug"]:
                return jsonify({
                    "debug_state": None,
                    "message": health["reply"],
                    "already_clean": True
                })
        except Exception:
            pass

    if mode == "fix":
        try:
            fix_result = build_fix_result(api_key, code, provider)
            return jsonify({
                "mode": "fix",
                "fixed_code": fix_result["fixed_code"],
                "change_log": fix_result["change_log"]
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    try:
        return jsonify({
            "debug_state": {
                "code": code,
                "hint_step": 0,
                "bug_found": False,
                "last_thought": "",
                "debug_mode": debug_mode,
                "provider": provider
            },
            "message": build_initial_debug_message(debug_mode)
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/submit-thought", methods=["POST"])
def submit_thought():
    data = request.get_json() or {}
    thought = str(data.get("thought", "")).strip()
    state = normalize_debug_state(data.get("debug_state"))
    state["debug_mode"] = normalize_debug_mode(data.get("debug_mode") or state.get("debug_mode"))
    provider = normalize_provider(data.get("provider") or (data.get("debug_state") or {}).get("provider"))

    if not state["code"]:
        return jsonify({"error": "Session not found. Run the code again."}), 400

    if not thought:
        return jsonify({"error": "Write what you think first."}), 400

    try:
        require_beta_access(data)
        api_key, provider = get_api_context({**data, "provider": provider})
        touch_beta_provider(data, provider)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    state["last_thought"] = thought

    try:
        if state["bug_found"]:
            follow_up = coach_after_bug_found(api_key, state["code"], thought, state["debug_mode"], provider)

            if follow_up["fixed_code_provided"]:
                return jsonify({
                    "message": DONE_MESSAGE,
                    "done": True,
                    "thought_state": "fixed",
                    "debug_state": None
                })

            return jsonify({
                "message": follow_up["reply"],
                "bug_found": True,
                "thought_state": follow_up["thought_state"],
                "debug_state": {**state, "provider": provider}
            })

        evaluation = evaluate_thought(api_key, state["code"], thought, state["debug_mode"], provider)

        if evaluation["fixed_code_provided"]:
            return jsonify({
                "message": DONE_MESSAGE,
                "done": True,
                "thought_state": "fixed",
                "debug_state": None
            })

        if evaluation["bug_found"]:
            state["bug_found"] = True
            return jsonify({
                "message": FOUND_MESSAGE,
                "bug_found": True,
                "thought_state": "correct_bug",
                "debug_state": {**state, "provider": provider}
            })

        wrong_reply = evaluation["reply"] or "Wrong catch. That is not the real issue. Look again near the actual error area."
        return jsonify({
            "message": wrong_reply,
            "bug_found": False,
            "thought_state": "wrong",
            "debug_state": {**state, "provider": provider}
        })
    except Exception:
        prompt = f"""
You are Open AIRA, a friendly debugging coach.

The student is trying to debug this code:
{state['code']}

The student thinks the issue might be here:
{thought}

Response mode: {state['debug_mode']}
{get_mode_instruction(state['debug_mode'], "thought")}

Reply in short clear English.
Do not confirm the full answer yet.
Do not give the final fix.
In 1 or 2 short sentences, say whether they should keep checking that area or look a little earlier or later.
"""

        try:
            fallback_reply = call_model(api_key, prompt, provider)
            normalized = normalize_evaluation_result(
                {
                    "bug_found": False,
                    "fixed_code_provided": False,
                    "thought_state": "wrong",
                    "reply": fallback_reply,
                },
                state["code"],
                thought,
            )

            if normalized["bug_found"]:
                state["bug_found"] = True
                return jsonify({
                    "message": FOUND_MESSAGE,
                    "bug_found": True,
                    "thought_state": "correct_bug",
                    "debug_state": {**state, "provider": provider}
                })

            return jsonify({
                "message": normalized["reply"],
                "bug_found": False,
                "thought_state": "wrong",
                "debug_state": {**state, "provider": provider}
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500


@app.route("/hint", methods=["POST"])
def next_hint():
    data = request.get_json() or {}
    state = normalize_debug_state(data.get("debug_state"))
    state["debug_mode"] = normalize_debug_mode(data.get("debug_mode") or state.get("debug_mode"))
    provider = normalize_provider(data.get("provider") or (data.get("debug_state") or {}).get("provider"))

    if not state["code"]:
        return jsonify({"error": "Session not found. Run the code again."}), 400

    try:
        require_beta_access(data)
        api_key, provider = get_api_context({**data, "provider": provider})
        touch_beta_provider(data, provider)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    state["hint_step"] += 1
    thought = state["last_thought"] or "The student has not shared a guess yet."

    prompt = f"""
You are Open AIRA, a friendly debugging coach.

The student is debugging this code:
{state['code']}

The student's current guess is:
{thought}

Response mode: {state['debug_mode']}
{get_mode_instruction(state['debug_mode'], "hint")}

Give hint number {state['hint_step']}.
Rules:
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
            "message": call_model(api_key, prompt, provider),
            "hint_step": state["hint_step"],
            "debug_state": {**state, "provider": provider}
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/done", methods=["POST"])
def mark_done():
    data = request.get_json() or {}

    try:
        require_beta_access(data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

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
