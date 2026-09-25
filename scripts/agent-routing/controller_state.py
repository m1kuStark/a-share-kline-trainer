"""Persistent controller state: task registration, events, and leases.

Owns its SQLite schema inside a caller-provided control directory. All
history is append-only: registration pins, deduplicated events, and
leases survive process restarts until the control layer disposes them
explicitly. Counts are never stored; they are derived from event rows,
so repeated events cannot inflate counts.
"""
import ctypes
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from routing import EVENTS

DB_FILENAME = "controller_state.sqlite3"

_FAILURE_KINDS = {"failure", "repair_failed"}
_TASK_ID_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_SHA256_RE = re.compile(r"\A[0-9a-f]{64}\Z")
_COMMIT_RE = re.compile(r"\A[0-9a-f]{40,64}\Z")
_SCHEMA_COLUMNS = {
    # name, type, NOT NULL, default, primary-key ordinal (PRAGMA table_info).
    "registrations": [("task_id", "TEXT", 0, None, 1),
                      ("registration", "TEXT", 1, None, 0)],
    "events": [("task_id", "TEXT", 1, None, 1),
               ("event_id", "TEXT", 1, None, 2),
               ("kind", "TEXT", 1, None, 0),
               ("payload", "TEXT", 1, None, 0)],
    "leases": [("task_id", "TEXT", 0, None, 1),
               ("owner_token", "TEXT", 1, None, 0),
               ("repo_norm", "TEXT", 1, None, 0),
               ("scopes_json", "TEXT", 1, None, 0),
               ("acquired_at", "TEXT", 1, None, 0)],
}
_TABLES = frozenset(_SCHEMA_COLUMNS)

if os.name == "nt":
    _FILE_SHARE_ALL = 0x1 | 0x2 | 0x4
    _OPEN_EXISTING = 3
    _FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    _INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    _KERNEL32 = ctypes.windll.kernel32
    _KERNEL32.CreateFileW.restype = ctypes.c_void_p
    _KERNEL32.CloseHandle.argtypes = [ctypes.c_void_p]
    _KERNEL32.GetFinalPathNameByHandleW.argtypes = [
        ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    _KERNEL32.GetFinalPathNameByHandleW.restype = ctypes.c_uint32
else:
    _FILE_SHARE_ALL = _OPEN_EXISTING = _FILE_FLAG_BACKUP_SEMANTICS = 0
    _INVALID_HANDLE_VALUE = None
    _KERNEL32 = None


class TaskStoreError(ValueError):
    """Base error for invalid input, conflicts, and unusable databases."""


class UnknownTaskError(TaskStoreError):
    """The requested task_id was never registered."""


class ConflictError(TaskStoreError):
    """A conflicting registration, event, or lease already exists."""


def _check_finite_json(value, where):
    if value is None or isinstance(value, (bool, str)):
        return
    if isinstance(value, int):
        return
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise TaskStoreError("%s: non-finite number" % where)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TaskStoreError("%s: dict keys must be strings" % where)
            _check_finite_json(item, where)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _check_finite_json(item, "%s[%d]" % (where, index))
        return
    raise TaskStoreError("%s: not JSON-serializable" % where)


def _canonical(value):
    _check_finite_json(value, "value")
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _require_task_id(task_id):
    if not isinstance(task_id, str) or _TASK_ID_RE.fullmatch(task_id) is None:
        raise TaskStoreError("invalid task_id: %r" % (task_id,))


def _require_token(owner_token):
    if not isinstance(owner_token, str) or not owner_token.strip():
        raise TaskStoreError("owner_token must be a nonempty string")
    if len(owner_token) > 256:
        raise TaskStoreError("owner_token too long")
    if owner_token.isdigit():
        raise TaskStoreError("owner_token must be random, not a bare PID")


def _long_path_form(path):
    # Resolve 8.3 short names via the filesystem itself; no directory scans.
    if os.name != "nt":
        return None
    try:
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.create_unicode_buffer(1024)
        length = kernel32.GetLongPathNameW(str(path), buf, 1024)
        if length == 0:
            return None
        if length > 1024:
            buf = ctypes.create_unicode_buffer(length)
            if kernel32.GetLongPathNameW(str(path), buf, length) == 0:
                return None
        return buf.value
    except Exception:
        return None


def _strip_device_prefix(value):
    # GetFinalPathNameByHandleW reports \\?\C:\... or \\?\UNC\server\share.
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[len("\\\\?\\UNC\\"):]
    if value.startswith("\\\\?\\"):
        return value[len("\\\\?\\"):]
    return value


def _final_path_form(path):
    # Ask the filesystem for the final path of an existing directory, so
    # device-prefixed, re-cased, 8.3, and junction aliases of one directory
    # collapse onto the same string. No directory scans.
    if _KERNEL32 is None:
        return None
    try:
        handle = _KERNEL32.CreateFileW(
            str(path), 0, _FILE_SHARE_ALL, None, _OPEN_EXISTING,
            _FILE_FLAG_BACKUP_SEMANTICS, None)
        if handle in (None, _INVALID_HANDLE_VALUE):
            return None
        try:
            buf = ctypes.create_unicode_buffer(1024)
            length = _KERNEL32.GetFinalPathNameByHandleW(handle, buf, 1024, 0)
            if length == 0:
                return None
            if length > 1024:
                buf = ctypes.create_unicode_buffer(length)
                if _KERNEL32.GetFinalPathNameByHandleW(
                        handle, buf, length, 0) == 0:
                    return None
            return _strip_device_prefix(buf.value)
        finally:
            _KERNEL32.CloseHandle(handle)
    except Exception:
        return None


def normalize_repo(repo):
    if not _text(repo):
        raise TaskStoreError("repo must be a nonempty path string")
    if not os.path.isabs(repo):
        raise TaskStoreError("repo must be an absolute path: %r" % (repo,))
    path = os.path.normpath(repo)
    # Existing paths are canonicalized by the filesystem itself, so physical
    # aliases of one worktree cannot register as different repos. Paths that
    # do not exist keep the purely textual normalization (frozen behavior).
    final = _final_path_form(path)
    if final:
        return os.path.normcase(final)
    expanded = _long_path_form(path)
    if expanded:
        path = expanded
    return os.path.normcase(path)


def _require_registration(registration):
    if not isinstance(registration, dict):
        raise TaskStoreError("registration must be an object")
    normalize_repo(registration.get("repo"))
    scopes = registration.get("semantic_scopes")
    if not isinstance(scopes, list) or not scopes or not all(_text(s) for s in scopes):
        raise TaskStoreError("semantic_scopes must be a nonempty string array")
    for name in ("contract_sha256", "policy_sha256"):
        value = registration.get(name)
        if not isinstance(value, str) or _SHA256_RE.fullmatch(value) is None:
            raise TaskStoreError("%s must be a 64-hex digest" % name)
    commit = registration.get("base_commit")
    if not isinstance(commit, str) or _COMMIT_RE.fullmatch(commit) is None:
        raise TaskStoreError("base_commit must be a full commit hash")
    _check_finite_json(registration, "registration")


class TaskStore:
    def __init__(self, root):
        self._root = Path(root)
        if self._root.is_file():
            raise TaskStoreError("root must be a directory: %s" % self._root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._conn = None
        db_path = self._root / DB_FILENAME
        try:
            self._conn = sqlite3.connect(str(db_path), timeout=30.0,
                                         isolation_level=None)
            self._verify_or_create(db_path)
            # Pragmas that write the file header must run only after the
            # schema check, or a fresh empty database looks pre-existing.
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=FULL")
        except BaseException as exc:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
            if isinstance(exc, TaskStoreError):
                raise
            raise TaskStoreError(
                "unusable state database %s: %s" % (db_path, exc)) from exc

    def _existing_tables(self):
        return {row[0] for row in self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}

    def _shape_matches(self):
        # Table names come only from module constants. Constraints matter:
        # matching column names alone cannot guarantee unique task leases.
        return all(
            [tuple(row[1:]) for row in self._conn.execute(
                'PRAGMA table_info("%s")' % table)] == columns
            for table, columns in _SCHEMA_COLUMNS.items())

    def _verify_or_create(self, db_path):
        had_data = db_path.exists() and db_path.stat().st_size > 0
        conn = self._conn
        self._begin(conn)
        try:
            # Serialize validation with creation. A concurrent opener waits
            # for the creator's whole schema; a committed partial schema is
            # foreign/damaged and must never be repaired implicitly.
            found = self._existing_tables()
            if found == _TABLES and self._shape_matches():
                pass
            elif not found and not had_data:
                self._create_schema()
            else:
                raise TaskStoreError(
                    "database %s is not a TaskStore database (tables: %s)"
                    % (db_path, sorted(found)))
            if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise TaskStoreError("corrupt state database: %s" % db_path)
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise

    def _create_schema(self):
        # Caller owns the transaction covering all DDL and validation.
        conn = self._conn
        conn.execute("""CREATE TABLE IF NOT EXISTS registrations (
                task_id TEXT PRIMARY KEY,
                registration TEXT NOT NULL
            )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS events (
                task_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY (task_id, event_id)
            )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS leases (
                task_id TEXT PRIMARY KEY,
                owner_token TEXT NOT NULL,
                repo_norm TEXT NOT NULL,
                scopes_json TEXT NOT NULL,
                acquired_at TEXT NOT NULL
            )""")

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def _connection(self):
        if self._conn is None:
            raise TaskStoreError("store is closed")
        return self._conn

    def _begin(self, conn):
        conn.execute("BEGIN IMMEDIATE")

    # --- registration --------------------------------------------------

    def register(self, task_id, registration):
        _require_task_id(task_id)
        _require_registration(registration)
        canonical = _canonical(registration)
        conn = self._connection()
        self._begin(conn)
        try:
            row = conn.execute(
                "SELECT registration FROM registrations WHERE task_id = ?",
                (task_id,)).fetchone()
            if row is not None:
                conn.execute("ROLLBACK")
                if row[0] != canonical:
                    raise ConflictError(
                        "task %s already registered with a different registration" % task_id)
                return json.loads(row[0])
            conn.execute(
                "INSERT INTO registrations (task_id, registration) VALUES (?, ?)",
                (task_id, canonical))
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        return json.loads(canonical)

    def get(self, task_id):
        _require_task_id(task_id)
        conn = self._connection()
        row = conn.execute(
            "SELECT registration FROM registrations WHERE task_id = ?",
            (task_id,)).fetchone()
        if row is None:
            raise UnknownTaskError("unknown task: %s" % task_id)
        events = [json.loads(payload) for payload in
                  (r[0] for r in conn.execute(
                      "SELECT payload FROM events WHERE task_id = ? ORDER BY rowid",
                      (task_id,)))]
        lease_row = conn.execute(
            "SELECT owner_token, acquired_at FROM leases WHERE task_id = ?",
            (task_id,)).fetchone()
        lease = None
        if lease_row is not None:
            lease = {"task_id": task_id, "owner_token": lease_row[0],
                     "acquired_at": lease_row[1]}
        return {"registration": json.loads(row[0]), "events": events, "lease": lease}

    # --- events --------------------------------------------------------

    def append_event(self, task_id, event):
        _require_task_id(task_id)
        payload = self._validate_event(task_id, event)
        conn = self._connection()
        self._begin(conn)
        try:
            known = conn.execute(
                "SELECT 1 FROM registrations WHERE task_id = ?",
                (task_id,)).fetchone()
            if known is None:
                raise UnknownTaskError("unknown task: %s" % task_id)
            row = conn.execute(
                "SELECT payload FROM events WHERE task_id = ? AND event_id = ?",
                (task_id, event["event_id"])).fetchone()
            if row is not None:
                conn.execute("ROLLBACK")
                if row[0] != payload:
                    raise ConflictError(
                        "event %s of task %s already exists with different content"
                        % (event["event_id"], task_id))
                return False
            conn.execute(
                "INSERT INTO events (task_id, event_id, kind, payload) VALUES (?, ?, ?, ?)",
                (task_id, event["event_id"], event["kind"], payload))
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        return True

    def _validate_event(self, task_id, event):
        if not isinstance(event, dict):
            raise TaskStoreError("event must be an object")
        if not _text(event.get("event_id")):
            raise TaskStoreError("event_id is required")
        if event.get("kind") not in EVENTS:
            raise TaskStoreError("kind must be one of %s" % sorted(EVENTS))
        if event["kind"] in _FAILURE_KINDS and not _text(event.get("failure_fingerprint")):
            raise TaskStoreError("failure_fingerprint required for %s" % event["kind"])
        if "task_id" in event and event["task_id"] != task_id:
            raise TaskStoreError("event task_id does not match %s" % task_id)
        return _canonical(event)

    # --- leases --------------------------------------------------------

    def acquire(self, task_id, owner_token):
        _require_task_id(task_id)
        _require_token(owner_token)
        conn = self._connection()
        self._begin(conn)
        try:
            row = conn.execute(
                "SELECT owner_token FROM leases WHERE task_id = ?",
                (task_id,)).fetchone()
            if row is not None:
                conn.execute("ROLLBACK")
                return row[0] == owner_token
            reg = conn.execute(
                "SELECT registration FROM registrations WHERE task_id = ?",
                (task_id,)).fetchone()
            if reg is None:
                raise UnknownTaskError("unknown task: %s" % task_id)
            registration = json.loads(reg[0])
            my_repo = normalize_repo(registration["repo"])
            my_scopes = set(registration["semantic_scopes"])
            for other, repo_norm, scopes_json in conn.execute(
                    "SELECT task_id, repo_norm, scopes_json FROM leases"):
                if repo_norm == my_repo:
                    conn.execute("ROLLBACK")
                    return False
                if my_scopes.intersection(json.loads(scopes_json)):
                    conn.execute("ROLLBACK")
                    return False
            conn.execute(
                "INSERT INTO leases (task_id, owner_token, repo_norm, scopes_json, acquired_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (task_id, owner_token, my_repo,
                 _canonical(sorted(my_scopes)),
                 datetime.now(timezone.utc).isoformat()))
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        return True

    def release(self, task_id, owner_token):
        _require_task_id(task_id)
        _require_token(owner_token)
        conn = self._connection()
        self._begin(conn)
        try:
            row = conn.execute(
                "SELECT owner_token FROM leases WHERE task_id = ?",
                (task_id,)).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                return
            if row[0] != owner_token:
                conn.execute("ROLLBACK")
                raise ConflictError(
                    "lease of task %s held by a different owner" % task_id)
            conn.execute("DELETE FROM leases WHERE task_id = ?", (task_id,))
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
