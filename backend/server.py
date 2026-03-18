from flask import Flask, request, jsonify
import os
import requests

app = Flask(__name__)

# Get API key from environment
API_KEY = os.getenv("GEMINI_API_KEY")

# Device state (for ESP32 later)
device_state = {
    "mode": "idle",
    "status": 0,
    "message": "Ready",
    "attempt": 0,
    "score": 0
}

# -------------------------------
# Debug Endpoint
# -------------------------------
@app.route("/debug", methods=["POST"])
def debug_code():
    data = request.json
    code = data.get("code", "")

    if not code:
        return jsonify({"error": "No code provided"}), 400

    # 🔥 Gemini API call
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={API_KEY}"

    prompt = f"""
You are a debugging trainer.

Analyze this code:
{code}

Return JSON:
{{
  "error_line": number,
  "error_type": "syntax/logic/runtime",
  "hint_1": "...",
  "hint_2": "...",
  "final_answer": "..."
}}
"""

    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ]
    }

    response = requests.post(url, json=payload)
    result = response.json()

    try:
        text = result["candidates"][0]["content"]["parts"][0]["text"]
    except:
        return jsonify({"error": "AI response failed", "raw": result})

    return jsonify({"ai_response": text})


# -------------------------------
# Device Status (ESP32)
# -------------------------------
@app.route("/device-status", methods=["GET"])
def get_status():
    return jsonify(device_state)


# -------------------------------
# Update Device State
# -------------------------------
@app.route("/update", methods=["POST"])
def update_status():
    global device_state
    data = request.json
    device_state.update(data)
    return jsonify({"success": True})


# -------------------------------
# Run Server
# -------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)