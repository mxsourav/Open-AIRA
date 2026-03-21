from __future__ import annotations

import os
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash

from key_manager import init_key_store, list_access_keys, terminate_key_session, toggle_access_key

admin_bp = Blueprint("admin_bp", __name__)

ADMIN_USERNAME = os.getenv("CODESENTINEL_ADMIN_USERNAME", "mxsourav")
ADMIN_PASSWORD_HASH = os.getenv(
    "CODESENTINEL_ADMIN_PASSWORD_HASH",
    "scrypt:32768:8:1$VXTyRPRxJHXaFywB$0bd1e7553ac010930c448dd2bf8d9f21d3c1562c98528e74c3c819c63fca7437607ffac1209c4d8a6e8682adcdc83a3c4cdfd28c7e8ce988c5978920ef623f8a",
)


def admin_required(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        if not session.get("codesentinel_admin"):
            return jsonify({"error": "Admin login required."}), 401
        return handler(*args, **kwargs)

    return wrapped


@admin_bp.before_app_request
def ensure_key_store_ready():
    init_key_store()


@admin_bp.route("/admin/session", methods=["GET"])
def admin_session_status():
    return jsonify({
        "authenticated": bool(session.get("codesentinel_admin")),
        "username": ADMIN_USERNAME if session.get("codesentinel_admin") else None,
    })


@admin_bp.route("/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json() or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if username != ADMIN_USERNAME or not check_password_hash(ADMIN_PASSWORD_HASH, password):
        return jsonify({"error": "Invalid admin credentials."}), 401

    session["codesentinel_admin"] = True
    session["codesentinel_admin_username"] = ADMIN_USERNAME

    return jsonify({
        "success": True,
        "username": ADMIN_USERNAME,
        "message": "Admin session unlocked.",
    })


@admin_bp.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("codesentinel_admin", None)
    session.pop("codesentinel_admin_username", None)
    return jsonify({"success": True, "message": "Admin session cleared."})


@admin_bp.route("/admin/keys", methods=["GET"])
@admin_required
def admin_keys():
    return jsonify({"keys": list_access_keys()})


@admin_bp.route("/toggle-key", methods=["POST"])
@admin_required
def toggle_key():
    data = request.get_json() or {}
    key_value = str(data.get("key", "")).strip()
    active = bool(data.get("active", True))

    try:
        record = toggle_access_key(key_value, active)
    except ValueError as error:
        return jsonify({"error": str(error)}), 404

    return jsonify({"success": True, "key": record})


@admin_bp.route("/terminate-key", methods=["POST"])
@admin_required
def terminate_key():
    data = request.get_json() or {}
    key_value = str(data.get("key", "")).strip()

    try:
        record = terminate_key_session(key_value)
    except ValueError as error:
        return jsonify({"error": str(error)}), 404

    return jsonify({"success": True, "key": record})
