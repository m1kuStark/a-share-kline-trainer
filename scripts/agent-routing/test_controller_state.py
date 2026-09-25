"""Behavior tests for controller_state.TaskStore.

Persistent registration, append-only events, and cross-process leases.
Tests run against real SQLite files in TemporaryDirectory fixtures; no
SQLite mocking. Multiprocess contention uses real child processes.
"""
import ctypes
import json
import multiprocessing
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

import controller_state
from controller_state import TaskStore

BASE_COMMIT = "2d1d5d9e7f27eddc9341a549cf7cbda5f68c4d08"
DB_NAME = "controller_state.sqlite3"


def make_registration(repo, scopes=("web_ui",), **overrides):
    reg = {
        "repo": str(repo),
        "semantic_scopes": list(scopes),
        "contract_sha256": "a" * 64,
        "policy_sha256": "b" * 64,
        "base_commit": BASE_COMMIT,
    }
    reg.update(overrides)
    return reg


def make_event(event_id, kind="failure", fingerprint="fp-1", **extra):
    event = {"event_id": event_id, "kind": kind}
    if kind in ("failure", "repair_failed"):
        event["failure_fingerprint"] = fingerprint
    event.update(extra)
    return event


class TaskStoreTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="orch03_state_test_")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo-a"
        self.repo.mkdir()

    def store(self):
        store = TaskStore(self.root)
        self.addCleanup(store.close)
        return store

    # --- registration -------------------------------------------------

    def test_register_then_reopen_reads_identical(self):
        reg = make_registration(self.repo)
        first = self.store()
        stored = first.register("task-1", reg)
        first.close()

        reopened = self.store()
        snapshot = reopened.get("task-1")
        self.assertEqual(snapshot["registration"], reg)
        self.assertEqual(stored, reg)
        self.assertEqual(snapshot["events"], [])
        self.assertIsNone(snapshot["lease"])

    def test_register_identical_is_idempotent_and_keeps_history(self):
        reg = make_registration(self.repo)
        store = self.store()
        store.register("task-1", reg)
        store.append_event("task-1", make_event("e1"))

        again = store.register("task-1", dict(reg))
        self.assertEqual(again, reg)
        self.assertEqual(len(store.get("task-1")["events"]), 1)

    def test_register_changed_pins_rejected_without_reset(self):
        reg = make_registration(self.repo)
        store = self.store()
        store.register("task-1", reg)
        store.append_event("task-1", make_event("e1"))

        mutated = make_registration(self.repo, base_commit="f" * 40)
        with self.assertRaises(ValueError):
            store.register("task-1", mutated)
        snapshot = store.get("task-1")
        self.assertEqual(snapshot["registration"], reg)
        self.assertEqual(len(snapshot["events"]), 1)

    def test_register_rejects_invalid_registration(self):
        store = self.store()
        for bad in (
            make_registration("relative/path"),
            make_registration(self.repo, semantic_scopes=[]),
            make_registration(self.repo, semantic_scopes=["", "x"]),
            make_registration(self.repo, contract_sha256="short"),
            {"repo": str(self.repo)},
            [1, 2, 3],
        ):
            with self.assertRaises(ValueError, msg=repr(bad)):
                store.register("task-9", bad)

    def test_register_rejects_unserializable_and_nonfinite(self):
        store = self.store()
        with self.assertRaises(ValueError):
            store.register("task-9", make_registration(self.repo, extra={"k": {1, 2}}))
        with self.assertRaises(ValueError):
            store.register("task-9", make_registration(self.repo, ratio=float("nan")))

    def test_register_accepts_key_order_insensitive_equality(self):
        reg = make_registration(self.repo)
        store = self.store()
        store.register("task-1", reg)
        reordered = {k: reg[k] for k in reversed(list(reg))}
        self.assertEqual(store.register("task-1", reordered), reg)

    # --- task ids ------------------------------------------------------

    def test_invalid_task_ids_rejected(self):
        store = self.store()
        reg = make_registration(self.repo)
        for bad_id in ("", "../escape", "a/b", "a\\b", "C:evil", "..", ".",
                       "task id", "任务", "x" * 129, None, 7):
            with self.assertRaises(ValueError, msg=repr(bad_id)):
                store.register(bad_id, reg)
            with self.assertRaises(ValueError, msg=repr(bad_id)):
                store.get(bad_id)

    def test_get_unknown_task_is_explicit_error(self):
        store = self.store()
        with self.assertRaises(ValueError):
            store.get("missing-task")

    # --- events --------------------------------------------------------

    def test_append_event_returns_true_and_persists(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        self.assertTrue(store.append_event("task-1", make_event("e1")))
        events = store.get("task-1")["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_id"], "e1")
        self.assertEqual(events[0]["kind"], "failure")

    def test_duplicate_event_is_idempotent(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        event = make_event("e1")
        self.assertTrue(store.append_event("task-1", event))
        self.assertFalse(store.append_event("task-1", dict(event)))
        self.assertFalse(store.append_event(
            "task-1", {"kind": "failure", "failure_fingerprint": "fp-1",
                       "event_id": "e1"}))
        self.assertEqual(len(store.get("task-1")["events"]), 1)

    def test_same_event_id_different_content_rejected(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        store.append_event("task-1", make_event("e1"))
        with self.assertRaises(ValueError):
            store.append_event("task-1", make_event("e1", fingerprint="fp-2"))
        self.assertEqual(len(store.get("task-1")["events"]), 1)

    def test_events_survive_reopen_across_jobs(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        store.append_event("task-1", make_event("f1", kind="failure", fingerprint="same-cause"))
        store.append_event("task-1", make_event("r1", kind="repair_failed", fingerprint="same-cause"))
        store.close()

        reopened = self.store()
        kinds = [(e["event_id"], e["kind"]) for e in reopened.get("task-1")["events"]]
        self.assertEqual(kinds, [("f1", "failure"), ("r1", "repair_failed")])

    def test_event_validation(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        for bad in (
            {"kind": "failure"},
            {"event_id": "e2", "kind": "not_a_kind"},
            {"event_id": "e2", "kind": "failure"},
            {"event_id": "", "kind": "replan"},
            {"event_id": "e2", "kind": "replan", "note": float("inf")},
            "failure",
            {"event_id": "e2", "kind": "failure", "failure_fingerprint": "fp",
             "task_id": "other-task"},
        ):
            with self.assertRaises(ValueError, msg=repr(bad)):
                store.append_event("task-1", bad)

    def test_event_id_may_repeat_across_tasks(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo, scopes=("s1",)))
        store.register("task-2", make_registration(self.root / "repo-b", scopes=("s2",)))
        self.assertTrue(store.append_event("task-1", make_event("shared")))
        self.assertTrue(store.append_event("task-2", make_event("shared")))

    def test_append_event_unknown_task_rejected(self):
        store = self.store()
        with self.assertRaises(ValueError):
            store.append_event("ghost", make_event("e1"))

    # --- leases --------------------------------------------------------

    def test_acquire_release_basic(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        self.assertTrue(store.acquire("task-1", "token-aaa"))
        self.assertEqual(store.get("task-1")["lease"]["owner_token"], "token-aaa")
        self.assertFalse(store.acquire("task-1", "token-bbb"))
        with self.assertRaises(ValueError):
            store.release("task-1", "token-bbb")
        store.release("task-1", "token-aaa")
        self.assertIsNone(store.get("task-1")["lease"])
        self.assertTrue(store.acquire("task-1", "token-bbb"))

    def test_release_without_lease_is_idempotent(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        store.release("task-1", "token-aaa")

    def test_lease_survives_process_restart(self):
        first = self.store()
        first.register("task-1", make_registration(self.repo))
        first.acquire("task-1", "token-crash")
        first.close()  # simulate crash: no release

        reopened = self.store()
        self.assertFalse(reopened.acquire("task-1", "token-new"))
        self.assertFalse(reopened.acquire("task-1", "token-crash" + "-x"))
        # Correct token from a fresh process can still dispose the lease.
        self.assertTrue(reopened.acquire("task-1", "token-crash"))
        reopened.release("task-1", "token-crash")
        self.assertTrue(reopened.acquire("task-1", "token-new"))

    def test_same_repo_tasks_conflict(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo, scopes=("s1",)))
        store.register("task-2", make_registration(self.repo, scopes=("s2",)))
        self.assertTrue(store.acquire("task-1", "token-aaa"))
        self.assertFalse(store.acquire("task-2", "token-bbb"))
        store.release("task-1", "token-aaa")
        self.assertTrue(store.acquire("task-2", "token-bbb"))

    def test_repo_path_normalization_conflict(self):
        store = self.store()
        weird = self.root / "." / "repo-a"
        store.register("task-1", make_registration(weird, scopes=("s1",)))
        store.register("task-2", make_registration(str(self.repo).upper(), scopes=("s2",)))
        self.assertTrue(store.acquire("task-1", "token-aaa"))
        self.assertFalse(store.acquire("task-2", "token-bbb"))

    def test_scope_intersection_conflicts_across_repos(self):
        repo_b = self.root / "repo-b"
        repo_b.mkdir()
        store = self.store()
        store.register("task-1", make_registration(self.repo, scopes=("db", "api")))
        store.register("task-2", make_registration(repo_b, scopes=("api",)))
        self.assertTrue(store.acquire("task-1", "token-aaa"))
        self.assertFalse(store.acquire("task-2", "token-bbb"))

    def test_disjoint_scopes_and_repos_run_in_parallel(self):
        repo_b = self.root / "repo-b"
        repo_b.mkdir()
        store = self.store()
        store.register("task-1", make_registration(self.repo, scopes=("db",)))
        store.register("task-2", make_registration(repo_b, scopes=("web",)))
        self.assertTrue(store.acquire("task-1", "token-aaa"))
        self.assertTrue(store.acquire("task-2", "token-bbb"))

    def test_acquire_unknown_task_rejected(self):
        store = self.store()
        with self.assertRaises(ValueError):
            store.acquire("ghost", "token-aaa")

    def test_invalid_owner_tokens_rejected(self):
        store = self.store()
        store.register("task-1", make_registration(self.repo))
        for bad in ("", "   ", "12345", None, 42, "x" * 257):
            with self.assertRaises(ValueError, msg=repr(bad)):
                store.acquire("task-1", bad)


def _physical_aliases(repo_path):
    """Build aliases that are the same existing directory on disk.

    Each returned alias satisfies os.path.samefile(alias, repo); aliases the
    filesystem cannot produce on this machine (8.3 disabled, mklink denied)
    are silently omitted so the suite stays portable.
    """
    repo = str(repo_path)
    candidates = [
        ("extended", "\\\\?\\" + repo),
        ("upper", repo.upper()),
        ("lower", repo.lower()),
    ]
    short = _short_form(repo)
    if short:
        candidates.append(("short-8.3", short))
    junction = Path(repo).with_name(Path(repo).name + "-junction")
    if _make_junction(junction, repo_path):
        candidates.append(("junction", str(junction)))
    checked = []
    for label, alias in candidates:
        if os.path.normcase(alias) == os.path.normcase(repo):
            continue
        try:
            same = os.path.samefile(alias, repo)
        except OSError:
            same = False
        if same:
            checked.append((label, alias))
    return checked


def _short_form(repo):
    if os.name != "nt":
        return None
    try:
        buf = ctypes.create_unicode_buffer(1024)
        length = ctypes.windll.kernel32.GetShortPathNameW(repo, buf, 1024)
    except Exception:
        return None
    if length == 0 or length > 1024:
        return None
    if os.path.normcase(buf.value) == os.path.normcase(repo):
        return None
    return buf.value


def _make_junction(link, target):
    try:
        # Output bytes stay undecoded: cmd text is locale-encoded.
        done = subprocess.run(
            ["cmd", "/d", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    if done.returncode != 0 or not link.exists():
        return False
    try:
        return os.path.samefile(str(link), str(target))
    except OSError:
        return False


class PhysicalAliasLeaseTest(unittest.TestCase):
    """Aliases of one existing directory must lease as a single repo."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="orch03_alias_test_")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo-a"
        self.repo.mkdir()

    def store(self):
        store = TaskStore(self.root)
        self.addCleanup(store.close)
        return store

    def test_normalize_repo_collapses_physical_aliases(self):
        aliases = _physical_aliases(self.repo)
        self.assertTrue(aliases,
                        "no physical alias could be produced on this machine")
        base = controller_state.normalize_repo(str(self.repo))
        for label, alias in aliases:
            self.assertEqual(
                controller_state.normalize_repo(alias), base,
                msg="alias not collapsed: %s -> %s" % (label, alias))

    def test_alias_of_same_directory_cannot_second_lease(self):
        store = self.store()
        store.register("alias-base",
                       make_registration(self.repo, scopes=("base",)))
        self.assertTrue(store.acquire("alias-base", "alias-token-base"))
        aliases = _physical_aliases(self.repo)
        self.assertTrue(aliases,
                        "no physical alias could be produced on this machine")
        for label, alias in aliases:
            task = "alias-" + label
            store.register(task, make_registration(alias, scopes=(label,)))
            self.assertFalse(
                store.acquire(task, "alias-token-" + label),
                msg="physical alias took a second lease on the same worktree:"
                    " %s -> %s" % (label, alias))

    def test_nonexistent_repo_keeps_frozen_normalization(self):
        ghost = self.root / "never-created"
        dotted = self.root / "." / "never-created"
        self.assertEqual(controller_state.normalize_repo(str(dotted)),
                         controller_state.normalize_repo(str(ghost)))
        self.assertTrue(
            os.path.isabs(controller_state.normalize_repo(str(ghost))))


def _race_worker(root_str, task_id, token, queue):
    store = TaskStore(Path(root_str))
    try:
        queue.put(store.acquire(task_id, token))
    finally:
        store.close()


def _paused_init_creator(root_str, reached, resume, result):
    # Schedule barrier only: pauses the creator once it is executing its
    # second CREATE TABLE statement, whatever statements the schema uses.
    real_connect = sqlite3.connect
    def connect(*args, **kwargs):
        conn = real_connect(*args, **kwargs)
        seen = {"create_tables": 0}
        def trace(sql):
            if "CREATE TABLE" in sql:
                seen["create_tables"] += 1
                if seen["create_tables"] == 2:
                    reached.set()
                    resume.wait(10)
        conn.set_trace_callback(trace)
        return conn
    sqlite3.connect = connect
    try:
        store = TaskStore(Path(root_str))
        store.close()
        result.put("creator_ok")
    except Exception as exc:
        result.put(type(exc).__name__ + ": " + str(exc))


class MultiprocessRaceTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="orch03_race_test_")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo-a"
        self.repo.mkdir()

    def test_exactly_one_process_wins_same_task(self):
        store = TaskStore(self.root)
        store.register("task-1", make_registration(self.repo))
        store.close()

        queue = multiprocessing.Queue()
        tokens = [f"race-token-{i:02d}" for i in range(4)]
        procs = [
            multiprocessing.Process(
                target=_race_worker,
                args=(str(self.root), "task-1", token, queue),
            )
            for token in tokens
        ]
        for proc in procs:
            proc.start()
        results = [queue.get(timeout=60) for _ in procs]
        for proc in procs:
            proc.join(timeout=60)
            self.assertEqual(proc.exitcode, 0)
        self.assertEqual(sum(1 for r in results if r is True), 1)

        winner = TaskStore(self.root)
        try:
            lease = winner.get("task-1")["lease"]
            self.assertIn(lease["owner_token"], tokens)
        finally:
            winner.close()

    def test_exactly_one_process_wins_same_repo(self):
        store = TaskStore(self.root)
        store.register("task-a", make_registration(self.repo, scopes=("s1",)))
        store.register("task-b", make_registration(self.repo, scopes=("s2",)))
        store.close()

        queue = multiprocessing.Queue()
        jobs = [("task-a", "repo-race-token-a"), ("task-b", "repo-race-token-b")]
        procs = [
            multiprocessing.Process(
                target=_race_worker, args=(str(self.root), task, token, queue))
            for task, token in jobs
        ]
        for proc in procs:
            proc.start()
        results = [queue.get(timeout=60) for _ in procs]
        for proc in procs:
            proc.join(timeout=60)
            self.assertEqual(proc.exitcode, 0)
        self.assertEqual(sum(1 for r in results if r is True), 1)

    def test_second_process_opens_during_first_init(self):
        ctx = multiprocessing.get_context("spawn")
        reached = ctx.Event()
        resume = ctx.Event()
        result = ctx.Queue()
        creator = ctx.Process(
            target=_paused_init_creator,
            args=(str(self.root), reached, resume, result))
        creator.start()
        try:
            self.assertTrue(reached.wait(30),
                            "creator never reached its mid-init pause")
            # The creator is mid first-init; opening the same store now must
            # observe a consistent schema, not a partial one.
            second = TaskStore(self.root)
            try:
                second.register("task-1", make_registration(self.repo))
                snapshot = second.get("task-1")
                self.assertEqual(snapshot["registration"]["repo"],
                                 str(self.repo))
            finally:
                second.close()
        finally:
            resume.set()
        self.assertEqual(result.get(timeout=60), "creator_ok")
        creator.join(60)
        self.assertEqual(creator.exitcode, 0)
        final = TaskStore(self.root)
        try:
            self.assertEqual(final.get("task-1")["registration"]["repo"],
                             str(self.repo))
        finally:
            final.close()


class SchemaInitTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="orch03_init_test_")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def _raw_table_names(self):
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            return {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()

    def test_partial_taskstore_schema_is_rejected_without_mutation(self):
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            conn.execute("CREATE TABLE registrations ("
                         "task_id TEXT PRIMARY KEY, registration TEXT NOT NULL)")
            conn.commit()
        finally:
            conn.close()
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()
        self.assertEqual(self._raw_table_names(), {"registrations"})

    def test_same_columns_without_ownership_constraints_rejected(self):
        store = TaskStore(self.root)
        store.close()
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            conn.execute("DROP TABLE leases")
            conn.execute("CREATE TABLE leases (task_id TEXT, owner_token TEXT, "
                         "repo_norm TEXT, scopes_json TEXT, acquired_at TEXT)")
            conn.commit()
        finally:
            conn.close()
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()

    def test_foreign_table_alongside_partial_schema_rejected(self):
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            conn.execute("CREATE TABLE registrations ("
                         "task_id TEXT PRIMARY KEY, registration TEXT NOT NULL)")
            conn.execute("CREATE TABLE intruder (x INTEGER)")
            conn.commit()
        finally:
            conn.close()
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()

    def test_wrong_shaped_taskstore_table_rejected(self):
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            conn.execute("CREATE TABLE registrations (different TEXT)")
            conn.commit()
        finally:
            conn.close()
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()


class CorruptDatabaseTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="orch03_corrupt_test_")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def test_garbage_file_rejected(self):
        (self.root / DB_NAME).write_bytes(b"this is not sqlite at all")
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()

    def test_foreign_sqlite_schema_rejected(self):
        conn = sqlite3.connect(str(self.root / DB_NAME))
        try:
            conn.execute("CREATE TABLE unrelated (x INTEGER)")
            conn.commit()
        finally:
            conn.close()
        with self.assertRaises(ValueError):
            TaskStore(self.root).close()

    def test_missing_root_directory_is_created(self):
        nested = self.root / "control" / "state"
        store = TaskStore(nested)
        try:
            store.register("task-1", make_registration(nested.parent))
            self.assertEqual(store.get("task-1")["registration"]["repo"],
                             str(nested.parent))
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
