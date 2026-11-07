#!/usr/bin/env node
/**
 * 在临时目录里重建一份「可执行测试环境」并跑全部回归。
 *
 * 为什么不在原地跑：
 *  - 本机 node v26 在「type:module + 包内 .js」的组合下，`node --check` / 直接执行
 *    会 SIGABRT（环境问题，与代码无关）；测试统一用 .mjs 副本规避。
 *  - 顺带验证「打包后的文件集合是否自洽」：只有把发布包含的文件拷进临时目录
 *    还能跑通，才说明没有漏文件。
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SUITES = ['host-regress.mjs', 'lesson-regress.mjs']

function run(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : (error.code ?? 1), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

async function buildHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'study-companion-test-'))
  const host = await readFile(join(PACKAGE_ROOT, 'index.js'), 'utf8')
  await mkdir(join(dir, 'adapter'), { recursive: true })
  await mkdir(join(dir, 'content'), { recursive: true })
  // 把包内 ESM 源码改名为 .mjs，并重写内部相对导入。
  await writeFile(join(dir, 'index.mjs'), host.replaceAll("'./adapter/safari.js'", "'./adapter/safari.mjs'"))
  await cp(join(PACKAGE_ROOT, 'adapter', 'safari.js'), join(dir, 'adapter', 'safari.mjs'))
  await cp(join(PACKAGE_ROOT, 'content', 'method.json'), join(dir, 'content', 'method.json'))
  for (const suite of SUITES) {
    const source = await readFile(join(PACKAGE_ROOT, 'tests', suite), 'utf8')
    await writeFile(join(dir, suite), source)
  }
  return dir
}

const harness = await buildHarness()
console.log(`harness: ${harness}`)

let failed = 0
for (const suite of SUITES) {
  const result = await run(process.execPath, [suite], { cwd: harness })
  const summary = (result.stdout.match(/^\s*\d+\/\d+ checks passed\s*$/m) ?? ['(no summary)'])[0].trim()
  const ok = result.code === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite.padEnd(20)} ${summary}`)
  if (!ok) {
    failed += 1
    process.stdout.write(result.stdout.slice(-4000))
    process.stderr.write(result.stderr.slice(-2000))
  }
}

console.log(failed === 0 ? `\nALL SUITES PASSED (${SUITES.length})` : `\n${failed} SUITE(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
