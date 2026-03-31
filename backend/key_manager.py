from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3

from werkzeug.security import check_password_hash, generate_password_hash

KEY_DIR = Path(__file__).resolve().parent.parent / "key"
DB_PATH = KEY_DIR / "key_manager.sqlite3"
LEGACY_REGISTRY_PATH = KEY_DIR / "beta_access_registry.json"
PLAIN_KEYS_PATH = KEY_DIR / "Beta_Access_Keys.txt"
USED_INVITE_MESSAGE = "Sorry Bro but this Invitation key is already used. ask 100RAV for new key."
INACTIVE_KEY_MESSAGE = "This invitation key is inactive. Ask 100RAV for a new one."
MISSING_KEY_MESSAGE = "Beta access key required before API registration."
EXPIRED_SESSION_MESSAGE = "Beta session expired for this browser. Enter your beta key again."
MASTER_KEY_FALLBACK = os.getenv("OPEN_AIRA_MASTER_KEY") or os.getenv("CODESENTINEL_MASTER_KEY") or "change-me-open-aira-master"
DEFAULT_ADMIN_USERNAME = os.getenv("OPEN_AIRA_ADMIN_USERNAME") or os.getenv("CODESENTINEL_ADMIN_USERNAME", "mxsourav")
DEFAULT_ADMIN_PASSWORD_HASH = os.getenv(
    "OPEN_AIRA_ADMIN_PASSWORD_HASH",
    os.getenv(
        "CODESENTINEL_ADMIN_PASSWORD_HASH",
    "scrypt:32768:8:1$VXTyRPRxJHXaFywB$0bd1e7553ac010930c448dd2bf8d9f21d3c1562c98528e74c3c819c63fca7437607ffac1209c4d8a6e8682adcdc83a3c4cdfd28c7e8ce988c5978920ef623f8a",
    ),
)
PROVIDER_LABELS = {
    "gemini": "Gemini",
    "openai": "OpenAI",
    "xai": "Grok",
    "claude": "Claude",
    "deepseek": "DeepSeek",
}


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


def ensure_column(conn, table_name, column_name, definition):
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {definition}")


def get_master_key_row(conn):
    return conn.execute(
        """
        SELECT *
        FROM access_keys
        WHERE is_master = 1
        ORDER BY created_at ASC, key_value ASC
        LIMIT 1
        """
    ).fetchone()


def fetch_key_record(conn, access_key):
    return conn.execute(
        "SELECT * FROM access_keys WHERE key_value = ?",
        (str(access_key or "").strip(),),
    ).fetchone()


def get_admin_auth_row(conn):
    return conn.execute(
        """
        SELECT *
        FROM admin_auth
        WHERE id = 1
        """
    ).fetchone()


def get_admin_session_row(conn, token_hash):
    return conn.execute(
        """
        SELECT *
        FROM admin_sessions
        WHERE token_hash = ?
        """,
        (token_hash,),
    ).fetchone()


def write_registry_files(conn):
    master_row = get_master_key_row(conn)
    invite_rows = conn.execute(
        """
        SELECT key_value, label, active
        FROM access_keys
        WHERE is_master = 0
        ORDER BY label ASC, key_value ASC
        """
    ).fetchall()

    registry_payload = {
        "master_key": master_row["key_value"] if master_row else MASTER_KEY_FALLBACK,
        "keys": {
            row["key_value"]: {
                "label": row["label"],
                "active": bool(row["active"]),
            }
            for row in invite_rows
        },
    }
    LEGACY_REGISTRY_PATH.write_text(json.dumps(registry_payload, indent=2), encoding="utf-8")

    text_lines = [
        "Open AIRA Access Keys",
        "Keep this file private.",
        "",
        "Master Key:",
        registry_payload["master_key"],
        "",
        "Invite Keys:",
    ]

    for row in invite_rows:
        text_lines.append(f"{row['label']}  ->  {row['key_value']}")

    text_lines.extend([
        "",
        "To terminate any invite key later:",
        "1. Open the admin panel or edit key/beta_access_registry.json",
        "2. Set that key inactive",
        "3. Redeploy the backend if your hosting does not persist runtime changes",
    ])

    PLAIN_KEYS_PATH.write_text("\n".join(text_lines), encoding="utf-8")


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
        ensure_column(conn, "access_keys", "active_device_hash", "active_device_hash TEXT")
        ensure_column(conn, "access_keys", "last_provider", "last_provider TEXT")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_auth (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_time TEXT NOT NULL
            )
            """
        )
        conn.commit()

        registry = load_legacy_registry()
        now = utc_now_iso()
        mutated = False

        if not get_master_key_row(conn):
            conn.execute(
                """
                INSERT INTO access_keys (
                    key_value, label, is_master, active, created_at
                ) VALUES (?, ?, 1, 1, ?)
                """,
                (registry["master_key"], "MASTER", now),
            )
            mutated = True

        for key_value, details in registry["keys"].items():
            before = fetch_key_record(conn, key_value)
            conn.execute(
                """
                INSERT OR IGNORE INTO access_keys (
                    key_value, label, active, created_at
                ) VALUES (?, ?, ?, ?)
                """,
                (key_value, details["label"], details["active"], now),
            )
            if before is None:
                mutated = True

        if not get_admin_auth_row(conn):
            conn.execute(
                """
                INSERT INTO admin_auth (id, username, password_hash, updated_at)
                VALUES (1, ?, ?, ?)
                """,
                (DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD_HASH, now),
            )
            mutated = True

        conn.commit()

        if mutated:
            write_registry_files(conn)


def build_request_ip(request):
    forwarded = str(request.headers.get("X-Forwarded-For", "")).strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    return str(request.remote_addr or "").strip() or "unknown-ip"


def build_fallback_device_id(request):
    raw = f"{build_request_ip(request)}|{request.headers.get('User-Agent', '')}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"fallback-{digest[:20]}"


def build_device_hash(device_id, request_ip, user_agent):
    raw = f"{device_id}|{request_ip}|{user_agent}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_device_context(data, request):
    payload = data or {}
    request_ip = build_request_ip(request)
    user_agent = str(request.headers.get("User-Agent", "Unknown device")).strip()
    device_id = str(payload.get("beta_device_id", "")).strip() or build_fallback_device_id(request)
    device_label = str(payload.get("beta_device_label", "")).strip() or user_agent[:120]
    session_token = str(payload.get("beta_session_token", "")).strip()
    device_hash = build_device_hash(device_id, request_ip, user_agent)
    return device_id, device_label, session_token, request_ip, device_hash


def serialize_key_row(row):
    active = bool(row["active"])
    current_device = row["active_device_label"] or "No active device"
    session_label = mask_session_token(row["active_session_token"])
    if row["is_master"]:
        current_device = row["active_device_label"] or "Master bypass ready"
        session_label = "Master bypass" if row["active_session_token"] else "No active session"

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
        "first_used_time": row["claimed_at"] or "Never used",
        "last_used_time": row["last_used_time"] or "Never used",
        "last_ip": row["last_ip"] or "No IP yet",
        "provider": row.get("last_provider") or "",
        "provider_label": PROVIDER_LABELS.get(str(row.get("last_provider") or "").strip().lower(), "No provider yet"),
        "claimed": bool(row.get("claimed_at")),
    }


def serialize_admin_row(row):
    return {
        "username": row["username"],
        "updated_at": row["updated_at"],
    }


def hash_admin_token(token):
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def issue_session_token():
    return f"csk_{secrets.token_urlsafe(18)}"


def verify_access_key(access_key, data, request):
    candidate = str(access_key or "").strip()
    if not candidate:
        raise ValueError(MISSING_KEY_MESSAGE)

    init_key_store()
    device_id, device_label, _, request_ip, device_hash = build_device_context(data, request)

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
                SET active_device = ?, active_device_label = ?, active_device_hash = ?, active_session_token = ?,
                    last_used_time = ?, claimed_at = COALESCE(claimed_at, ?), last_ip = ?
                WHERE key_value = ?
                """,
                (device_id, device_label, device_hash, session_token, now, now, request_ip, candidate),
            )
            conn.commit()
            row = fetch_key_record(conn, candidate)
            return {
                "record": serialize_key_row(row),
                "message": "Master beta access granted for this browser.",
                "session_token": session_token,
            }

        assigned_device = str(row["active_device"] or "").strip()
        assigned_hash = str(row.get("active_device_hash") or "").strip()
        if (assigned_device and assigned_device != device_id) or (assigned_hash and assigned_hash != device_hash):
            raise ValueError(USED_INVITE_MESSAGE)

        session_token = str(row["active_session_token"] or "").strip() or issue_session_token()
        claimed_at = row["claimed_at"] or now

        conn.execute(
            """
            UPDATE access_keys
            SET active_device = ?, active_device_label = ?, active_device_hash = ?, active_session_token = ?,
                last_used_time = ?, claimed_at = ?, last_ip = ?
            WHERE key_value = ?
            """,
            (device_id, device_label, device_hash, session_token, now, claimed_at, request_ip, candidate),
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
    device_id, device_label, session_token, request_ip, device_hash = build_device_context(data, request)

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
                SET active_device = ?, active_device_label = ?, active_device_hash = ?, active_session_token = ?,
                    last_used_time = ?, claimed_at = COALESCE(claimed_at, ?), last_ip = ?
                WHERE key_value = ?
                """,
                (device_id, device_label, device_hash, active_session_token, now, now, request_ip, candidate),
            )
            conn.commit()
            row = fetch_key_record(conn, candidate)
            return {
                "record": serialize_key_row(row),
                "session_token": active_session_token,
            }

        assigned_device = str(row["active_device"] or "").strip()
        assigned_hash = str(row.get("active_device_hash") or "").strip()
        active_session_token = str(row["active_session_token"] or "").strip()

        if not assigned_device:
            raise ValueError(EXPIRED_SESSION_MESSAGE)

        if assigned_device != device_id or (assigned_hash and assigned_hash != device_hash):
            raise ValueError(USED_INVITE_MESSAGE)

        if not session_token or session_token != active_session_token:
            raise ValueError(EXPIRED_SESSION_MESSAGE)

        conn.execute(
            """
            UPDATE access_keys
            SET active_device_label = ?, active_device_hash = ?, last_used_time = ?, last_ip = ?
            WHERE key_value = ?
            """,
            (device_label, device_hash, now, request_ip, candidate),
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
        if row["is_master"]:
            raise ValueError("Use the master-key editor to manage the master key.")

        next_active = 1 if bool(active) else 0
        if not next_active:
            conn.execute(
                """
                UPDATE access_keys
                SET active = 0, active_device = NULL, active_device_label = NULL,
                    active_device_hash = NULL, active_session_token = NULL
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
        if not updated["is_master"]:
            write_registry_files(conn)

    return serialize_key_row(updated)


def terminate_key_session(access_key):
    init_key_store()
    with get_connection() as conn:
        row = fetch_key_record(conn, access_key)
        if not row:
            raise ValueError("Key not found.")
        if row["is_master"]:
            raise ValueError("Use the master-key editor to manage the master key.")

        conn.execute(
            """
            UPDATE access_keys
            SET active_device = NULL, active_device_label = NULL,
                active_device_hash = NULL, active_session_token = NULL
            WHERE key_value = ?
            """,
            (access_key,),
        )
        conn.commit()
        updated = fetch_key_record(conn, access_key)

    return serialize_key_row(updated)


def record_key_provider(access_key, provider):
    candidate = str(access_key or "").strip()
    provider_value = str(provider or "").strip().lower()
    if not candidate or not provider_value:
        return

    init_key_store()
    with get_connection() as conn:
        row = fetch_key_record(conn, candidate)
        if not row:
            return

        conn.execute(
            """
            UPDATE access_keys
            SET last_provider = ?
            WHERE key_value = ?
            """,
            (provider_value, candidate),
        )
        conn.commit()


def get_admin_identity():
    init_key_store()
    with get_connection() as conn:
        row = get_admin_auth_row(conn)
    return serialize_admin_row(row)


def verify_admin_login(username, password):
    init_key_store()
    with get_connection() as conn:
        row = get_admin_auth_row(conn)

    submitted_username = str(username or "").strip()
    submitted_password = str(password or "").strip()

    if submitted_username != row["username"] or not check_password_hash(row["password_hash"], submitted_password):
        raise ValueError("Invalid admin credentials.")

    return serialize_admin_row(row)


def create_admin_session(username):
    init_key_store()
    raw_token = f"csa_{secrets.token_urlsafe(24)}"
    token_hash = hash_admin_token(raw_token)
    now = utc_now_iso()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO admin_sessions (token_hash, username, created_at, last_used_time)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, username, now, now),
        )
        conn.commit()

    return raw_token


def authenticate_admin_token(token):
    raw_token = str(token or "").strip()
    if not raw_token:
        raise ValueError("Admin login required.")

    token_hash = hash_admin_token(raw_token)
    init_key_store()
    with get_connection() as conn:
        row = get_admin_session_row(conn, token_hash)
        if not row:
            raise ValueError("Admin login required.")

        now = utc_now_iso()
        conn.execute(
            """
            UPDATE admin_sessions
            SET last_used_time = ?
            WHERE token_hash = ?
            """,
            (now, token_hash),
        )
        conn.commit()

    return {"username": row["username"], "last_used_time": now}


def clear_admin_session(token):
    raw_token = str(token or "").strip()
    if not raw_token:
        return

    token_hash = hash_admin_token(raw_token)
    init_key_store()
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM admin_sessions WHERE token_hash = ?",
            (token_hash,),
        )
        conn.commit()


def update_master_key(new_key):
    candidate = str(new_key or "").strip()
    if len(candidate) < 8:
        raise ValueError("Master key must be at least 8 characters long.")

    init_key_store()
    with get_connection() as conn:
        master_row = get_master_key_row(conn)
        if not master_row:
            raise ValueError("Master key record not found.")

        existing = fetch_key_record(conn, candidate)
        if existing and not existing["is_master"]:
            raise ValueError("That value is already used by another invite key.")

        if candidate == master_row["key_value"]:
            return serialize_key_row(master_row)

        conn.execute(
            """
            UPDATE access_keys
            SET key_value = ?, active_device = NULL, active_device_label = NULL,
                active_device_hash = NULL, active_session_token = NULL,
                last_used_time = NULL, claimed_at = NULL, last_ip = NULL
            WHERE key_value = ?
            """,
            (candidate, master_row["key_value"]),
        )
        conn.commit()
        updated = fetch_key_record(conn, candidate)
        write_registry_files(conn)

    return serialize_key_row(updated)


def update_admin_credentials(current_password, new_username, new_password):
    current_password_value = str(current_password or "").strip()
    username_value = str(new_username or "").strip()
    password_value = str(new_password or "")

    if not current_password_value:
        raise ValueError("Current admin password is required.")

    init_key_store()
    with get_connection() as conn:
        row = get_admin_auth_row(conn)
        if not check_password_hash(row["password_hash"], current_password_value):
            raise ValueError("Current admin password is incorrect.")

        next_username = username_value or row["username"]
        next_password_hash = row["password_hash"]

        if password_value:
            if len(password_value) < 8:
                raise ValueError("New admin password must be at least 8 characters long.")
            next_password_hash = generate_password_hash(password_value)

        if next_username == row["username"] and next_password_hash == row["password_hash"]:
            raise ValueError("No admin changes were provided.")

        updated_at = utc_now_iso()
        conn.execute(
            """
            UPDATE admin_auth
            SET username = ?, password_hash = ?, updated_at = ?
            WHERE id = 1
            """,
            (next_username, next_password_hash, updated_at),
        )
        conn.commit()
        updated = get_admin_auth_row(conn)

    return serialize_admin_row(updated)


def get_admin_overview():
    init_key_store()
    with get_connection() as conn:
        keys = [
            serialize_key_row(row)
            for row in conn.execute(
                """
                SELECT *
                FROM access_keys
                ORDER BY is_master DESC, label ASC, key_value ASC
                """
            ).fetchall()
        ]
        master_row = get_master_key_row(conn)
        admin_row = get_admin_auth_row(conn)

    return {
        "keys": keys,
        "master_key": serialize_key_row(master_row) if master_row else None,
        "admin_user": serialize_admin_row(admin_row) if admin_row else None,
    }
