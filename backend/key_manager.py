from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3

KEY_DIR = Path(__file__).resolve().parent.parent / "key"
DB_PATH = KEY_DIR / "key_manager.sqlite3"
LEGACY_REGISTRY_PATH = KEY_DIR / "beta_access_registry.json"
USED_INVITE_MESSAGE = "Sorry Bro but this Invitation key is already used. ask 100RAV for new key."
INACTIVE_KEY_MESSAGE = "This invitation key is inactive. Ask 100RAV for a new one."
MISSING_KEY_MESSAGE = "Beta access key required before API registration."
EXPIRED_SESSION_MESSAGE = "Beta session expired for this browser. Enter your beta key again."
MASTER_KEY_FALLBACK = "69mitramandal"


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def get_connection():
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    return conn


def mask_key(key_value):
    key = str(key_value or "").strip()
    if len(key) <= 10:
        return f"{key[:3]}****{key[-2:]}" if len(key) > 5 else "****"
    return f"{key[:6]}****{key[-4:]}"


def mask_session_token(token):
    value = str(token or "").strip()
    if not value:
        return "No active session"
    return f"{value[:6]}...{value[-4:]}"


def extract_tester_number(label):
    digits = "".join(ch for ch in str(label or "") if ch.isdigit())
    return digits[-2:] if digits else None


def load_legacy_registry():
    fallback = {"master_key": MASTER_KEY_FALLBACK, "keys": {}}

    try:
        raw = json.loads(LEGACY_REGISTRY_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback

    keys = raw.get("keys", {}) if isinstance(raw, dict) else {}
    normalized_keys = {}

    if isinstance(keys, dict):
        for key_value, meta in keys.items():
            if not isinstance(key_value, str):
                continue

            normalized_value = key_value.strip()
            if not normalized_value:
                continue

            details = meta if isinstance(meta, dict) else {}
            normalized_keys[normalized_value] = {
                "label": str(details.get("label", "BETA")).strip() or "BETA",
                "active": 1 if bool(details.get("active", True)) else 0,
            }

    master_key = str(raw.get("master_key", MASTER_KEY_FALLBACK)).strip() if isinstance(raw, dict) else MASTER_KEY_FALLBACK

    return {
        "master_key": master_key or MASTER_KEY_FALLBACK,
        "keys": normalized_keys,
    }


def init_key_store():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS access_keys (
                key_value TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                is_master INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                active_device TEXT,
                active_device_label TEXT,
                active_session_token TEXT,
                last_used_time TEXT,
                claimed_at TEXT,
                last_ip TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

        registry = load_legacy_registry()
        now = utc_now_iso()

        conn.execute(
            """
            INSERT OR IGNORE INTO access_keys (
                key_value, label, is_master, active, created_at
            ) VALUES (?, ?, 1, 1, ?)
            """,
            (registry["master_key"], "MASTER", now),
        )

        for key_value, details in registry["keys"].items():
            conn.execute(
                """
                INSERT OR IGNORE INTO access_keys (
                    key_value, label, active, created_at
                ) VALUES (?, ?, ?, ?)
                """,
                (key_value, details["label"], details["active"], now),
            )

        conn.commit()


def build_request_ip(request):
    forwarded = str(request.headers.get("X-Forwarded-For", "")).strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    return str(request.remote_addr or "").strip() or "unknown-ip"


def build_fallback_device_id(request):
    raw = f"{build_request_ip(request)}|{request.headers.get('User-Agent', '')}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"fallback-{digest[:20]}"


def build_device_context(data, request):
    payload = data or {}
    device_id = str(payload.get("beta_device_id", "")).strip() or build_fallback_device_id(request)
    device_label = str(payload.get("beta_device_label", "")).strip()
    if not device_label:
        device_label = str(request.headers.get("User-Agent", "Unknown device")).strip()[:120]
    session_token = str(payload.get("beta_session_token", "")).strip()
    request_ip = build_request_ip(request)
    return device_id, device_label, session_token, request_ip


def fetch_key_record(conn, access_key):
    row = conn.execute(
        "SELECT * FROM access_keys WHERE key_value = ?",
        (str(access_key or "").strip(),),
    ).fetchone()
    return row


def serialize_key_row(row):
    active = bool(row["active"])
    current_device = row["active_device_label"] or "No active device"
    session_label = mask_session_token(row["active_session_token"])
    if row["is_master"]:
        current_device = row["active_device_label"] or "Master bypass ready"
        session_label = "Master bypass"

    return {
        "key": row["key_value"],
        "masked_key": mask_key(row["key_value"]),
        "label": row["label"],
        "tester_number": extract_tester_number(row["label"]),
        "is_master": bool(row["is_master"]),
        "active": active,
        "status": "Active" if active else "Inactive",
        "current_device": current_device,
        "session": session_label,
        "last_used_time": row["last_used_time"] or "Never used",
        "last_ip": row["last_ip"] or "No IP yet",
    }


def issue_session_token():
    return f"csk_{secrets.token_urlsafe(18)}"


def verify_access_key(access_key, data, request):
    candidate = str(access_key or "").strip()
    if not candidate:
        raise ValueError(MISSING_KEY_MESSAGE)

    init_key_store()
    device_id, device_label, _, request_ip = build_device_context(data, request)

    with get_connection() as conn:
        row = fetch_key_record(conn, candidate)
        if not row:
            raise ValueError("Invalid beta access key. Ask the owner for a valid invite key.")

        if not row["active"]:
            raise ValueError(INACTIVE_KEY_MESSAGE)

        now = utc_now_iso()

        if row["is_master"]:
            session_token = row["active_session_token"] or issue_session_token()
            conn.execute(
                """
                UPDATE access_keys
                SET active_device = ?, active_device_label = ?, active_session_token = ?,
                    last_used_time = ?, claimed_at = COALESCE(claimed_at, ?), last_ip = ?
                WHERE key_value = ?
                """,
                (device_id, device_label, session_token, now, now, request_ip, candidate),
            )
            conn.commit()
            row = fetch_key_record(conn, candidate)
            return {
                "record": serialize_key_row(row),
                "message": "Master beta access granted for this browser.",
                "session_token": session_token,
            }

        assigned_device = str(row["active_device"] or "").strip()
        if assigned_device and assigned_device != device_id:
            raise ValueError(USED_INVITE_MESSAGE)

        session_token = str(row["active_session_token"] or "").strip() or issue_session_token()
        claimed_at = row["claimed_at"] or now

        conn.execute(
            """
            UPDATE access_keys
            SET active_device = ?, active_device_label = ?, active_session_token = ?,
                last_used_time = ?, claimed_at = ?, last_ip = ?
            WHERE key_value = ?
            """,
            (device_id, device_label, session_token, now, claimed_at, request_ip, candidate),
        )
        conn.commit()
        row = fetch_key_record(conn, candidate)

    return {
        "record": serialize_key_row(row),
        "message": f"Beta access verified for {row['label']} in this browser.",
        "session_token": session_token,
    }


def authenticate_access_key(access_key, data, request):
    candidate = str(access_key or "").strip()
    if not candidate:
        raise ValueError(MISSING_KEY_MESSAGE)

    init_key_store()
    device_id, device_label, session_token, request_ip = build_device_context(data, request)

    with get_connection() as conn:
        row = fetch_key_record(conn, candidate)
        if not row:
            raise ValueError("Invalid beta access key. Ask the owner for a valid invite key.")

        if not row["active"]:
            raise ValueError(INACTIVE_KEY_MESSAGE)

        now = utc_now_iso()

        if row["is_master"]:
            active_session_token = str(row["active_session_token"] or "").strip() or issue_session_token()
            conn.execute(
                """
                UPDATE access_keys
                SET active_device = ?, active_device_label = ?, active_session_token = ?,
                    last_used_time = ?, claimed_at = COALESCE(claimed_at, ?), last_ip = ?
                WHERE key_value = ?
                """,
                (device_id, device_label, active_session_token, now, now, request_ip, candidate),
            )
            conn.commit()
            row = fetch_key_record(conn, candidate)
            return {
                "record": serialize_key_row(row),
                "session_token": active_session_token,
            }

        assigned_device = str(row["active_device"] or "").strip()
        active_session_token = str(row["active_session_token"] or "").strip()

        if not assigned_device:
            raise ValueError(EXPIRED_SESSION_MESSAGE)

        if assigned_device != device_id:
            raise ValueError(USED_INVITE_MESSAGE)

        if not session_token or session_token != active_session_token:
            raise ValueError(EXPIRED_SESSION_MESSAGE)

        conn.execute(
            """
            UPDATE access_keys
            SET active_device_label = ?, last_used_time = ?, last_ip = ?
            WHERE key_value = ?
            """,
            (device_label, now, request_ip, candidate),
        )
        conn.commit()
        row = fetch_key_record(conn, candidate)

    return {
        "record": serialize_key_row(row),
        "session_token": active_session_token,
    }


def list_access_keys():
    init_key_store()
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM access_keys
            ORDER BY is_master DESC, label ASC, key_value ASC
            """
        ).fetchall()
    return [serialize_key_row(row) for row in rows]


def toggle_access_key(access_key, active):
    init_key_store()
    with get_connection() as conn:
        row = fetch_key_record(conn, access_key)
        if not row:
            raise ValueError("Key not found.")

        next_active = 1 if bool(active) else 0
        if not next_active:
            conn.execute(
                """
                UPDATE access_keys
                SET active = 0, active_device = NULL, active_device_label = NULL,
                    active_session_token = NULL
                WHERE key_value = ?
                """,
                (access_key,),
            )
        else:
            conn.execute(
                "UPDATE access_keys SET active = 1 WHERE key_value = ?",
                (access_key,),
            )

        conn.commit()
        updated = fetch_key_record(conn, access_key)

    return serialize_key_row(updated)


def terminate_key_session(access_key):
    init_key_store()
    with get_connection() as conn:
        row = fetch_key_record(conn, access_key)
        if not row:
            raise ValueError("Key not found.")

        conn.execute(
            """
            UPDATE access_keys
            SET active_device = NULL, active_device_label = NULL, active_session_token = NULL
            WHERE key_value = ?
            """,
            (access_key,),
        )
        conn.commit()
        updated = fetch_key_record(conn, access_key)

    return serialize_key_row(updated)
