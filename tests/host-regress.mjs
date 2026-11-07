import { apply } from './index.mjs'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: condition === true, detail })
  if (condition !== true) console.log(`FAIL ${name}: ${JSON.stringify(detail)}`)
}

async function fixture(label) {
  const dataDir = await mkdtemp(join(tmpdir(), `sc-host-${label}-`))
  const toolMap = new Map()
  const routeMap = new Map()
  const ctx = {
    tools: { register(tool) { toolMap.set(tool.name, tool); return () => {} } },
    webServer: { register(route) { routeMap.set(route.path, route); return () => {} } },
    connection: { requestRejection() { return undefined } },
    effect(fn) { return fn() },
  }
  apply(ctx, { dataDir })
  const write = (args, exec) => toolMap.get('study_write').execute(args, exec)
  const read = (args = {}) => toolMap.get('study_read').execute(args)
  async function request(path, method, body, raw) {
    const stream = Readable.from(raw === undefined ? (body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) : [Buffer.from(raw)])
    stream.method = method
    const response = {
      statusCode: 200, headers: {},
      setHeader(key, value) { this.headers[key] = value },
      writeHead(status, headers) { this.statusCode = status; this.headers = { ...this.headers, ...headers } },
      end(body) { this.body = body ?? '' },
    }
    await routeMap.get(`/study-companion/api/${path}`).handler(stream, response)
    return { status: response.statusCode, body: response.body === '' ? '' : JSON.parse(response.body) }
  }
  const created = await write({ action: 'create', topic: `fixture-${label}` })
  const id = created.active.subject.id
  return { dataDir, write, read, request, id }
}

// 1. happy path：出题 → 面板答题（带 questionId）→ 评分（带 questionId+answerSeq）
{
  const f = await fixture('happy')
  const asked = await f.write({ action: 'ask_exam', question: 'Q1', concept: '弱对偶', level: 1 })
  const pending = asked.active.pendingExam
  const answered = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: pending.questionId, answer: 'A1' })
  check('happy answer 200', answered.status === 200, answered.status)
  const seq = answered.body.pendingExam.answerSeq
  const graded = await f.write({ action: 'grade_exam', questionId: pending.questionId, answerSeq: seq, score: 7, independent: true })
  check('happy grade ok', graded.ok === true, graded)
  check('happy gapLog written', graded.active.subject.gapLog.length === 1, graded.active?.subject?.gapLog)
  check('happy pending cleared', graded.active.pendingExam === null, graded.active.pendingExam)
}

// 2. 并发写不同单元：不能丢更新
{
  for (let run = 0; run < 10; run++) {
    const f = await fixture(`concurrent-${run}`)
    await f.write({ action: 'set_plan', units: [{ title: 'one' }, { title: 'two' }] })
    const [a, b] = await Promise.all([
      f.write({ action: 'complete_unit', unitIndex: 1 }),
      f.write({ action: 'complete_unit', unitIndex: 2 }),
    ])
    const final = (await f.read()).active.subject.plan.units.map((unit) => unit.done)
    check(`concurrent run ${run} no lost update`, final.every(Boolean) && a.ok && b.ok, final)
  }
}

// 3. ask_exam 不能覆盖未完成题；replace=true 才跳过且留档
{
  const f = await fixture('overwrite')
  await f.write({ action: 'ask_exam', question: 'Q1' })
  await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: (await f.read()).active.pendingExam.questionId, answer: 'A1' })
  const blocked = await f.write({ action: 'ask_exam', question: 'Q2' })
  check('overwrite blocked', blocked.ok === false && /未完成/.test(blocked.error), blocked)
  const stillQ1 = (await f.read()).active.pendingExam
  check('overwrite kept Q1', stillQ1.question === 'Q1' && stillQ1.answer === 'A1', stillQ1)
  const replaced = await f.write({ action: 'ask_exam', question: 'Q2', replace: true })
  check('replace works', replaced.ok === true && replaced.active.pendingExam.question === 'Q2', replaced.active?.pendingExam)
  check('replace archived old', replaced.active.subject.discardedExams.length === 1 && replaced.active.subject.discardedExams[0].question === 'Q1', replaced.active?.subject?.discardedExams)
}

// 4. 过期答案 & 版本错配
{
  const f = await fixture('stale')
  const q1 = (await f.write({ action: 'ask_exam', question: 'Q1' })).active.pendingExam
  const a1 = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q1.questionId, answer: 'A1' })
  const seq1 = a1.body.pendingExam.answerSeq
  await f.write({ action: 'grade_exam', questionId: q1.questionId, answerSeq: seq1, score: 7 })
  const q2 = (await f.write({ action: 'ask_exam', question: 'Q2' })).active.pendingExam

  const stale = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q1.questionId, answer: 'resubmitted A1' })
  check('stale answer 409', stale.status === 409, stale)
  check('stale answer not written', (await f.read()).active.pendingExam.answer === '', (await f.read()).active.pendingExam)

  const missing = await f.request('exam/answer', 'POST', { subjectId: f.id, answer: 'no id' })
  check('missing questionId 400', missing.status === 400 && /questionId/.test(missing.body.error), missing)

  const ok = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q2.questionId, answer: 'A2' })
  check('fresh answer 200', ok.status === 200, ok)
  const seq2 = ok.body.pendingExam.answerSeq
  const duplicate = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q2.questionId, answer: 'A2 edited' })
  check('duplicate submit blocked', duplicate.status === 409, duplicate)
  const revised = await f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q2.questionId, answer: 'A2 revised', revise: true })
  check('revise allowed', revised.status === 200 && revised.body.pendingExam.answerSeq === seq2 + 1, revised.body)

  const wrongQuestion = await f.write({ action: 'grade_exam', questionId: q1.questionId, answerSeq: seq2 + 1, score: 5 })
  check('grade wrong questionId rejected', wrongQuestion.ok === false, wrongQuestion)
  const wrongSeq = await f.write({ action: 'grade_exam', questionId: q2.questionId, answerSeq: seq2, score: 5 })
  check('grade stale answerSeq rejected', wrongSeq.ok === false && /answerSeq/.test(wrongSeq.error), wrongSeq)
  const graded = await f.write({ action: 'grade_exam', questionId: q2.questionId, answerSeq: seq2 + 1, score: 6 })
  check('grade correct version ok', graded.ok === true, graded)
  check('graded answer is revised', graded.active.subject.gapLog.at(-1).answer === 'A2 revised', graded.active?.subject?.gapLog?.at(-1))
}

// 5. 非法请求体状态码
{
  const f = await fixture('bad-json')
  const invalid = await f.request('subjects', 'POST', undefined, '{')
  const array = await f.request('subjects', 'POST', undefined, '[]')
  check('invalid JSON 400', invalid.status === 400, invalid)
  check('array body 400', array.status === 400, array)
}

// 6. 指定 subject 写：响应 active 必须是目标学科
{
  const f = await fixture('targeted')
  const firstId = f.id
  await f.write({ action: 'create', topic: 'second subject' })
  const secondId = (await f.read()).active.subject.id
  const targeted = await f.write({ action: 'ask_exam', subject: firstId, question: 'First subject Q1' })
  check('targeted response points at target', targeted.active.subject.id === firstId, { firstId, secondId, returned: targeted.active?.subject?.id })
  check('global active unchanged', (await f.read()).active.subject.id === secondId, (await f.read()).active.subject.id)
  check('target actually stored', (await f.read({ subject: firstId })).active.pendingExam?.question === 'First subject Q1')
}

// 7. 事务内读改写：答案路由与工具写入交错不互相覆盖
{
  const f = await fixture('interleave')
  await f.write({ action: 'set_plan', units: [{ title: 'one' }, { title: 'two' }] })
  const q = (await f.write({ action: 'ask_exam', question: 'Q1' })).active.pendingExam
  await Promise.all([
    f.request('exam/answer', 'POST', { subjectId: f.id, questionId: q.questionId, answer: 'A1' }),
    f.write({ action: 'complete_unit', unitIndex: 1 }),
  ])
  const final = await f.read()
  check('interleaved answer+unit both kept', final.active.pendingExam?.answer === 'A1' && final.active.subject.plan.units[0].done === true, {
    answer: final.active.pendingExam?.answer, done: final.active.subject.plan.units[0].done,
  })
}

// 8. 对话归属：create 自动绑定调用对话；别的对话不能出题/评分；bind_session 可显式更换并留历史
{
  const f = await fixture('session-bind')
  const sessionA = { agent: { id: 'session-A', session: { id: 'session-A' } } }
  const sessionB = { agent: { id: 'session-B', session: { id: 'session-B' } } }
  const created = await f.write({ action: 'create', topic: 'bound subject' }, sessionA)
  check('create binds caller session', created.active.subject.mainSessionId === 'session-A', created.active?.subject?.mainSessionId)
  const foreignAsk = await f.write({ action: 'ask_exam', question: 'Q from B' }, sessionB)
  check('foreign session cannot ask', foreignAsk.ok === false && /绑定的伴学对话/.test(foreignAsk.error), foreignAsk)
  const ownAsk = await f.write({ action: 'ask_exam', question: 'Q from A' }, sessionA)
  check('owning session can ask', ownAsk.ok === true, ownAsk)
  const rebound = await f.write({ action: 'bind_session', sessionId: 'session-B', sessionLabel: '运筹学主对话' }, sessionB)
  check('bind_session switches', rebound.ok === true && rebound.active.subject.mainSessionId === 'session-B', rebound.active?.subject?.mainSessionId)
  check('bind history kept', rebound.active.subject.sessionHistory.length === 1 && rebound.active.subject.sessionHistory[0].sessionId === 'session-A', rebound.active?.subject?.sessionHistory)
  const gradedFromA = await f.write({ action: 'grade_exam', questionId: 'x', answerSeq: 0, score: 5 }, sessionA)
  check('old session rejected after rebind', gradedFromA.ok === false && /绑定的伴学对话/.test(gradedFromA.error), gradedFromA)
}

// 9. 掌握度与计划完成度分离
{
  const f = await fixture('mastery')
  const session = { agent: { id: 's-mastery', session: { id: 's-mastery' } } }
  await f.write({ action: 'create', topic: 'mastery subject' }, session)
  await f.write({ action: 'set_plan', units: [{ title: 'u1' }, { title: 'u2' }] }, session)
  const prompted = await f.write({ action: 'record_mastery', unitIndex: 1, kind: 'prompted', note: '提示了两步' }, session)
  const unit1 = prompted.active.subject.unitMastery.find((entry) => entry.unitIndex === 1)
  check('prompted recorded, independent still empty', unit1.promptedOnlyAt !== null && unit1.independentPassAt === null, unit1)
  await f.write({ action: 'complete_unit', unitIndex: 1 }, session)
  const afterDone = await f.read({ subject: 'mastery subject' })
  check('plan done does not imply independent', afterDone.active.subject.plan.units[0].done === true && afterDone.active.subject.unitMastery[0].independentPassAt === null, afterDone.active.subject.unitMastery[0])
  const independent = await f.write({ action: 'record_mastery', unitIndex: 1, kind: 'independent' }, session)
  const reviewed = await f.write({ action: 'record_mastery', unitIndex: 1, kind: 'review', note: '隔天新变式' }, session)
  const entry = reviewed.active.subject.unitMastery.find((item) => item.unitIndex === 1)
  check('independent + review recorded separately', entry.independentPassAt !== null && entry.reviewPassAt !== null, entry)
  check('derived mastery counts', reviewed.active.derived.mastery.independentUnits === 1, reviewed.active.derived.mastery)
}

// 10. 拆项评分与教材溯源落到 gapLog
{
  const f = await fixture('rubric')
  const session = { agent: { id: 's-rubric', session: { id: 's-rubric' } } }
  const rubricCreated = await f.write({ action: 'create', topic: 'rubric subject' }, session)
  const rubricId = rubricCreated.active.subject.id
  const asked = await f.write({ action: 'ask_exam', question: '对偶题' }, session)
  const pending = asked.active.pendingExam
  const answered = await f.request('exam/answer', 'POST', { subjectId: rubricId, questionId: pending.questionId, answer: '我的解' })
  const seq = answered.body.pendingExam.answerSeq
  const graded = await f.write({
    action: 'grade_exam', questionId: pending.questionId, answerSeq: seq, score: 13,
    items: [{ label: '写对对偶模型', score: 9, max: 10 }, { label: '选对偶可行解并用弱对偶给界', score: 4, max: 5 }],
    source: 'slides/线性规划_对偶.pdf 第 5、10、13 页',
    independent: true,
  }, session)
  const gap = graded.active.subject.gapLog.at(-1)
  check('rubric items stored', gap.items.length === 2 && gap.items[1].max === 5, gap.items)
  check('source stored', /对偶\.pdf/.test(gap.source), gap.source)
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('FAILURES:', JSON.stringify(failed, null, 2))
  process.exit(1)
}