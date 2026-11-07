import { apply } from './index.mjs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: condition === true, detail })
  if (condition !== true) console.log(`FAIL ${name}: ${JSON.stringify(detail)}`)
}

async function fixture(label) {
  const dataDir = await mkdtemp(join(tmpdir(), `sc-lesson-${label}-`))
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
  const lessonRead = (args = {}) => toolMap.get('lesson_read').execute(args)
  async function request(path, method, body, raw) {
    const stream = Readable.from(raw === undefined ? (body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) : [Buffer.from(raw)])
    stream.method = method
    const url = path
    stream.url = url
    const response = {
      statusCode: 200, headers: {},
      setHeader(key, value) { this.headers[key] = value },
      writeHead(status, headers) { this.statusCode = status; this.headers = { ...this.headers, ...headers } },
      end(payload) { this.body = payload ?? '' },
    }
    await routeMap.get(path.split('?')[0]).handler(stream, response)
    return { status: response.statusCode, body: response.body === '' ? '' : JSON.parse(response.body) }
  }
  const session = { agent: { id: `sess-${label}`, session: { id: `sess-${label}` } } }
  const created = await write({ action: 'create', topic: `课程学科-${label}` }, session)
  const subjectId = created.active.subject.id
  return { dataDir, write, read, lessonRead, request, subjectId, session }
}

// 1. lesson_open → course + lesson；能力默认 unverified，媒体位置默认 null
{
  const f = await fixture('open')
  const opened = await f.write({
    action: 'lesson_open',
    courseTitle: '雨课堂 · 机器学习',
    platform: 'yuketang',
    url: 'https://www.yuketang.cn/lesson/xxx',
    lessonTitle: 'Chap5-1（2）',
  }, f.session)
  check('lesson_open ok', opened.ok === true && opened.lesson !== null, opened.error)
  check('lesson state open', opened.lesson.state === 'open', opened.lesson.state)
  check('capabilities unverified', Object.values(opened.lesson.capabilities).every((v) => v === 'unverified'), opened.lesson.capabilities)
  check('playback unknown + null offset', opened.lesson.playback.status === 'unknown' && opened.lesson.playback.mediaOffsetSec === null, opened.lesson.playback)
  check('null offset is not coerced to 0', opened.lesson.playback.mediaOffsetSec !== 0, opened.lesson.playback.mediaOffsetSec)
  const lessonId = opened.lesson.id

  const playback = await f.write({ action: 'lesson_playback', lessonId, status: 'playing' }, f.session)
  check('playback playing, offset still null', playback.lesson.playback.status === 'playing' && playback.lesson.playback.mediaOffsetSec === null, playback.lesson.playback)

  const cap = await f.write({ action: 'lesson_capability', lessonId, capability: 'pause', value: 'unavailable' }, f.session)
  check('capability updated', cap.lesson.capabilities.pause === 'unavailable', cap.lesson.capabilities)
}

// 2. 课中标记：think 会带 pauseRequested，但不改播放状态
{
  const f = await fixture('mark')
  const opened = await f.write({ action: 'lesson_open', courseTitle: 'B 站 · 线代', platform: 'bilibili', lessonTitle: '第 3 讲' }, f.session)
  const lessonId = opened.lesson.id
  const marked = await f.write({ action: 'lesson_mark', lessonId, kind: 'think', text: '这里先停一下' }, f.session)
  check('think mark pauseRequested', marked.lesson.marks.at(-1).pauseRequested === true, marked.lesson.marks.at(-1))
  check('playback untouched by mark', marked.lesson.playback.status === 'unknown', marked.lesson.playback)
  const routed = await f.request(`/study-companion/api/lesson/mark`, 'POST', { lessonId, kind: 'confused', text: '贝叶斯更新没跟上' })
  check('mark route ok', routed.status === 200 && routed.body.ok === true, routed)
  check('route returns observed playback', routed.body.playback.status === 'unknown', routed.body.playback)
}

// 3. 锚点规则：未对齐时间不许进 startSec；observedClock 只作观察
{
  const f = await fixture('anchor')
  const opened = await f.write({ action: 'lesson_open', courseTitle: '学堂在线 · 概率', platform: 'xuetangx', lessonTitle: '第 2 讲' }, f.session)
  const lessonId = opened.lesson.id
  const bad = await f.write({ action: 'anchor_add', lessonId, kind: 'media', startSec: 585, aligned: false, label: '09:45' }, f.session)
  check('unaligned startSec rejected', bad.ok === false && /aligned/.test(bad.error), bad)
  const clockOnly = await f.write({ action: 'anchor_add', lessonId, kind: 'media', observedClock: '09:45', aligned: false, label: '页面显示 09:45（未对齐）' }, f.session)
  check('missing startSec stays null', clockOnly.ok === true && clockOnly.lesson.anchors.at(-1).startSec === null, clockOnly.lesson?.anchors?.at(-1))
  check('observedClock anchor accepted', clockOnly.ok === true, clockOnly.error)
  const stored = clockOnly.lesson.anchors.at(-1)
  check('observedClock not media offset', stored.observedClock === '09:45' && stored.startSec === null && stored.aligned === false, stored)
  const aligned = await f.write({ action: 'anchor_add', lessonId, kind: 'media', startSec: 585, endSec: 610, aligned: true, confidence: 'observed', label: '贝叶斯更新' }, f.session)
  check('aligned media anchor ok', aligned.ok === true && aligned.lesson.anchors.at(-1).startSec === 585, aligned.error)
  const slide = await f.write({ action: 'anchor_add', lessonId, kind: 'slide', page: 7, materialId: 'm1', label: 'P7 条件独立' }, f.session)
  check('slide anchor page kept', slide.lesson.anchors.at(-1).page === 7, slide.lesson.anchors.at(-1))
}

// 4. 笔记分栏 + 互动小节 + 回溯
{
  const f = await fixture('note')
  const opened = await f.write({ action: 'lesson_open', courseTitle: '雨课堂 · 统计', platform: 'yuketang', lessonTitle: 'Chap5-1（2）' }, f.session)
  const lessonId = opened.lesson.id
  const anchor = await f.write({ action: 'anchor_add', lessonId, kind: 'slide', page: 3, label: 'P3 贝叶斯公式' }, f.session)
  const anchorId = anchor.lesson.anchors.at(-1).id
  const note = await f.write({
    action: 'note_write', lessonId, title: '贝叶斯分类：先验与似然',
    intuition: '先验是你原来的相信程度，似然是新证据把哪些假设抬高。',
    example: '垃圾邮件里出现「发票」→ 营销类假设被抬高。',
    formula: 'P(H|E) = P(E|H)P(H) / P(E)',
    conditions: '各类先验与似然已知；特征条件独立假设成立时才是朴素贝叶斯。',
    pitfalls: '把 P(E|H) 当成 P(H|E)。',
    sourcePoints: ['老师：先验 × 似然 → 后验（P3）'],
    generated: ['补充：用赔率形式看，后验比 = 先验比 × 似然比'],
    anchorIds: [anchorId],
    tags: ['贝叶斯'],
  }, f.session)
  check('note created', note.ok === true && note.lesson.notes.length === 1, note.error)
  const noteId = note.lesson.notes[0].id
  check('note keeps source and generated apart', note.lesson.notes[0].sourcePoints.length === 1 && note.lesson.notes[0].generated.length === 1, note.lesson.notes[0])
  const edited = await f.write({ action: 'note_write', lessonId, noteId, pitfalls: '把 P(E|H) 当成 P(H|E)；以及忘了归一化常数。', status: 'user_edited' }, f.session)
  check('note merge by noteId', edited.lesson.notes.length === 1 && /归一化/.test(edited.lesson.notes[0].pitfalls) && edited.lesson.notes[0].status === 'user_edited', edited.lesson.notes)

  const section = await f.write({
    action: 'section_write', lessonId, title: '为什么先验重要（补讲）',
    objective: '能用赔率直觉解释先验的作用',
    prerequisites: '知道条件概率定义',
    blocks: [
      { kind: 'text', body: '先看一个具体例子。' },
      { kind: 'example', body: '1000 封邮件里 100 封是营销；「发票」出现在 80% 的营销邮件里。' },
      { kind: 'formula', body: '后验比 = 先验比 × 似然比' },
      { kind: 'question', body: '若先验比 1:9，似然比 8，后验比是多少？' },
    ],
    sourceRefIds: [anchorId],
  }, f.session)
  check('section generated status', section.ok === true && section.lesson.sections[0].status === 'generated', section.error)
  check('section blocks kept', section.lesson.sections[0].blocks.length === 4, section.lesson.sections[0].blocks)

  const trace = await f.write({ action: 'trace_record', lessonId, concept: '贝叶斯更新', gapId: 'g1', anchorIds: [anchorId], noteIds: [noteId] }, f.session)
  check('trace recorded', trace.ok === true && trace.lesson.trace.length === 1, trace.error)
}

// 5. 偏好：全局默认 + 学科覆盖合并
{
  const f = await fixture('prefs')
  const globalPref = await f.write({ action: 'pref_set', scope: 'global', patch: { order: ['intuition', 'example', 'formula'], language: 'zh' } }, f.session)
  check('global pref set', globalPref.ok === true && globalPref.prefs.global.order[0] === 'intuition', globalPref.error)
  const subjectPref = await f.write({ action: 'pref_set', scope: 'subject', patch: { order: ['intuition', 'visual', 'example'] } }, f.session)
  check('subject pref set', subjectPref.ok === true, subjectPref.error)
  const routed = await f.request(`/study-companion/api/prefs?subjectId=${f.subjectId}`, 'GET')
  check('prefs route merged', routed.status === 200 && routed.body.prefs.scope === 'subject' && routed.body.prefs.order.length === 3, routed.body)
}

// 6. 学科隔离：两个学科的课次不串写
{
  const f = await fixture('isolation')
  const first = await f.write({ action: 'lesson_open', courseTitle: '课 A', platform: 'other', lessonTitle: 'A1' }, f.session)
  await f.write({ action: 'create', topic: '第二学科' }, f.session)
  const second = await f.write({ action: 'lesson_open', courseTitle: '课 B', platform: 'other', lessonTitle: 'B1' }, f.session)
  check('different subjects different lessons', first.lesson.subjectId !== second.lesson.subjectId && first.lesson.id !== second.lesson.id, {
    first: first.lesson.subjectId, second: second.lesson.subjectId,
  })
  const cross = await f.write({ action: 'lesson_mark', lessonId: first.lesson.id, kind: 'important' }, f.session)
  check('cross-subject write rejected', cross.ok === false && /不属于当前学科/.test(cross.error), cross)
}

// 7. lesson_read：最近 open 课次 + 摘要 + 合并偏好
{
  const f = await fixture('read')
  await f.write({ action: 'lesson_open', courseTitle: '课 C', platform: 'other', lessonTitle: 'C1' }, f.session)
  const readBack = await f.lessonRead({})
  check('lesson_read returns lesson', readBack.ok === true && readBack.lesson !== null, readBack.error)
  check('lesson_read lists summary', Array.isArray(readBack.lessons) && readBack.lessons.length === 1, readBack.lessons)
  check('lesson_read returns prefs', readBack.prefs !== null && Array.isArray(readBack.prefs.order), readBack.prefs)
  const lessonsRoute = await f.request(`/study-companion/api/lessons?subjectId=${f.subjectId}`, 'GET')
  check('lessons route ok', lessonsRoute.status === 200 && lessonsRoute.body.lessons.length === 1, lessonsRoute.body)
  const lessonRoute = await f.request(`/study-companion/api/lesson?id=${readBack.lesson.id}`, 'GET')
  check('lesson route ok', lessonRoute.status === 200 && lessonRoute.body.lesson.id === readBack.lesson.id, lessonRoute.status)
  const missing = await f.request(`/study-companion/api/lesson?id=nope`, 'GET')
  check('missing lesson 404', missing.status === 404, missing.status)
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('FAILURES:', JSON.stringify(failed, null, 2))
  process.exit(1)
}