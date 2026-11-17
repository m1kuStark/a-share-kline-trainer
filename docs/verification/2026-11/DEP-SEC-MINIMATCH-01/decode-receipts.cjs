const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const [output] = process.argv.slice(2)
assert.ok(output && path.isAbsolute(output), 'Supply an absolute output directory')
const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'result.json'), 'utf8'))
const destinationRoot = path.resolve(output)
const digest = data => crypto.createHash('sha256').update(data).digest('hex')
let count = 0
for (const artifact of index.artifacts.filter(item => item.encoding === 'base64')) {
  const encoded = fs.readFileSync(path.join(__dirname, artifact.path))
  assert.equal(encoded.length, artifact.bytes, artifact.path)
  assert.equal(digest(encoded), artifact.sha256, artifact.path)
  const decoded = Buffer.from(encoded.toString('ascii').replace(/\s/g, ''), 'base64')
  assert.equal(decoded.length, artifact.decodedBytes, artifact.decodedPath)
  assert.equal(digest(decoded), artifact.decodedSha256, artifact.decodedPath)
  const destination = path.resolve(destinationRoot, artifact.decodedPath)
  assert.ok(destination.startsWith(destinationRoot + path.sep), 'Decoded path must stay inside output directory')
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination)) assert.ok(fs.readFileSync(destination).equals(decoded), `Refusing to overwrite different file: ${destination}`)
  else fs.writeFileSync(destination, decoded)
  count++
}
console.log(JSON.stringify({ decoded: count, output: destinationRoot, allEncodedAndDecodedHashesVerified: true }))
