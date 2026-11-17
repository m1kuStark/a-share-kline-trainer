import hashlib,json
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent
index=json.loads((root/'artifact-index.json').read_text(encoding='utf-8'))
sha=lambda data:hashlib.sha256(data).hexdigest()
errors=[]
data=(root/index['archive']['path']).read_bytes()
if len(data)!=index['archive']['bytes'] or sha(data)!=index['archive']['sha256']:errors.append('archive identity mismatch')
with zipfile.ZipFile(root/index['archive']['path']) as archive:
 if archive.testzip() is not None:errors.append('ZIP CRC mismatch')
 if sorted(archive.namelist())!=sorted(x['member'] for x in index['members']):errors.append('member set mismatch')
 for row in index['members']:
  data=archive.read(row['member'])
  if len(data)!=row['bytes'] or sha(data)!=row['sha256']:errors.append(row['member'])
print(json.dumps({'ok':not errors,'members':len(index['members']),'errors':errors},indent=2))
raise SystemExit(1 if errors else 0)
