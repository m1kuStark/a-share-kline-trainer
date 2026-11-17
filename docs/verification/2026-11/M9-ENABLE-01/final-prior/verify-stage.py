import hashlib
import json
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parent
index = json.loads((root / 'artifact-index.json').read_text(encoding='utf-8'))
sha = lambda b: hashlib.sha256(b).hexdigest()
errors = []
for row in index['payloads'] + index['supportFiles']:
    data = (root / row['path']).read_bytes()
    if len(data) != row['bytes'] or sha(data) != row['sha256']:
        errors.append('physical payload mismatch: ' + row['path'])
opened = {}
try:
    for row in index['sourceFiles']:
        staged = row['staged']
        if staged['encoding'] == 'identity':
            data = (root / staged['path']).read_bytes()
        else:
            name = staged['container']
            if name not in opened:
                opened[name] = zipfile.ZipFile(root / name)
                if opened[name].testzip() is not None:
                    errors.append('ZIP CRC mismatch: ' + name)
            data = opened[name].read(staged['member'])
        if len(data) != row['bytes'] or sha(data) != row['sha256']:
            errors.append('source member mismatch: ' + row['sourceAlias'])
finally:
    for archive in opened.values():
        archive.close()
print(json.dumps({'ok': not errors, 'sourceFiles': len(index['sourceFiles']), 'payloads': len(index['payloads']), 'errors': errors}, indent=2))
raise SystemExit(1 if errors else 0)
