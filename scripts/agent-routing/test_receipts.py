import hmac as hmac_mod
import json
import os
import pathlib
import shutil
import tempfile
import threading
import unittest

import receipts


MAX_BYTES = receipts.MAX_RECEIPT_BYTES


class ReceiptsBase(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="receipts-test-"))
        self.store = self.tmp / "store"
        receipts.initialize_store(self.store)
        self.key_hex = (self.store / "hmac_key").read_bytes().decode("ascii")
        self.key = bytes.fromhex(self.key_hex)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def report(self, **overrides):
        value = {
            "run_id": "run-0001",
            "passed": True,
            "base_commit": "a" * 40,
            "score": 3,
            "nested": {"deep": [1, 2, {"x": None}]},
        }
        value.update(overrides)
        return value

    def sign(self, report_dict):
        payload = json.dumps(
            report_dict, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
        return hmac_mod.new(self.key, payload, "sha256").hexdigest()

    def issue(self, report_dict=None):
        report_dict = report_dict if report_dict is not None else self.report()
        return receipts.issue_receipt(self.store, report_dict)

    def read_envelope(self, path):
        return json.loads(pathlib.Path(path).read_bytes().decode("utf-8"))

    def write_envelope(self, name, envelope):
        path = self.store / "receipts" / name
        path.write_bytes(json.dumps(
            envelope, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8"))
        return path


class InitializeStoreTests(ReceiptsBase):
    def test_creates_receipts_dir_and_32byte_key(self):
        self.assertTrue((self.store / "receipts").is_dir())
        self.assertEqual(32, len(self.key))

    def test_reinit_keeps_same_key(self):
        before = (self.store / "hmac_key").read_bytes()
        receipts.initialize_store(self.store)
        self.assertEqual(before, (self.store / "hmac_key").read_bytes())

    def test_two_stores_get_independent_keys(self):
        other = self.tmp / "store2"
        receipts.initialize_store(other)
        other_hex = (other / "hmac_key").read_bytes().decode("ascii")
        self.assertNotEqual(self.key_hex, other_hex)

    def test_concurrent_reinit_does_not_rotate_key(self):
        before = (self.store / "hmac_key").read_bytes()
        errors = []

        def run():
            try:
                receipts.initialize_store(self.store)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=run) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual([], errors)
        self.assertEqual(before, (self.store / "hmac_key").read_bytes())

    def test_concurrent_fresh_init_yields_one_valid_key(self):
        fresh = self.tmp / "store-fresh"
        errors = []

        def run():
            try:
                receipts.initialize_store(fresh)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=run) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        data = (fresh / "hmac_key").read_bytes()
        self.assertEqual(64, len(data))
        bytes.fromhex(data.decode("ascii"))
        self.assertTrue((fresh / "receipts").is_dir())

    def test_invalid_existing_key_fails_explicitly(self):
        broken = self.tmp / "store-broken"
        broken.mkdir()
        (broken / "receipts").mkdir()
        (broken / "hmac_key").write_bytes(b"short")
        with self.assertRaises(receipts.StoreError):
            receipts.initialize_store(broken)
        self.assertEqual(b"short", (broken / "hmac_key").read_bytes())


class IssueReceiptTests(ReceiptsBase):
    def test_envelope_shape_and_canonical_roundtrip(self):
        report_dict = self.report()
        path = self.issue(report_dict)
        self.assertEqual(
            self.store / "receipts" / "run-0001.json", pathlib.Path(path))
        raw = path.read_bytes()
        envelope = json.loads(raw.decode("utf-8"))
        self.assertEqual(
            {"schema_version", "report", "signature"}, set(envelope.keys()))
        self.assertTrue(type(envelope["schema_version"]) is int)
        self.assertEqual(1, envelope["schema_version"])
        canonical = json.dumps(
            envelope["report"], sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.assertEqual(canonical, json.dumps(
            report_dict, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8"))
        self.assertEqual(
            self.sign(report_dict).encode("ascii"),
            envelope["signature"].encode("ascii"))

    def test_receipt_file_is_canonical_bytes(self):
        report_dict = self.report(run_id="canon-1", note="值")
        path = self.issue(report_dict)
        expected_bytes = json.dumps(
            {"schema_version": 1, "report": report_dict,
             "signature": self.sign(report_dict)},
            sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.assertEqual(expected_bytes, path.read_bytes())
        self.assertIn("值".encode("utf-8"), path.read_bytes())

    def test_duplicate_run_id_rejected_and_original_preserved(self):
        original = self.report()
        path = self.issue(original)
        raw_before = path.read_bytes()
        with self.assertRaises(receipts.DuplicateReceiptError):
            self.issue(self.report(passed=False))
        self.assertEqual(raw_before, path.read_bytes())

    def test_unsafe_run_ids_rejected(self):
        bad_ids = ["", "..", ".", "../escape", "a/b", r"a\\b", "a b", "a\nb",
                   "CON", "nul", "aux", "com1", "运行", ".hidden", "-lead",
                   "a" * 65]
        for run_id in bad_ids:
            with self.subTest(run_id=run_id):
                with self.assertRaises(receipts.InvalidRunIdError):
                    self.issue(self.report(run_id=run_id))

    def test_report_without_run_id_rejected(self):
        with self.assertRaises(receipts.InvalidRunIdError):
            self.issue({"passed": True})

    def test_non_dict_report_rejected(self):
        with self.assertRaises(receipts.ReceiptError):
            self.issue([1, 2, 3])

    def test_nan_report_rejected_and_no_file_written(self):
        with self.assertRaises(receipts.ReceiptError):
            self.issue(self.report(run_id="nan-1", score=float("nan")))
        self.assertFalse((self.store / "receipts" / "nan-1.json").exists())

    def test_write_failure_raises_receipt_error_not_fderror(self):
        from unittest import mock
        with mock.patch.object(receipts.os, "fsync",
                               side_effect=OSError("disk full")):
            with self.assertRaises(receipts.ReceiptError):
                self.issue()

    def test_non_serializable_report_rejected(self):
        with self.assertRaises(receipts.ReceiptError):
            self.issue(self.report(run_id="set-1", extra={1, 2}))

    def test_oversized_report_rejected(self):
        with self.assertRaises(receipts.ReceiptError):
            self.issue(self.report(run_id="big-1", pad="x" * (MAX_BYTES + 1)))

    def test_concurrent_same_id_single_winner(self):
        results = []
        errors = []

        def run(tag):
            try:
                results.append((tag, self.issue(
                    self.report(run_id="race-1", winner=tag))))
            except receipts.DuplicateReceiptError:
                errors.append(tag)

        threads = [threading.Thread(target=run, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(1, len(results))
        self.assertEqual(3, len(errors))
        path = self.store / "receipts" / "race-1.json"
        envelope = self.read_envelope(path)
        self.assertEqual(
            results[0][1], path,
            "winner path should match the preserved file")
        self.assertEqual(
            results[0][0], envelope["report"]["winner"],
            "preserved file must be the single successful write")

    def test_issue_requires_initialized_store(self):
        empty = self.tmp / "store-empty"
        empty.mkdir()
        with self.assertRaises(receipts.StoreError):
            receipts.issue_receipt(empty, self.report(run_id="no-key"))


class VerifyReceiptTests(ReceiptsBase):
    def test_verify_returns_report(self):
        report_dict = self.report()
        path = self.issue(report_dict)
        out = receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})
        self.assertEqual(report_dict, out)

    def test_verify_accepts_str_and_path(self):
        path = self.issue()
        out = receipts.verify_receipt(
            str(self.store), str(path), {"run_id": "run-0001"})
        self.assertEqual("run-0001", out["run_id"])

    def test_tampered_body_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["report"]["score"] = 4
        raw = path.read_bytes()
        path.write_bytes(json.dumps(
            envelope, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8"))
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})
        self.assertNotEqual(raw, path.read_bytes())

    def test_tampered_nested_body_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["report"]["nested"]["deep"][2]["x"] = "changed"
        path.write_bytes(json.dumps(
            envelope, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8"))
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_tampered_passed_field_rejected(self):
        path = self.issue(self.report(passed=True))
        envelope = self.read_envelope(path)
        envelope["report"]["passed"] = False
        path.write_bytes(json.dumps(
            envelope, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8"))
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"passed": True})

    def test_forged_signature_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["signature"] = "0" * 64
        path = self.write_envelope("run-0001.json", envelope)
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_signature_from_wrong_key_rejected(self):
        other = self.tmp / "store-other"
        receipts.initialize_store(other)
        report_dict = self.report(run_id="cross-1")
        payload = json.dumps(
            report_dict, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
        other_key = bytes.fromhex(
            (other / "hmac_key").read_bytes().decode("ascii"))
        bad_sig = hmac_mod.new(other_key, payload, "sha256").hexdigest()
        path = self.write_envelope(
            "cross-1.json",
            {"schema_version": 1, "report": report_dict, "signature": bad_sig})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"run_id": "cross-1"})

    def test_verify_against_wrong_store_rejected(self):
        other = self.tmp / "store-other2"
        receipts.initialize_store(other)
        path = self.issue(self.report(run_id="cross-2"))
        with self.assertRaises(receipts.ReceiptError):
            receipts.verify_receipt(other, path, {"run_id": "cross-2"})

    def test_replay_with_different_expected_rejected(self):
        path = self.issue(self.report(base_commit="a" * 40))
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(
                self.store, path, {"base_commit": "b" * 40})

    def test_empty_expected_rejected(self):
        path = self.issue()
        with self.assertRaises(receipts.ReceiptError):
            receipts.verify_receipt(self.store, path, {})

    def test_non_dict_expected_rejected(self):
        path = self.issue()
        with self.assertRaises(receipts.ReceiptError):
            receipts.verify_receipt(self.store, path, ["run_id"])

    def test_expected_missing_field_rejected(self):
        path = self.issue()
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"absent": 1})

    def test_expected_null_and_bool_exact_match(self):
        report_dict = self.report(flag=None, other=False)
        path = self.issue(report_dict)
        out = receipts.verify_receipt(self.store, path, {"flag": None})
        self.assertIsNone(out["flag"])
        receipts.verify_receipt(self.store, path, {"other": False})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"flag": False})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"other": None})

    def test_expected_bool_int_distinction(self):
        report_dict = self.report(passed=True, count=1)
        path = self.issue(report_dict)
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"passed": 1})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"count": True})

    def test_expected_int_float_distinction(self):
        report_dict = self.report(score=3, ratio=1.5)
        path = self.issue(report_dict)
        receipts.verify_receipt(self.store, path, {"score": 3, "ratio": 1.5})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"score": 3.0})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(self.store, path, {"ratio": 1})

    def test_expected_nested_dict_exact(self):
        report_dict = self.report(nested={"a": 1}, plain=True)
        path = self.issue(report_dict)
        receipts.verify_receipt(self.store, path, {"nested": {"a": 1}})
        with self.assertRaises(receipts.VerificationError):
            receipts.verify_receipt(
                self.store, path, {"nested": {"a": 1, "b": 2}})

    def test_missing_envelope_field_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        del envelope["signature"]
        path = self.write_envelope("run-0001.json", envelope)
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_extra_envelope_field_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["extra"] = 1
        path = self.write_envelope("run-0001.json", envelope)
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_unknown_schema_version_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["schema_version"] = 2
        path = self.write_envelope("run-0001.json", envelope)
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_schema_version_bool_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["schema_version"] = True
        path = self.write_envelope("run-0001.json", envelope)
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_report_run_id_must_match_filename(self):
        path = self.issue(self.report(run_id="name-1"))
        envelope = self.read_envelope(path)
        envelope["report"]["run_id"] = "other-1"
        bad_sig = "0" * 64
        path = self.write_envelope(
            "name-1.json",
            {"schema_version": 1, "report": envelope["report"],
             "signature": bad_sig})
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_duplicate_json_key_rejected(self):
        path = self.store / "receipts" / "dup.json"
        path.write_bytes(
            b'{"report":{"a":1,"a":2,"run_id":"dup"},'
            b'"schema_version":1,"signature":"' + b"0" * 64 + b'"}')
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_nan_literal_rejected(self):
        path = self.store / "receipts" / "nanfile.json"
        path.write_bytes(
            b'{"report":{"run_id":"nanfile","score":NaN},'
            b'"schema_version":1,"signature":"' + b"0" * 64 + b'"}')
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_infinity_overflow_rejected(self):
        path = self.issue()
        envelope = self.read_envelope(path)
        envelope["report"]["score"] = 1e400
        raw = json.dumps(
            envelope, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=True).encode("utf-8")
        path.write_bytes(raw)
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_garbage_file_rejected(self):
        path = self.store / "receipts" / "garbage.json"
        path.write_bytes(b"not json at all")
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_missing_file_rejected(self):
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(
                self.store, self.store / "receipts" / "absent.json",
                {"run_id": "absent"})

    def test_receipt_is_directory_rejected(self):
        target = self.store / "receipts" / "adir.json"
        target.mkdir()
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, target, {"a": 1})

    def test_oversized_receipt_file_rejected(self):
        path = self.store / "receipts" / "huge.json"
        path.write_bytes(b"x" * (MAX_BYTES + 1))
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})

    def test_path_outside_receipts_rejected(self):
        path = self.issue()
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, self.store / "hmac_key",
                                    {"run_id": "run-0001"})
        outside = self.tmp / "outside.json"
        outside.write_bytes(path.read_bytes())
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, outside, {"run_id": "run-0001"})
        parent = self.store / "receipts" / ".." / "hmac_key"
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, parent,
                                    {"run_id": "run-0001"})

    def test_bad_filename_run_id_rejected(self):
        for name in ["a b.json", "..json", "con.json", ".hidden.json"]:
            target = self.store / "receipts" / name
            target.write_bytes(b"{}")
            with self.subTest(name=name):
                with self.assertRaises(receipts.InvalidReceiptError):
                    receipts.verify_receipt(self.store, target, {"a": 1})

    def test_error_messages_do_not_contain_key(self):
        path = self.issue()
        failures = []
        for call in [
            lambda: receipts.verify_receipt(self.store, path, {"nope": 1}),
            lambda: receipts.verify_receipt(
                self.store, self.store / "receipts" / "absent.json", {}),
            lambda: receipts.issue_receipt(self.store, self.report()),
        ]:
            try:
                call()
            except receipts.ReceiptError as exc:
                failures.append(str(exc))
        joined = " | ".join(failures)
        self.assertNotIn(self.key_hex, joined)
        self.assertNotIn(self.key.hex(), joined)

    def test_broken_key_file_fails_explicitly(self):
        path = self.issue()
        key_path = self.store / "hmac_key"
        key_path.write_bytes(b"00")
        with self.assertRaises(receipts.StoreError):
            receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})


class JunctionWriteEscapeTests(ReceiptsBase):
    """junction不需要管理员；与symlink无关，本类不可用即整类跳过并如实上报。"""

    @classmethod
    def _create_junction(cls, link, target):
        try:
            import _winapi
        except ImportError:
            _winapi = None
        if _winapi is not None and hasattr(_winapi, "CreateJunction"):
            _winapi.CreateJunction(str(target), str(link))
            return
        import subprocess
        proc = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True)
        if proc.returncode != 0:
            raise OSError(proc.stderr.decode("gbk", "replace"))

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        probe = tempfile.mkdtemp(prefix="junction-probe-")
        try:
            target = os.path.join(probe, "t")
            link = os.path.join(probe, "l")
            os.mkdir(target)
            cls._create_junction(link, target)
            if not os.path.isdir(link):
                raise OSError("junction不可见")
        except Exception:
            raise unittest.SkipTest(
                "junction不可用：写越界回归未验证，不得视为已通过")
        finally:
            if os.path.lexists(os.path.join(probe, "l")):
                os.rmdir(os.path.join(probe, "l"))
            shutil.rmtree(probe, ignore_errors=True)

    def _remove_junction(self, link):
        if os.path.lexists(str(link)):
            os.rmdir(str(link))

    def test_issue_refuses_junction_receipts_dir_and_writes_nothing_outside(self):
        receipts_dir = self.store / "receipts"
        outside = self.tmp / "outside-box"
        outside.mkdir()
        os.rmdir(str(receipts_dir))
        try:
            self._create_junction(receipts_dir, outside)
            with self.assertRaises(receipts.StoreError):
                self.issue()
            self.assertEqual([], list(outside.iterdir()))
        finally:
            self._remove_junction(receipts_dir)

    def test_initialize_refuses_junction_receipts_dir(self):
        store2 = self.tmp / "store-junction"
        store2.mkdir()
        outside2 = self.tmp / "outside-box2"
        outside2.mkdir()
        link = store2 / "receipts"
        try:
            self._create_junction(link, outside2)
            with self.assertRaises(receipts.StoreError):
                receipts.initialize_store(store2)
            self.assertEqual([], list(outside2.iterdir()))
            self.assertFalse((store2 / "hmac_key").exists())
        finally:
            self._remove_junction(link)

    def test_verify_refuses_junction_receipts_dir(self):
        path = self.issue()
        raw = path.read_bytes()
        receipts_dir = self.store / "receipts"
        outside = self.tmp / "outside-box3"
        outside.mkdir()
        (outside / "run-0001.json").write_bytes(raw)
        (receipts_dir / "run-0001.json").unlink()
        os.rmdir(str(receipts_dir))
        try:
            self._create_junction(receipts_dir, outside)
            with self.assertRaises(receipts.ReceiptError):
                receipts.verify_receipt(
                    self.store, path, {"run_id": "run-0001"})
        finally:
            self._remove_junction(receipts_dir)


class KeyPermissionTests(ReceiptsBase):
    @unittest.skipIf(os.name != "posix", "0600权限仅在POSIX可观测")
    def test_key_file_mode_is_0600_on_posix(self):
        mode = (self.store / "hmac_key").stat().st_mode & 0o777
        self.assertEqual(0o600, mode)


class LinkResistanceTests(ReceiptsBase):
    def _symlink_supported(self):
        probe = self.tmp / "probe-link"
        try:
            os.symlink(str(self.tmp / "probe-target"), str(probe))
        except (OSError, NotImplementedError):
            return False
        finally:
            if probe.is_symlink():
                probe.unlink()
        return True

    def setUp(self):
        super().setUp()
        if not self._symlink_supported():
            self.skipTest("symlink creation not available")

    def test_symlinked_receipt_rejected(self):
        path = self.issue()
        external = self.tmp / "external.json"
        external.write_bytes(path.read_bytes())
        link = self.store / "receipts" / "linked.json"
        os.symlink(str(external), str(link))
        with self.assertRaises(receipts.InvalidReceiptError):
            receipts.verify_receipt(self.store, link, {"run_id": "run-0001"})

    def test_symlinked_key_rejected(self):
        path = self.issue()
        key_path = self.store / "hmac_key"
        real = self.tmp / "real-key-backup"
        key_path.rename(real)
        try:
            os.symlink(str(real), str(key_path))
            with self.assertRaises(receipts.StoreError):
                receipts.verify_receipt(self.store, path, {"run_id": "run-0001"})
        finally:
            if key_path.is_symlink():
                key_path.unlink()
            real.rename(key_path)


if __name__ == "__main__":
    unittest.main()
