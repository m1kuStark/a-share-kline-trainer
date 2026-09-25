"""控制层收据：规范JSON + HMAC认证 + 不可覆盖写入 + expected绑定。

边界：本模块只认证"这份report由持key方在 receipts/<run_id>.json 签发一次"，
不解释report语义（如passed），也不抵抗能读取key的恶意同用户进程。
key由调用方专用本机目录持有，initialize_store只创建不轮换；任何失败路径
都不输出key内容。运行目录/日志路径等身份绑定由report内容与expected完成。
"""

import hmac
import json
import os
import pathlib
import re
import secrets
import stat
import threading
import time
import typing

SCHEMA_VERSION = 1
KEY_FILENAME = "hmac_key"
KEY_HEX_LENGTH = 64
KEY_BYTES = 32
RECEIPTS_DIRNAME = "receipts"
MAX_RECEIPT_BYTES = 1024 * 1024
_KEY_INIT_TIMEOUT_SECONDS = 5.0
_KEY_INIT_RETRY_SECONDS = 0.05

_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
# run_id会成为Windows文件名主干，设备保留名即使带.json后缀也不可创建。
_RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL"]
    + ["COM%d" % i for i in range(0, 10)]
    + ["LPT%d" % i for i in range(0, 10)])
_RECEIPT_NAME_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.json$")

_OPEN_EXCLUSIVE = os.O_WRONLY | os.O_CREAT | os.O_EXCL
if os.name == "nt":
    _OPEN_EXCLUSIVE |= getattr(os, "O_BINARY", 0) | getattr(os, "O_NOINHERIT", 0)
else:
    _OPEN_EXCLUSIVE |= getattr(os, "O_CLOEXEC", 0)


class ReceiptError(Exception):
    """收据模块统一错误基类。"""


class StoreError(ReceiptError):
    """store未初始化、key缺失或无法可靠确认。"""


class InvalidRunIdError(ReceiptError):
    """run_id不是安全的文件名ID。"""


class DuplicateReceiptError(ReceiptError):
    """同run_id收据已存在，原件未改动。"""


class InvalidReceiptError(ReceiptError):
    """收据文件结构、编码、路径或版本不合法。"""


class VerificationError(ReceiptError):
    """签名或expected绑定不匹配。"""


def _fspath(value):
    return pathlib.Path(os.fspath(value))


def _check_run_id(run_id):
    if type(run_id) is not str or not _RUN_ID_RE.match(run_id):
        raise InvalidRunIdError("run_id必须是[A-Za-z0-9]开头的安全文件名ID")
    if run_id.split(".")[0].upper() in _RESERVED_NAMES:
        raise InvalidRunIdError("run_id命中Windows设备保留名")


def canonical_report_bytes(report):
    """worker contract同款规范JSON：sort_keys、紧凑分隔、UTF-8、禁NaN。"""
    try:
        return json.dumps(
            report, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ReceiptError("report不是可规范化的JSON: %s" % exc) from exc


def _reject_constant(name):
    raise InvalidReceiptError("收据含非法数值常量: %s" % name)


def _reject_duplicate_pairs(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise InvalidReceiptError("收据含重复JSON键: %s" % key)
        seen[key] = value
    return seen


def parse_receipt_json(data):
    """严格解析：拒绝重复键、NaN/Infinity与无效UTF-8。"""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidReceiptError("收据不是有效UTF-8: %s" % exc) from exc
    try:
        return json.loads(
            text, object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_constant)
    except json.JSONDecodeError as exc:
        raise InvalidReceiptError("收据不是有效JSON: %s" % exc) from exc


def _lstat_or_fail(path, label, error_cls):
    try:
        return os.lstat(path)
    except OSError as exc:
        raise error_cls("%s不可访问: %s" % (label, exc.strerror or exc)) from exc


def _reject_link_component(st, label, error_cls):
    """symlink与Windows junction都是reparse point，按lstat逐组件拒绝。"""
    if stat.S_ISLNK(st.st_mode):
        raise error_cls("%s是symlink" % label)
    if os.name == "nt" and getattr(st, "st_file_attributes", 0) \
            & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise error_cls("%s是reparse point(junction)" % label)


def _realpath_is_self(path, label, error_cls):
    """store之下不应再出现短名/别名重定向；出现即按链接处理。"""
    if os.path.normcase(os.path.realpath(path)) != os.path.normcase(path):
        raise error_cls("%s路径含链接或别名重定向" % label)


def _reject_if_regular_file_missing(st, label):
    if not stat.S_ISREG(st.st_mode):
        raise InvalidReceiptError("%s不是常规文件" % label)


def _read_bounded(path, limit, label, error_cls):
    size = getattr(_lstat_or_fail(path, label, error_cls), "st_size", None)
    if size is not None and size > limit:
        raise error_cls("%s超过大小上限%d字节" % (label, limit))
    try:
        with open(path, "rb") as handle:
            data = handle.read(limit + 1)
    except OSError as exc:
        raise error_cls("%s读取失败: %s" % (label, exc.strerror or exc)) from exc
    if len(data) > limit:
        raise error_cls("%s超过大小上限%d字节" % (label, limit))
    return data


def _store_anchor(store):
    """锚点取store的最终真实路径；8.3短名是别名不是链接，允许在锚点之上。"""
    return os.path.realpath(str(_fspath(store)))


def _load_key(store):
    """读取并校验key：store下无链接组件、恰64个hex字符、还原出32字节。"""
    path = os.path.join(_store_anchor(store), KEY_FILENAME)
    st = _lstat_or_fail(path, "key", StoreError)
    if not stat.S_ISREG(st.st_mode):
        raise StoreError("key不是常规文件")
    _reject_link_component(st, "key", StoreError)
    _realpath_is_self(path, "key", StoreError)
    data = _read_bounded(path, KEY_HEX_LENGTH, "key", StoreError)
    if len(data) != KEY_HEX_LENGTH:
        raise StoreError("key无法可靠确认: 长度%d不是%d" % (
            len(data), KEY_HEX_LENGTH))
    try:
        key = bytes.fromhex(data.decode("ascii"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise StoreError("key无法可靠确认: 不是有效hex") from exc
    if len(key) != KEY_BYTES:
        raise StoreError("key无法可靠确认: 还原后不是%d字节" % KEY_BYTES)
    return key


def _write_exclusive(path, data, exists_error, mode=0o600):
    """O_EXCL独占创建。fdopen成功后fd归其所有，失败路径不得再手动close，
    否则close已关闭fd的EBADF会顶掉真实错误。"""
    try:
        fd = os.open(path, _OPEN_EXCLUSIVE, mode)
    except FileExistsError as exc:
        raise exists_error from exc
    except OSError as exc:
        raise ReceiptError("独占创建失败: %s" % (exc.strerror or exc)) from exc
    try:
        handle = os.fdopen(fd, "wb")
    except OSError as exc:
        os.close(fd)
        raise ReceiptError("独占创建失败: %s" % (exc.strerror or exc)) from exc
    try:
        with handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise ReceiptError("独占写入失败: %s" % (exc.strerror or exc)) from exc
    try:
        with open(path, "rb") as check:
            readback = check.read(len(data) + 1)
    except OSError as exc:
        raise ReceiptError("写入后回读失败: %s" % (exc.strerror or exc)) from exc
    if readback != data:
        raise ReceiptError("写入后回读不一致")


def _receipts_dir_path(store):
    return os.path.join(_store_anchor(store), RECEIPTS_DIRNAME)


def _ensure_receipts_dir(store):
    """写读两侧共用的receipts守卫：必须是store下的真实目录，
    拒绝junction/symlink（写穿链接会把收据落到store之外）。"""
    path = _receipts_dir_path(store)
    try:
        st = os.lstat(path)
    except FileNotFoundError as exc:
        raise StoreError("receipts目录不存在，先initialize_store") from exc
    except OSError as exc:
        raise StoreError(
            "receipts目录不可访问: %s" % (exc.strerror or exc)) from exc
    if not stat.S_ISDIR(st.st_mode):
        raise StoreError("receipts不是目录")
    _reject_link_component(st, "receipts目录", StoreError)
    _realpath_is_self(path, "receipts目录", StoreError)
    return path


def initialize_store(store: typing.Union[str, os.PathLike]) -> None:
    """在专用本机目录创建receipts目录与32字节HMAC key；重复初始化不轮换。"""
    root = _fspath(store)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise StoreError("store目录创建失败: %s" % (exc.strerror or exc)) from exc
    try:
        os.mkdir(_receipts_dir_path(store))
    except FileExistsError:
        pass
    except OSError as exc:
        raise StoreError(
            "receipts目录创建失败: %s" % (exc.strerror or exc)) from exc
    _ensure_receipts_dir(store)
    path = os.path.join(_store_anchor(store), KEY_FILENAME)
    key_hex = secrets.token_bytes(KEY_BYTES).hex().encode("ascii")
    try:
        _write_exclusive(path, key_hex, FileExistsError(), mode=0o600)
    except FileExistsError:
        # 已有key：并发创建方可能仍在写入，重试读取到可靠确认为止。
        deadline = time.monotonic() + _KEY_INIT_TIMEOUT_SECONDS
        while True:
            try:
                _load_key(store)
                return
            except StoreError:
                if time.monotonic() >= deadline:
                    raise StoreError(
                        "key无法可靠确认，初始化失败且未改动现有key") from None
                time.sleep(_KEY_INIT_RETRY_SECONDS)
    _load_key(store)


def issue_receipt(
        store: typing.Union[str, os.PathLike], report: dict) -> pathlib.Path:
    """按report.run_id在receipts内独占写入一条签名收据，返回收据路径。"""
    if not isinstance(report, dict):
        raise ReceiptError("report必须是dict")
    _check_run_id(report.get("run_id"))
    payload = canonical_report_bytes(report)
    key = _load_key(store)
    signature = hmac.new(key, payload, "sha256").hexdigest()
    envelope = {
        "schema_version": SCHEMA_VERSION,
        "report": report,
        "signature": signature,
    }
    data = canonical_report_bytes(envelope)
    if len(data) > MAX_RECEIPT_BYTES:
        raise ReceiptError("收据超过大小上限%d字节" % MAX_RECEIPT_BYTES)
    receipts_path = _ensure_receipts_dir(store)
    path = os.path.join(
        receipts_path, "%s.json" % report["run_id"])
    _write_exclusive(
        path, data,
        DuplicateReceiptError("run_id已存在，收据未覆盖: %s" % report["run_id"]))
    # 以调用方传入的store路径形式返回（与锚点是同一目录），便于原样回传verify。
    return _fspath(store) / RECEIPTS_DIRNAME / ("%s.json" % report["run_id"])


def _parse_envelope(data):
    envelope = parse_receipt_json(data)
    if not isinstance(envelope, dict):
        raise InvalidReceiptError("收据envelope必须是JSON对象")
    if set(envelope.keys()) != {"schema_version", "report", "signature"}:
        raise InvalidReceiptError("收据envelope字段集不符")
    version = envelope["schema_version"]
    if type(version) is not int or version != SCHEMA_VERSION:
        raise InvalidReceiptError("不支持的收据schema_version: %r" % (version,))
    if not isinstance(envelope["report"], dict):
        raise InvalidReceiptError("收据report必须是JSON对象")
    if type(envelope["signature"]) is not str:
        raise InvalidReceiptError("收据signature必须是hex字符串")
    return envelope


def _resolve_receipt_path(store, receipt_path):
    """限定收据必须位于store/receipts内、文件名即安全run_id、无链接组件。"""
    receipts_dir = _ensure_receipts_dir(store)
    raw = os.path.abspath(os.fspath(receipt_path))
    match = _RECEIPT_NAME_RE.match(os.path.basename(raw))
    if not match or not _RUN_ID_RE.match(match.group(1)) or \
            match.group(1).split(".")[0].upper() in _RESERVED_NAMES:
        raise InvalidReceiptError("收据文件名不是<安全run_id>.json")
    if os.path.normcase(os.path.realpath(os.path.dirname(raw))) \
            != os.path.normcase(receipts_dir):
        raise InvalidReceiptError("收据路径不在store/receipts内")
    st = _lstat_or_fail(raw, "收据", InvalidReceiptError)
    _reject_if_regular_file_missing(st, "收据")
    _reject_link_component(st, "收据", InvalidReceiptError)
    expected_self = os.path.join(receipts_dir, match.group(1) + ".json")
    if os.path.normcase(os.path.realpath(raw)) \
            != os.path.normcase(expected_self):
        raise InvalidReceiptError("收据路径含链接或别名重定向")
    return raw, match.group(1)


def verify_receipt(
        store: typing.Union[str, os.PathLike],
        receipt_path: typing.Union[str, os.PathLike],
        expected: dict) -> dict:
    """从store实际文件验证收据：HMAC认证并逐字段精确绑定expected。"""
    if not isinstance(expected, dict) or not expected:
        raise ReceiptError("expected必须是非空dict")
    raw, run_id = _resolve_receipt_path(store, receipt_path)
    data = _read_bounded(raw, MAX_RECEIPT_BYTES, "收据", InvalidReceiptError)
    envelope = _parse_envelope(data)
    report = envelope["report"]
    inner_run_id = report.get("run_id")
    _check_run_id(inner_run_id)
    if inner_run_id != run_id:
        raise InvalidReceiptError("report.run_id与收据文件名不一致")
    try:
        payload = canonical_report_bytes(report)
    except ReceiptError as exc:
        raise InvalidReceiptError(str(exc)) from exc
    key = _load_key(store)
    computed = hmac.new(key, payload, "sha256").hexdigest()
    supplied = envelope["signature"].lower()
    if len(supplied) != KEY_HEX_LENGTH or \
            any(c not in "0123456789abcdef" for c in supplied):
        raise InvalidReceiptError("收据signature不是64位hex")
    if not hmac.compare_digest(computed.encode("ascii"),
                               supplied.encode("ascii")):
        raise VerificationError("HMAC签名不匹配")
    for field, wanted in expected.items():
        if field not in report:
            raise VerificationError("expected字段缺失: %s" % (field,))
        if not _strict_equal(report[field], wanted):
            raise VerificationError(
                "expected字段不精确相等: %s" % (field,))
    return report


def _strict_equal(left, right):
    """JSON级精确相等：区分bool/int、int/float、null与缺失由调用方先查。"""
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) \
            and left is right
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left.keys()) == set(right.keys()) and all(
            _strict_equal(left[k], right[k]) for k in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _strict_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return type(left) is type(right) and left == right
    return type(left) is type(right) and left == right


__all__ = [
    "SCHEMA_VERSION", "MAX_RECEIPT_BYTES", "ReceiptError", "StoreError",
    "InvalidRunIdError", "DuplicateReceiptError", "InvalidReceiptError",
    "VerificationError", "initialize_store", "issue_receipt",
    "verify_receipt", "canonical_report_bytes",
]
