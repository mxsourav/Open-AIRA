from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from key_manager import (
    authenticate_admin_token,
    clear_admin_session,
    create_admin_session,
    get_admin_identity,
    get_admin_overview,
    init_key_store,
    terminate_key_session,
    toggle_access_key,
    update_admin_credentials,
    update_master_key,
    verify_admin_login,
)

admin_bp = Blueprint("admin_bp", __name__)


def admin_required(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        token = str(request.headers.get("X-CodeSentinel-Admin", "")).strip()
        if session.get("codesentinel_admin"):
            return handler(*args, **kwargs)
        try:
            auth = authenticate_admin_token(token)
        except ValueError:
            return jsonify({"error": "Admin login required."}), 401
        session["codesentinel_admin"] = True
        session["codesentinel_admin_username"] = auth["username"]
        return handler(*args, **kwargs)

    return wrapped


@admin_bp.before_app_request
def ensure_key_store_ready():
    init_key_store()


@admin_bp.route("/admin/session", methods=["GET"])
def admin_session_status():
    token = str(request.headers.get("X-CodeSentinel-Admin", "")).strip()
    token_authenticated = False
    if token:
        try:
            auth = authenticate_admin_token(token)
            session["codesentinel_admin"] = True
            session["codesentinel_admin_username"] = auth["username"]
            token_authenticated = True
        except ValueError:
            token_authenticated = False

    identity = get_admin_identity()
    return jsonify({
        "authenticated": bool(session.get("codesentinel_admin")) or token_authenticated,
        "username": identity["username"] if (session.get("codesentinel_admin") or token_authenticated) else None,
    })


@admin_bp.route("/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json() or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    try:
        identity = verify_admin_login(username, password)
    except ValueError as error:
        return jsonify({"error": str(error)}), 401

    session["codesentinel_admin"] = True
    session["codesentinel_admin_username"] = identity["username"]
    admin_token = create_admin_session(identity["username"])

    return jsonify({
        "success": True,
        "username": identity["username"],
        "admin_token": admin_token,
        "message": "Admin session unlocked.",
    })


@admin_bp.route("/admin/logout", methods=["POST"])
def admin_logout():
    token = str(request.headers.get("X-CodeSentinel-Admin", "")).strip()
    clear_admin_session(token)
    session.pop("codesentinel_admin", None)
    session.pop("codesentinel_admin_username", None)
    return jsonify({"success": True, "message": "Admin session cleared."})


@admin_bp.route("/admin/overview", methods=["GET"])
@admin_required
def admin_overview():
    return jsonify(get_admin_overview())


@admin_bp.route("/admin/keys", methods=["GET"])
@admin_required
def admin_keys():
    overview = get_admin_overview()
    return jsonify({"keys": overview["keys"]})


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


@admin_bp.route("/admin/master-key", methods=["POST"])
@admin_required
def admin_update_master_key():
    data = request.get_json() or {}
    new_key = str(data.get("new_key", "")).strip()

    try:
        record = update_master_key(new_key)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    return jsonify({
        "success": True,
        "master_key": record,
        "message": "Master key updated successfully.",
    })


@admin_bp.route("/admin/credentials", methods=["POST"])
@admin_required
def admin_update_credentials():
    data = request.get_json() or {}
    current_password = str(data.get("current_password", "")).strip()
    new_username = str(data.get("new_username", "")).strip()
    new_password = str(data.get("new_password", ""))

    try:
        identity = update_admin_credentials(current_password, new_username, new_password)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    session["codesentinel_admin"] = True
    session["codesentinel_admin_username"] = identity["username"]

    return jsonify({
        "success": True,
        "admin_user": identity,
        "message": "Admin login details updated successfully.",
    })
