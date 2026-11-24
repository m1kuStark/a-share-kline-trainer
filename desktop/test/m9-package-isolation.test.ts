import { expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { FileMatcher } from 'app-builder-lib/out/fileMatcher'

it('M9 hold excludes stale server formula artifacts from incremental desktop packaging', async () => {
  const root = resolve('.')
  const config = load(await readFile(join(root, 'desktop/electron-builder.yml'), 'utf8')) as { files: string[] }
  const match = new FileMatcher(root, root, pattern => pattern, config.files).createFilter()
  const file = await stat(join(root, 'package.json'))
  expect(match(join(root, 'server/dist/index.js'), file)).toBe(true)
  expect(match(join(root, 'server/dist/formulas/api.js'), file)).toBe(false)
  expect(match(join(root, 'server/dist/formulas/engine-bundle/index.mjs'), file)).toBe(false)
})