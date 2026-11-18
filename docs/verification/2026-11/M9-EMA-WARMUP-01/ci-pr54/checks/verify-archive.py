import base64
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path


root = Path(__file__).resolve().parents[1]
repo = root.parents[4]
archive = root / "ci-capture"
digest = lambda value: hashlib.sha256(value).hexdigest()
conversion = json.loads((root / "storage-conversion.json").read_text(encoding="utf-8"))
stored_paths = {row["sourcePath"]: row for row in conversion["rows"]}


def original_bytes(relative):
    if relative not in stored_paths:
        return (root / relative).read_bytes()
    row = stored_paths[relative]
    stored = (root / row["storedPath"]).read_bytes()
    assert len(stored) == row["storedBytes"] and digest(stored) == row["storedSha256"], relative
    raw = base64.b64decode(stored.strip(), validate=True)
    assert len(raw) == row["sourceBytes"] and digest(raw) == row["sourceSha256"], relative
    return raw


receipt = json.loads((root / "copy-receipt.json").read_text(encoding="utf-8"))
source = Path(receipt["sourceDirectory"])
reverse_paths = {row["storedPath"]: row["sourcePath"] for row in conversion["rows"]}
actual_files = sorted(reverse_paths.get(path.relative_to(root).as_posix(), path.relative_to(root).as_posix()).removeprefix("ci-capture/")
                      for path in archive.rglob("*") if path.is_file())
expected_files = sorted(row["sourceRelativePath"] for row in receipt["files"])
assert actual_files == expected_files, "Archive file set changed"

for row in receipt["files"]:
    local = original_bytes(row["archiveRelativePath"])
    original = (source / row["sourceRelativePath"]).read_bytes()
    assert local == original, row["sourceRelativePath"]
    assert len(local) == row["bytes"], row["sourceRelativePath"]
    assert digest(local) == row["sourceSha256"] == row["archiveSha256"], row["sourceRelativePath"]

result = json.loads((archive / "result.json").read_text(encoding="utf-8"))
for capture in result["rawReceipts"]:
    assert capture["nativeExitCode"] == 0, capture["name"]
    for stream in ("stdout", "stderr"):
        data = original_bytes("ci-capture/" + capture["name"] + "." + stream)
        assert len(data) == capture[stream]["bytes"], capture["name"]
        assert digest(data) == capture[stream]["sha256"], capture["name"]

for alias in result["rawJsonAliases"]:
    path = archive / Path(alias["path"]).name
    data = path.read_bytes()
    assert len(data) == alias["bytes"] and digest(data) == alias["sha256"], path.name
    stdout = archive / (path.name.removesuffix(".raw.json") + ".stdout")
    assert data == stdout.read_bytes(), path.name

with zipfile.ZipFile(archive / "run-logs.zip") as bundle:
    assert bundle.testzip() is None, "ZIP CRC mismatch"
    assert len(bundle.infolist()) == len(result["logEntries"]) == 32
    for log in result["logEntries"]:
        local = archive / "logs" / Path(log["path"]).name
        data = original_bytes("ci-capture/logs/" + local.name)
        assert len(data) == log["bytes"] and digest(data) == log["sha256"], local.name
        assert bundle.read(log["archive_name"]) == data, local.name

assert (archive / "run-logs.zip").read_bytes() == (archive / "run-logs-archive.stdout").read_bytes()
pr = json.loads((root / "merge-evidence/pr-merged.stdout").read_bytes())
commit = json.loads((root / "merge-evidence/merge-commit.stdout").read_bytes())
assert pr["state"] == "MERGED"
assert pr["headRefOid"] == result["head"]
assert pr["mergeCommit"]["oid"] == commit["sha"] == "58ba0ffc13458fb136c7d885b62ee0c898d4bab8"
assert [parent["sha"] for parent in commit["parents"]] == [result["testedBaseCommit"]]

for name in ("pr-merged", "merge-commit"):
    capture = json.loads((root / "merge-evidence" / (name + ".receipt.json")).read_bytes())
    assert capture["nativeExitCode"] == 0, name
    for stream in ("stdout", "stderr"):
        data = original_bytes(capture[stream]["archiveRelativePath"])
        assert len(data) == capture[stream]["bytes"] and digest(data) == capture[stream]["sha256"], name

head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert head == "3ec3d730a477ca305566eda28a6b1ddc190e2262", head
subprocess.run(["git", "merge-base", "--is-ancestor", commit["sha"], head], cwd=repo, check=True)

with zipfile.ZipFile(root / conversion["preimageZip"]["path"]) as preimage:
    assert preimage.testzip() is None
    for row in conversion["rows"]:
        raw = original_bytes(row["sourcePath"])
        assert preimage.read(row["sourcePath"]) == raw, row["sourcePath"]
        assert not (root / row["sourcePath"]).exists(), row["sourcePath"]
        cache_path = row["proof"]["originalCachePath"]
        if cache_path:
            assert Path(cache_path).read_bytes() == raw, row["sourcePath"]

print(json.dumps({"archiveFiles": len(actual_files), "archiveBytes": sum(row["bytes"] for row in receipt["files"]),
                  "allByteAndHashEqual": True, "rawCapturesVerified": len(result["rawReceipts"]),
                  "jsonAliasesVerified": len(result["rawJsonAliases"]), "zipCrcPassed": True,
                  "zipLogsByteAndHashEqual": 32, "mergeCapturesVerified": 2,
                  "prState": pr["state"], "actualMergeCommit": commit["sha"],
                  "actualMergeIsHeadAncestor": True, "archiveHeadUnchanged": head,
                  "base64StoredFilesVerified": len(conversion["rows"]),
                  "preimageZipCrcPassed": True}, indent=2))
