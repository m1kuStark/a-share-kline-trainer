const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')

const [mode, repo, releaseDirectory] = process.argv.slice(2)
const resources = path.join(releaseDirectory, 'win-unpacked', 'resources')
const appRoot = path.join(resources, 'app.asar')
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const requiredFiles = ['desktop/dist/main.js', 'desktop/dist/preload.cjs', 'server/dist/index.js', 'web/dist/index.html',
  'node_modules/fastify/fastify.js', 'node_modules/@fastify/static/index.js', 'node_modules/glob/package.json']

async function main() {
  if (mode === 'inventory') {
    const req = createRequire(path.join(repo, 'package.json'))
    const asar = req('@electron/asar')
    const files = asar.listPackage(appRoot).map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    for (const file of requiredFiles) assert.ok(files.includes(file), `missing packaged file ${file}`)
    const readJson = file => JSON.parse(asar.extractFile(appRoot, path.normalize(file)).toString('utf8'))
    const manifest = readJson('package.json')
    const original = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
    assert.equal(manifest.version, original.version)
    const minimatchCopies = files.filter(file => file.endsWith('/minimatch/package.json'))
      .map(file => ({ path: file, version: readJson(file).version }))
    assert.ok(minimatchCopies.some(copy => copy.version === '11.0.9'))
    for (const copy of minimatchCopies) {
      const [major, minor, patch] = copy.version.split('.').map(Number)
      assert.ok(!(major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1))), copy.path)
      assert.ok(!(major === 11 && minor === 0 && patch >= 3 && patch <= 7), copy.path)
    }
    const extraResources = ['migration-export-inline.html', 'migration-import-recordings.js'].map(file => {
      const packaged = path.join(resources, file)
      assert.equal(sha256(packaged), sha256(path.join(repo, 'desktop/build-resources', file)))
      return { file, sha256: sha256(packaged) }
    })
    const updaterFile = path.join(resources, 'app-update.yml')
    const updaterConfiguration = req('js-yaml').load(fs.readFileSync(updaterFile, 'utf8'))
    const builderConfiguration = req('js-yaml').load(fs.readFileSync(path.join(repo, 'desktop/electron-builder.yml'), 'utf8'))
    const expectedFeed = builderConfiguration.publish[0]
    for (const key of ['provider', 'owner', 'repo']) assert.equal(updaterConfiguration[key], expectedFeed[key], `updater feed ${key}`)
    assert.equal(updaterConfiguration.updaterCacheDirName, `${original.name.toLowerCase()}-updater`, 'NSIS generated cache name follows app-builder-lib AppInfo')
    extraResources.push({ file: 'app-update.yml', sha256: sha256(updaterFile),
      sourceFallbackSha256: sha256(path.join(repo, 'desktop/build-resources/app-update.yml')),
      generatedByBuilder: true, configuration: updaterConfiguration })
    const appExe = path.join(releaseDirectory, 'win-unpacked', 'K线训练器.exe')
    const pe = fs.readFileSync(appExe)
    const header = pe.readUInt32LE(0x3c)
    assert.equal(pe.toString('ascii', header, header + 4), 'PE\0\0')
    assert.equal(pe.readUInt16LE(header + 4), 0x8664, 'unpacked Electron executable is x64')
    const artifacts = fs.readdirSync(releaseDirectory).filter(file => file.endsWith('.exe')).map(file => ({
      file, bytes: fs.statSync(path.join(releaseDirectory, file)).size, sha256: sha256(path.join(releaseDirectory, file)),
    }))
    assert.ok(artifacts.some(item => item.file === `kline-trainer-desktop-setup-v${manifest.version}-windows-x64.exe`))
    console.log(JSON.stringify({ mode, passed: true, version: manifest.version, asar: true, arch: 'x64',
      asarSha256: sha256(appRoot), packagedFileCount: files.length, requiredFiles, minimatchCopies,
      extraResources, artifacts, sourceFingerprints: ['package.json', 'package-lock.json'].map(file => ({ file, sha256: sha256(path.join(repo, file)) })) }, null, 2))
  } else if (mode === 'runtime') {
    assert.ok(process.versions.electron, 'runtime probe must use the packaged Electron executable')
    const req = createRequire(path.join(appRoot, 'package.json'))
    const fastify = req('fastify')({ logger: false })
    const globRequire = createRequire(req.resolve('glob'))
    const mmVersion = globRequire('minimatch/package.json').version
    assert.equal(mmVersion, '11.0.9')
    const webRoot = path.join(appRoot, 'web', 'dist')
    const globFiles = await req('glob').glob('**/*', { cwd: webRoot, nodir: true })
    assert.ok(globFiles.includes('index.html'))
    await fastify.register(req('@fastify/static'), { root: webRoot })
    try {
      const index = await fastify.inject({ method: 'GET', url: '/index.html' })
      assert.equal(index.statusCode, 200)
      const script = index.body.match(/<script\b[^>]*src="([^"]+)"/)
      assert.ok(script, 'packaged production page references a JS asset')
      const asset = await fastify.inject({ method: 'GET', url: script[1] })
      assert.equal(asset.statusCode, 200)
      assert.ok(asset.body.length > 0)
      const missing = await fastify.inject({ method: 'GET', url: '/__missing_dep_probe__.js' })
      assert.equal(missing.statusCode, 404)
      const { DatabaseSync } = require('node:sqlite')
      const database = new DatabaseSync(':memory:')
      database.exec('CREATE TABLE probe (value INTEGER); INSERT INTO probe VALUES (42)')
      assert.equal(database.prepare('SELECT value FROM probe').get().value, 42)
      database.close()
      console.log(JSON.stringify({ mode, passed: true, electron: process.versions.electron, node: process.versions.node,
        arch: process.arch, minimatchFromProductionGlob: mmVersion, globFileCount: globFiles.length,
        staticIndex: index.statusCode, staticAsset: asset.statusCode, missingAsset: missing.statusCode,
        sqlite: 'built-in node:sqlite in-memory roundtrip', network: 'none; Fastify inject',
        isolatedProfile: process.env.USERPROFILE, isolatedDatabase: process.env.TRAINER_DB }, null, 2))
    } finally {
      await fastify.close()
    }
  } else throw new Error('Expected inventory or runtime mode')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
