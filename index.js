/**
 * 伴学（study-companion）— Host 半边。
 *
 * 把「一次性的 AI 问答」变成一条可续、可测、可复习的学习回路：
 *   路径（五级学习阶梯 / 20 小时计划 / 资源策展）
 *   + 测试（对话里出题、面板里作答、回对话评分）
 *   + 压缩（一页速查表）
 *   + 反馈循环（费曼循环 + 1/3/7 天复测）
 *
 * 这一半只做四件事：
 *  1. 按学科分档案：`<dataDir>/subjects/<id>.json`，另加 `active.json` 记录当前学科。
 *  2. 两个 agent 工具：`study_read`（读档案）与 `study_write`（拆阶梯 / 出计划 / 出题 / 评分 / 记复述…）。
 *  3. 两条只读路由供面板展示：state（进度快照）与 method（六张方法卡）。
 *  4. 两条面板写路由：新建学科、提交考场答案（**只存答案，不评分**）。
 *
 * 不调用任何外部服务；不写会话日志；评分只发生在对话里。
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { controlPlayback, probe as safariProbe, readMediaState } from './adapter/safari.js'

export const name = 'study-companion'

export const inject = ['tools', 'webServer', 'connection']

const STATE_ROUTE = '/study-companion/api/state'
const METHOD_ROUTE = '/study-companion/api/method'
const SUBJECTS_ROUTE = '/study-companion/api/subjects'
const ACTIVE_ROUTE = '/study-companion/api/active'
const ANSWER_ROUTE = '/study-companion/api/exam/answer'
const LESSONS_ROUTE = '/study-companion/api/lessons'
const LESSON_ROUTE = '/study-companion/api/lesson'
const PREFS_ROUTE = '/study-companion/api/prefs'
const LESSON_MARK_ROUTE = '/study-companion/api/lesson/mark'
const LESSON_SYNC_ROUTE = '/study-companion/api/lesson/sync'
const ADAPTER_PROBE_ROUTE = '/study-companion/api/adapter/probe'
const ADAPTER_CONTROL_ROUTE = '/study-companion/api/adapter/control'
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const METHOD_FILE = join(PACKAGE_DIR, 'content', 'method.json')

const MAX_GAPS = 60
const MAX_FEYNMAN = 40
const MAX_RESOURCES = 5
const MAX_LEVELS = 5
const MAX_BODY_BYTES = 64 * 1024
const MAX_DISCARDED = 20
const MAX_SESSION_HISTORY = 20

const ACTIONS = [
  'create',
  'update',
  'select',
  'set_ladder',
  'set_plan',
  'set_resources',
  'ask_exam',
  'grade_exam',
  'log_feynman',
  'save_cheatsheet',
  'complete_unit',
  'schedule_reviews',
  'complete_review',
  'bind_session',
  'record_mastery',
  'lesson_open',
  'lesson_close',
  'lesson_capability',
  'lesson_playback',
  'lesson_mark',
  'material_add',
  'anchor_add',
  'knowledge_add',
  'note_write',
  'section_write',
  'trace_record',
  'pref_set',
]

const LESSON_ACTIONS = [
  'lesson_open',
  'lesson_close',
  'lesson_capability',
  'lesson_playback',
  'lesson_mark',
  'material_add',
  'anchor_add',
  'knowledge_add',
  'note_write',
  'section_write',
  'trace_record',
  'lesson_sync',
]

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function defaultDataDir() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'storages', 'study-companion')
}

function resolveDataDir(config) {
  if (config !== null && typeof config === 'object' && typeof config.dataDir === 'string' && config.dataDir.trim() !== '') {
    return config.dataDir.trim()
  }
  return defaultDataDir()
}

function text(value, maxLength = 4000) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function number(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** null / undefined / 空串一律保持 null —— 未知值不能变成 0。 */
function optionalNumber(value, min, max) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(max, Math.max(min, parsed))
}

function isoNow() {
  return new Date().toISOString()
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function dateIso(value, fallback) {
  const raw = text(value, 40)
  return /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? raw : fallback
}

function shiftDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function newSubjectId() {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `s_${stamp}_${Math.random().toString(36).slice(2, 6)}`
}

// ---------------------------------------------------------------------------
// 学科档案模型
// ---------------------------------------------------------------------------

function normalizeLevel(raw, index) {
  const level = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    index,
    name: text(level.name, 120) || `第 ${index} 级`,
    understand: text(level.understand, 800),
    mastery: text(level.mastery, 800),
    milestone: text(level.milestone, 800),
    selfTest: text(level.selfTest, 800),
  }
}

function normalizeUnit(raw, index) {
  const unit = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    index,
    title: text(unit.title, 200) || `第 ${index} 单元`,
    concepts: text(unit.concepts, 1200),
    exercise: text(unit.exercise, 1200),
    deliverable: text(unit.deliverable, 800),
    pass: text(unit.pass, 800),
    hours: number(unit.hours, 2, 0.25, 40),
    done: unit.done === true,
    doneAt: typeof unit.doneAt === 'string' ? unit.doneAt : null,
  }
}

function normalizeResource(raw) {
  const resource = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    name: text(resource.name, 300),
    type: text(resource.type, 60),
    why: text(resource.why, 800),
    part: text(resource.part, 300),
    level: text(resource.level, 60),
    how: text(resource.how, 800),
    skip: text(resource.skip, 600),
  }
}

function normalizeGap(raw, index) {
  const gap = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(gap.id, 40) || `g${index}`,
    concept: text(gap.concept, 300),
    question: text(gap.question, 1200),
    answer: text(gap.answer, 4000),
    score: number(gap.score, 0, 0, 10),
    max: 10,
    gap: text(gap.gap, 1200),
    feedback: text(gap.feedback, 2000),
    independent: gap.independent === true ? true : gap.independent === false ? false : null,
    items: Array.isArray(gap.items)
      ? gap.items.slice(0, 10).map((item) => ({
          label: text(item?.label, 200),
          score: number(item?.score, 0, 0, 100),
          max: number(item?.max, 0, 0, 100),
        }))
      : [],
    source: text(gap.source, 500),
    level: number(gap.level, 0, 0, 5),
    at: typeof gap.at === 'string' ? gap.at : isoNow(),
  }
}

function normalizeFeynman(raw, index) {
  const entry = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(entry.id, 40) || `f${index}`,
    concept: text(entry.concept, 300),
    holes: text(entry.holes, 1200),
    passed: entry.passed === true,
    at: typeof entry.at === 'string' ? entry.at : isoNow(),
  }
}

function normalizeReview(raw) {
  const review = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    due: dateIso(review.due, ''),
    stage: number(review.stage, 1, 1, 20),
    done: review.done === true,
    doneAt: typeof review.doneAt === 'string' ? review.doneAt : null,
  }
}

function normalizePendingExam(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const question = text(raw.question, 2000)
  if (question === '') return null
  const status = raw.status === 'awaiting_grade' ? 'awaiting_grade' : 'awaiting_answer'
  return {
    questionId: text(raw.questionId, 40) || `q${Date.now()}`,
    question,
    concept: text(raw.concept, 300),
    level: number(raw.level, 0, 0, 5),
    askedAt: typeof raw.askedAt === 'string' ? raw.askedAt : isoNow(),
    answer: text(raw.answer, 4000),
    answerAt: typeof raw.answerAt === 'string' ? raw.answerAt : null,
    answerSeq: number(raw.answerSeq, 0, 0, 100000),
    status,
  }
}

function normalizeSubject(raw) {
  const subject = raw !== null && typeof raw === 'object' ? raw : {}
  const levels = Array.isArray(subject.ladder?.levels) ? subject.ladder.levels.slice(0, MAX_LEVELS) : []
  const units = Array.isArray(subject.plan?.units) ? subject.plan.units : []
  const gapLog = Array.isArray(subject.gapLog) ? subject.gapLog.slice(-MAX_GAPS) : []
  const feynman = Array.isArray(subject.feynman) ? subject.feynman.slice(-MAX_FEYNMAN) : []
  const resources = Array.isArray(subject.resources) ? subject.resources.slice(0, MAX_RESOURCES) : []
  const reviews = Array.isArray(subject.reviews) ? subject.reviews : []
  const scores = gapLog.map((gap) => number(gap?.score, 0, 0, 10))
  const average = scores.length === 0 ? null : Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10

  return {
    version: 1,
    id: text(subject.id, 60) || newSubjectId(),
    topic: text(subject.topic, 300),
    goal: text(subject.goal, 800),
    deadline: dateIso(subject.deadline, ''),
    budgetHours: number(subject.budgetHours, 20, 0.5, 400),
    baseline: text(subject.baseline, 800),
    status: ['active', 'paused', 'done'].includes(subject.status) ? subject.status : 'active',
    mainSessionId: text(subject.mainSessionId, 120) || null,
    mainSessionLabel: text(subject.mainSessionLabel, 200),
    sessionHistory: Array.isArray(subject.sessionHistory)
      ? subject.sessionHistory.slice(-MAX_SESSION_HISTORY).map((entry) => ({
          sessionId: text(entry?.sessionId, 120),
          label: text(entry?.label, 200),
          replacedAt: typeof entry?.replacedAt === 'string' ? entry.replacedAt : isoNow(),
        }))
      : [],
    createdAt: typeof subject.createdAt === 'string' ? subject.createdAt : isoNow(),
    updatedAt: typeof subject.updatedAt === 'string' ? subject.updatedAt : isoNow(),
    ladder: {
      current: number(subject.ladder?.current, levels.length === 0 ? 0 : 1, 0, MAX_LEVELS),
      levels: levels.map((level, index) => normalizeLevel(level, index + 1)),
    },
    plan: { units: units.map((unit, index) => normalizeUnit(unit, index + 1)) },
    resources: resources.map(normalizeResource),
    gapLog: gapLog.map((gap, index) => normalizeGap(gap, index + 1)),
    pendingExam: normalizePendingExam(subject.pendingExam),
    discardedExams: Array.isArray(subject.discardedExams)
      ? subject.discardedExams.slice(-MAX_DISCARDED).map((entry, index) => ({
          questionId: text(entry?.questionId, 40) || `d${index + 1}`,
          question: text(entry?.question, 2000),
          concept: text(entry?.concept, 300),
          level: number(entry?.level, 0, 0, 5),
          answer: text(entry?.answer, 4000),
          askedAt: typeof entry?.askedAt === 'string' ? entry.askedAt : isoNow(),
          discardedAt: typeof entry?.discardedAt === 'string' ? entry.discardedAt : isoNow(),
        }))
      : [],
    feynman: feynman.map((entry, index) => normalizeFeynman(entry, index + 1)),
    cheatsheet: typeof subject.cheatsheet?.markdown === 'string' && subject.cheatsheet.markdown.trim() !== ''
      ? {
          markdown: subject.cheatsheet.markdown,
          savedAt: typeof subject.cheatsheet.savedAt === 'string' ? subject.cheatsheet.savedAt : isoNow(),
        }
      : null,
    reviews: reviews.map(normalizeReview),
    // 掌握度与计划完成度分开：done 只表示计划进度，这里记录独立通过 / 隔天复测 / 仅提示后完成。
    unitMastery: Array.isArray(subject.unitMastery)
      ? subject.unitMastery
          .filter((entry) => Number.isFinite(Number(entry?.unitIndex)))
          .slice(-200)
          .map((entry) => ({
            unitIndex: number(entry.unitIndex, 1, 1, 200),
            independentPassAt: typeof entry.independentPassAt === 'string' ? entry.independentPassAt : null,
            reviewPassAt: typeof entry.reviewPassAt === 'string' ? entry.reviewPassAt : null,
            promptedOnlyAt: typeof entry.promptedOnlyAt === 'string' ? entry.promptedOnlyAt : null,
            note: text(entry.note, 500),
          }))
      : [],
    stats: {
      examRounds: Number.isInteger(subject.stats?.examRounds) ? subject.stats.examRounds : gapLog.length,
      avgScore: typeof subject.stats?.avgScore === 'number' ? subject.stats.avgScore : average,
      feynmanRounds: Number.isInteger(subject.stats?.feynmanRounds) ? subject.stats.feynmanRounds : feynman.length,
    },
  }
}

// ---------------------------------------------------------------------------
// 存储：subjects/<id>.json + active.json
// ---------------------------------------------------------------------------

const writeQueues = new Map()
const mutationQueues = new Map()

/**
 * 学科变更事务：把「读最新档案 → 修改 → 原子写回」整段串行化。
 * 只给 writeJson 排队是不够的——两个并发调用会各自读到旧档案，后写的覆盖先写的。
 * 所有写路径（study_write 工具、新建学科、提交答案、切换学科）都必须经过这里。
 */
function withMutation(key, task) {
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  mutationQueues.set(key, next.catch(() => {}))
  return next
}

function subjectsDir(dataDir) {
  return join(dataDir, 'subjects')
}

function subjectFile(dataDir, id) {
  return join(subjectsDir(dataDir), `${id}.json`)
}

function enqueueWrite(file, task) {
  const previous = writeQueues.get(file) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  writeQueues.set(file, next.catch(() => {}))
  return next
}

async function writeJson(file, value) {
  return enqueueWrite(file, async () => {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
    return value
  })
}

async function readJson(file) {
  const raw = await readFile(file, 'utf8')
  return JSON.parse(raw)
}

async function listSubjects(dataDir) {
  let names
  try {
    names = await readdir(subjectsDir(dataDir))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const subjects = []
  for (const fileName of names) {
    if (!fileName.endsWith('.json')) continue
    try {
      subjects.push(normalizeSubject(await readJson(join(subjectsDir(dataDir), fileName))))
    } catch {
      // 单个学科文件损坏时跳过，不让整页崩。
    }
  }
  subjects.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0))
  return subjects
}

async function readActiveId(dataDir) {
  try {
    const record = await readJson(join(dataDir, 'active.json'))
    return typeof record?.activeSubjectId === 'string' ? record.activeSubjectId : null
  } catch {
    return null
  }
}

async function writeActiveId(dataDir, subjectId) {
  await writeJson(join(dataDir, 'active.json'), { activeSubjectId: subjectId, updatedAt: isoNow() })
}

async function selectActive(dataDir, subjects) {
  const activeId = await readActiveId(dataDir)
  return subjects.find((subject) => subject.id === activeId) ?? subjects[0] ?? null
}

async function saveSubject(dataDir, subject) {
  subject.updatedAt = isoNow()
  await writeJson(subjectFile(dataDir, subject.id), subject)
  return subject
}

// ---------------------------------------------------------------------------
// 派生视图
// ---------------------------------------------------------------------------

function subjectSummary(subject) {
  const units = subject.plan.units
  const done = units.filter((unit) => unit.done).length
  const next = units.find((unit) => !unit.done) ?? null
  const today = todayIso()
  return {
    id: subject.id,
    topic: subject.topic,
    status: subject.status,
    progressPct: units.length === 0 ? 0 : Math.round((done / units.length) * 100),
    // 会话内挂件按 mainSessionId 认领自己的学科，所以摘要里必须带绑定关系。
    mainSessionId: subject.mainSessionId,
    unitsDone: done,
    unitsTotal: units.length,
    nextUnitTitle: next === null ? '' : next.title,
    pendingStatus: subject.pendingExam === null ? null : subject.pendingExam.status,
    dueReviews: subject.reviews.filter((review) => !review.done && review.due !== '' && review.due <= today).length,
  }
}

function buildDerived(subject) {
  const levels = subject.ladder.levels
  const current = subject.ladder.current
  const units = subject.plan.units
  const doneUnits = units.filter((unit) => unit.done)
  const minutesDone = Math.round(doneUnits.reduce((sum, unit) => sum + unit.hours, 0) * 60)
  const nextUnit = units.find((unit) => !unit.done) ?? null
  const today = todayIso()
  const dueReviews = subject.reviews
    .filter((review) => !review.done && review.due !== '')
    .map((review) => ({ due: review.due, stage: review.stage, overdue: review.due < today }))
    .sort((left, right) => (left.due < right.due ? -1 : left.due > right.due ? 1 : 0))
  const topGaps = [...subject.gapLog]
    .sort((left, right) => left.score - right.score)
    .slice(0, 5)
    .map((gap) => ({ concept: gap.concept, score: gap.score, max: gap.max, gap: gap.gap }))
  const mastery = subject.unitMastery
  const independentUnits = mastery.filter((entry) => entry.independentPassAt !== null).length
  const reviewedUnits = mastery.filter((entry) => entry.reviewPassAt !== null).length

  return {
    currentLevelName: current > 0 && levels[current - 1] !== undefined ? levels[current - 1].name : null,
    levelsTotal: levels.length,
    unitsTotal: units.length,
    unitsDone: doneUnits.length,
    minutesDone,
    nextUnit: nextUnit === null ? null : { index: nextUnit.index, title: nextUnit.title, hours: nextUnit.hours },
    dueReviews,
    topGaps,
    progressPct: units.length === 0 ? 0 : Math.round((doneUnits.length / units.length) * 100),
    mastery: { independentUnits, reviewedUnits, totalUnits: units.length },
    mainSessionId: subject.mainSessionId,
  }
}

async function buildState(dataDir) {
  const subjects = await listSubjects(dataDir)
  const active = await selectActive(dataDir, subjects)
  return {
    ok: true,
    generatedAt: isoNow(),
    active: active === null
      ? null
      : { subject: active, derived: buildDerived(active), pendingExam: active.pendingExam },
    subjects: subjects.map(subjectSummary),
  }
}

// ---------------------------------------------------------------------------
// 写入动作
// ---------------------------------------------------------------------------

function pickSubject(subjects, active, key) {
  const wanted = text(key, 300)
  if (wanted !== '') {
    const lowered = wanted.toLowerCase()
    const byId = subjects.find((subject) => subject.id.toLowerCase() === lowered)
    if (byId !== undefined) return byId
    const byTopic = subjects.find((subject) => subject.topic.toLowerCase().includes(lowered))
    if (byTopic !== undefined) return byTopic
    throw new Error(`找不到匹配「${wanted}」的学科；先 study_read 看看现有学科。`)
  }
  if (active === null) throw new Error('还没有任何学科；先用 action=create 建一个。')
  return active
}

function createSubject(subjects, args) {
  const topic = text(args.topic, 300)
  if (topic === '') throw new Error('create 需要 topic（要学的学科或主题）。')
  if (subjects.some((subject) => subject.topic === topic)) {
    throw new Error(`已经有一个叫「${topic}」的学科；直接继续用它。`)
  }
  return normalizeSubject({
    id: newSubjectId(),
    topic,
    goal: args.goal,
    deadline: args.deadline,
    budgetHours: args.budgetHours,
    baseline: args.baseline,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  })
}

function updateSubject(subject, args) {
  if (args.topic !== undefined) subject.topic = text(args.topic, 300) || subject.topic
  if (args.goal !== undefined) subject.goal = text(args.goal, 800)
  if (args.deadline !== undefined) subject.deadline = dateIso(args.deadline, '')
  if (args.budgetHours !== undefined) subject.budgetHours = number(args.budgetHours, subject.budgetHours, 0.5, 400)
  if (args.baseline !== undefined) subject.baseline = text(args.baseline, 800)
  if (args.status !== undefined) {
    const status = text(args.status, 20)
    if (!['active', 'paused', 'done'].includes(status)) throw new Error('status 只能是 active / paused / done。')
    subject.status = status
  }
  return subject
}

function setLadder(subject, args) {
  if (!Array.isArray(args.levels) || args.levels.length === 0) throw new Error('set_ladder 需要 levels 数组（最多 5 级）。')
  subject.ladder.levels = args.levels.slice(0, MAX_LEVELS).map((level, index) => normalizeLevel(level, index + 1))
  subject.ladder.current = args.currentLevel !== undefined
    ? number(args.currentLevel, subject.ladder.current, 0, subject.ladder.levels.length)
    : Math.min(Math.max(subject.ladder.current, 1), subject.ladder.levels.length)
  return subject
}

function setPlan(subject, args) {
  if (!Array.isArray(args.units) || args.units.length === 0) throw new Error('set_plan 需要 units 数组。')
  const previous = new Map(subject.plan.units.map((unit) => [unit.index, unit]))
  subject.plan.units = args.units.map((unit, index) => {
    const normalized = normalizeUnit(unit, index + 1)
    const old = previous.get(normalized.index)
    if (normalized.done !== true && old !== undefined && old.done === true && old.title === normalized.title) {
      normalized.done = true
      normalized.doneAt = old.doneAt
    }
    return normalized
  })
  return subject
}

function setResources(subject, args) {
  if (!Array.isArray(args.resources)) throw new Error('set_resources 需要 resources 数组（最多 5 条）。')
  subject.resources = args.resources.slice(0, MAX_RESOURCES).map(normalizeResource).filter((resource) => resource.name !== '')
  return subject
}

function askExam(subject, args) {
  const question = text(args.question, 2000)
  if (question === '') throw new Error('ask_exam 需要 question（题目正文）。')
  const current = subject.pendingExam
  if (current !== null) {
    if (args.replace !== true) {
      throw new Error(
        `还有一道未完成的题（${current.questionId}，状态 ${current.status}）：先让用户作答并评分，或显式传 replace=true 跳过它（跳过的题会保留在 discardedExams）。`,
      )
    }
    subject.discardedExams.push({
      questionId: current.questionId,
      question: current.question,
      concept: current.concept,
      level: current.level,
      answer: current.answer,
      askedAt: current.askedAt,
      discardedAt: isoNow(),
    })
    if (subject.discardedExams.length > MAX_DISCARDED) subject.discardedExams = subject.discardedExams.slice(-MAX_DISCARDED)
  }
  subject.pendingExam = normalizePendingExam({
    questionId: `q${(subject.gapLog?.length ?? 0) + 1}-${Date.now().toString(36)}`,
    question,
    concept: args.concept,
    level: args.level,
    askedAt: isoNow(),
    answer: '',
    answerSeq: 0,
    status: 'awaiting_answer',
  })
  return subject
}

function gradeExam(subject, args) {
  const pending = subject.pendingExam
  if (pending === null) throw new Error('没有待评分的考试；先用 ask_exam 出题。')
  if (pending.status !== 'awaiting_grade') throw new Error('这道题还没有人作答；等用户在面板或对话里提交答案后再评分。')
  const questionId = text(args.questionId, 40)
  if (questionId === '') {
    throw new Error(`grade_exam 需要 questionId（当前待评分题是 ${pending.questionId}；先 study_read 读最新档案）。`)
  }
  if (questionId !== pending.questionId) {
    throw new Error(`questionId 不匹配：传的是 ${questionId}，当前待评分题是 ${pending.questionId}。可能读到了过期档案，先 study_read 再评分。`)
  }
  const answerSeq = number(args.answerSeq, NaN, 0, 100000)
  if (!Number.isFinite(answerSeq)) {
    throw new Error(`grade_exam 需要 answerSeq（当前答案版本是 ${pending.answerSeq}；先 study_read 读最新档案）。`)
  }
  if (answerSeq !== pending.answerSeq) {
    throw new Error(`answerSeq 不匹配：传的是 ${answerSeq}，当前答案是第 ${pending.answerSeq} 版。用户可能改过答案，先 study_read 再评分。`)
  }
  const score = number(args.score, NaN, 0, 10)
  if (!Number.isFinite(score)) throw new Error('grade_exam 需要 score（0-10）。')
  subject.gapLog.push(normalizeGap({
    id: `g${subject.gapLog.length + 1}`,
    concept: pending.concept,
    question: pending.question,
    answer: pending.answer,
    score,
    gap: args.gap,
    feedback: args.feedback,
    independent: args.independent,
    items: Array.isArray(args.items) ? args.items : [],
    source: typeof args.source === 'string'
      ? args.source
      : args.source !== null && typeof args.source === 'object'
        ? [args.source.file, args.source.page === undefined ? '' : `第 ${args.source.page} 页`, args.source.note]
            .filter((part) => typeof part === 'string' && part !== '')
            .join(' · ')
        : '',
    level: pending.level,
    at: isoNow(),
  }, subject.gapLog.length + 1))
  if (subject.gapLog.length > MAX_GAPS) subject.gapLog = subject.gapLog.slice(-MAX_GAPS)
  subject.stats.examRounds = subject.stats.examRounds + 1
  const scores = subject.gapLog.map((entry) => entry.score)
  subject.stats.avgScore = Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10
  subject.pendingExam = null
  return subject
}

function logFeynman(subject, args) {
  const concept = text(args.concept, 300)
  if (concept === '') throw new Error('log_feynman 需要 concept（复述的概念）。')
  subject.feynman.push(normalizeFeynman({
    id: `f${subject.feynman.length + 1}`,
    concept,
    holes: args.holes ?? args.gap,
    passed: args.passed === true,
    at: isoNow(),
  }, subject.feynman.length + 1))
  if (subject.feynman.length > MAX_FEYNMAN) subject.feynman = subject.feynman.slice(-MAX_FEYNMAN)
  subject.stats.feynmanRounds = subject.stats.feynmanRounds + 1
  return subject
}

function saveCheatsheet(subject, args) {
  const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : ''
  if (markdown === '') throw new Error('save_cheatsheet 需要 markdown（一页速查表正文）。')
  subject.cheatsheet = { markdown: markdown.slice(0, 20000), savedAt: isoNow() }
  return subject
}

function completeUnit(subject, args) {
  const index = number(args.unitIndex, NaN, 1, 200)
  if (!Number.isFinite(index)) throw new Error('complete_unit 需要 unitIndex（从 1 开始）。')
  const unit = subject.plan.units.find((entry) => entry.index === index)
  if (unit === undefined) throw new Error(`没有第 ${index} 个单元；先 study_read 看计划。`)
  const done = args.done !== false
  unit.done = done
  unit.doneAt = done ? isoNow() : null
  return subject
}

function scheduleReviews(subject, args) {
  const dates = Array.isArray(args.dates) && args.dates.length > 0
    ? args.dates.map((date) => dateIso(date, '')).filter((date) => date !== '')
    : [shiftDays(1), shiftDays(3), shiftDays(7)]
  if (dates.length === 0) throw new Error('schedule_reviews 的 dates 里没有合法日期（YYYY-MM-DD）。')
  subject.reviews = dates.map((due, index) => {
    const existing = subject.reviews.find((review) => review.due === due)
    return { due, stage: index + 1, done: existing?.done === true, doneAt: existing?.doneAt ?? null }
  })
  return subject
}

function completeReview(subject, args) {
  const due = dateIso(args.due, '')
  let review
  if (due !== '') review = subject.reviews.find((entry) => entry.due === due && !entry.done)
  else if (args.reviewIndex !== undefined) review = subject.reviews[number(args.reviewIndex, 1, 1, 200) - 1]
  else review = subject.reviews.find((entry) => !entry.done)
  if (review === undefined) throw new Error('没有可标记完成的复测；用 study_read 查看 reviews。')
  review.done = true
  review.doneAt = isoNow()
  return subject
}

function bindSession(subject, args, callerSessionId) {
  const next = text(args.sessionId, 120) || callerSessionId
  if (next === null || next === '') {
    throw new Error('bind_session 需要 sessionId，或在某个对话里调用（会自动取当前对话）。')
  }
  if (subject.mainSessionId !== null && subject.mainSessionId !== next) {
    subject.sessionHistory.push({
      sessionId: subject.mainSessionId,
      label: subject.mainSessionLabel,
      replacedAt: isoNow(),
    })
    if (subject.sessionHistory.length > MAX_SESSION_HISTORY) {
      subject.sessionHistory = subject.sessionHistory.slice(-MAX_SESSION_HISTORY)
    }
  }
  subject.mainSessionId = next
  subject.mainSessionLabel = text(args.sessionLabel, 200)
  return subject
}

function requireMainSession(subject, callerSessionId, action) {
  if (subject.mainSessionId === null || callerSessionId === null) return
  if (subject.mainSessionId !== callerSessionId) {
    throw new Error(
      `学科「${subject.topic}」绑定的伴学对话是 ${subject.mainSessionId}；${action} 要回到那个对话里做，或先用 action=bind_session 显式更换主对话。`,
    )
  }
}

function recordMastery(subject, args) {
  const index = number(args.unitIndex, NaN, 1, 200)
  if (!Number.isFinite(index)) throw new Error('record_mastery 需要 unitIndex（从 1 开始）。')
  const unit = subject.plan.units.find((entry) => entry.index === index)
  if (unit === undefined) throw new Error(`没有第 ${index} 个单元；先 study_read 看计划。`)
  const kind = text(args.kind, 20)
  if (!['independent', 'review', 'prompted'].includes(kind)) {
    throw new Error('record_mastery 的 kind 只能是 independent（当次独立通过）/ review（隔天复测通过）/ prompted（提示后才完成）。')
  }
  let entry = subject.unitMastery.find((item) => item.unitIndex === index)
  if (entry === undefined) {
    entry = { unitIndex: index, independentPassAt: null, reviewPassAt: null, promptedOnlyAt: null, note: '' }
    subject.unitMastery.push(entry)
  }
  const passed = args.passed !== false
  if (kind === 'independent') {
    if (passed) entry.independentPassAt = isoNow()
    else entry.independentPassAt = null
  } else if (kind === 'review') {
    if (passed) entry.reviewPassAt = isoNow()
    else entry.reviewPassAt = null
  } else {
    entry.promptedOnlyAt = isoNow()
  }
  if (args.note !== undefined) entry.note = text(args.note, 500)
  return subject
}


// ---------------------------------------------------------------------------
// v4：课程 / 课次 / 锚点 / 笔记 / 偏好
//
// 设计约束（见 CONTRACT §8）：
//  - 媒体与长转写只按引用保存，不进 subject 快照、不进答案接口。
//  - 没有播放器接口时 mediaOffsetSec 必须是 null；页面显示的授课时刻只能进 observedClock。
//  - 生成内容必须落在 generated[] / sections[].status="generated"，不得附原课时间点。
// ---------------------------------------------------------------------------

function coursesDir(dataDir) {
  return join(dataDir, 'courses')
}

function lessonsDir(dataDir) {
  return join(dataDir, 'lessons')
}

function courseFile(dataDir, id) {
  return join(coursesDir(dataDir), `${id}.json`)
}

function lessonFile(dataDir, id) {
  return join(lessonsDir(dataDir), `${id}.json`)
}

function prefsFile(dataDir) {
  return join(dataDir, 'prefs.json')
}

function shortId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function normalizeCourse(raw) {
  const course = raw !== null && typeof raw === 'object' ? raw : {}
  const platform = text(course.platform, 40)
  return {
    id: text(course.id, 60) || shortId('c'),
    subjectId: text(course.subjectId, 60),
    title: text(course.title, 300) || '未命名课程',
    platform: ['yuketang', 'bilibili', 'xuetangx', 'other'].includes(platform) ? platform : 'other',
    url: text(course.url, 1000),
    createdAt: typeof course.createdAt === 'string' ? course.createdAt : isoNow(),
    updatedAt: typeof course.updatedAt === 'string' ? course.updatedAt : isoNow(),
  }
}

function normalizeMaterial(raw, index) {
  const material = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(material.id, 40) || `m${index + 1}`,
    kind: ['slide', 'pdf', 'image', 'url', 'captions'].includes(material.kind) ? material.kind : 'url',
    title: text(material.title, 300),
    ref: text(material.ref, 1000),
    version: text(material.version, 100),
  }
}

function normalizeAnchor(raw, index) {
  const anchor = raw !== null && typeof raw === 'object' ? raw : {}
  const kind = ['slide', 'media', 'note', 'material'].includes(anchor.kind) ? anchor.kind : 'media'
  const confidence = ['declared', 'observed', 'inferred'].includes(anchor.confidence) ? anchor.confidence : 'declared'
  const startSec = optionalNumber(anchor.startSec, 0, 400000)
  const endSec = optionalNumber(anchor.endSec, 0, 400000)
  return {
    id: text(anchor.id, 40) || `a${index + 1}`,
    kind,
    materialId: text(anchor.materialId, 40),
    page: optionalNumber(anchor.page, 1, 20000) === null ? null : Math.round(optionalNumber(anchor.page, 1, 20000)),
    region: text(anchor.region, 200),
    // slide 锚点也可以带「该课件页在录像里的起止秒」，所以不按 kind 丢弃。
    startSec,
    endSec,
    aligned: anchor.aligned === true,
    observedClock: text(anchor.observedClock, 40),
    label: text(anchor.label, 300),
    confidence,
  }
}

function normalizeKnowledge(raw, index) {
  const knowledge = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(knowledge.id, 40) || `k${index + 1}`,
    name: text(knowledge.name, 200),
    anchorIds: Array.isArray(knowledge.anchorIds) ? knowledge.anchorIds.map((id) => text(id, 40)).filter(Boolean) : [],
  }
}

function normalizeMark(raw, index) {
  const mark = raw !== null && typeof raw === 'object' ? raw : {}
  const kind = ['important', 'confused', 'think', 'question'].includes(mark.kind) ? mark.kind : 'important'
  return {
    id: text(mark.id, 40) || `mk${index + 1}`,
    kind,
    text: text(mark.text, 2000),
    at: typeof mark.at === 'string' ? mark.at : isoNow(),
    observedClock: text(mark.observedClock, 40),
    mediaOffsetSec: optionalNumber(mark.mediaOffsetSec, 0, 400000),
    pauseRequested: mark.pauseRequested === true,
  }
}

function normalizeNote(raw, index) {
  const note = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(note.id, 40) || `n${index + 1}`,
    title: text(note.title, 300) || '未命名笔记',
    intuition: text(note.intuition, 3000),
    example: text(note.example, 4000),
    formula: text(note.formula, 4000),
    conditions: text(note.conditions, 3000),
    pitfalls: text(note.pitfalls, 3000),
    sourcePoints: Array.isArray(note.sourcePoints) ? note.sourcePoints.map((line) => text(line, 1000)).filter(Boolean) : [],
    generated: Array.isArray(note.generated) ? note.generated.map((line) => text(line, 2000)).filter(Boolean) : [],
    anchorIds: Array.isArray(note.anchorIds) ? note.anchorIds.map((id) => text(id, 40)).filter(Boolean) : [],
    knowledgeIds: Array.isArray(note.knowledgeIds) ? note.knowledgeIds.map((id) => text(id, 40)).filter(Boolean) : [],
    tags: Array.isArray(note.tags) ? note.tags.map((tag) => text(tag, 60)).filter(Boolean) : [],
    status: ['user_edited', 'agent', 'draft'].includes(note.status) ? note.status : 'agent',
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : isoNow(),
  }
}

function normalizeBlock(raw) {
  const block = raw !== null && typeof raw === 'object' ? raw : {}
  const kind = ['text', 'example', 'formula', 'question'].includes(block.kind) ? block.kind : 'text'
  return { kind, body: text(block.body, 4000) }
}

function normalizeSection(raw, index) {
  const section = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(section.id, 40) || `sec${index + 1}`,
    title: text(section.title, 300) || '补充讲解',
    objective: text(section.objective, 1000),
    prerequisites: text(section.prerequisites, 1000),
    blocks: Array.isArray(section.blocks) ? section.blocks.slice(0, 40).map(normalizeBlock) : [],
    sourceRefIds: Array.isArray(section.sourceRefIds) ? section.sourceRefIds.map((id) => text(id, 40)).filter(Boolean) : [],
    status: section.status === 'excerpt' ? 'excerpt' : 'generated',
    createdAt: typeof section.createdAt === 'string' ? section.createdAt : isoNow(),
  }
}

function normalizeTrace(raw, index) {
  const trace = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    id: text(trace.id, 40) || `t${index + 1}`,
    concept: text(trace.concept, 300),
    gapId: text(trace.gapId, 40),
    anchorIds: Array.isArray(trace.anchorIds) ? trace.anchorIds.map((id) => text(id, 40)).filter(Boolean) : [],
    noteIds: Array.isArray(trace.noteIds) ? trace.noteIds.map((id) => text(id, 40)).filter(Boolean) : [],
    at: typeof trace.at === 'string' ? trace.at : isoNow(),
  }
}

function normalizeLesson(raw) {
  const lesson = raw !== null && typeof raw === 'object' ? raw : {}
  const capabilityValue = (value) => (['available', 'unavailable', 'unverified'].includes(value) ? value : 'unverified')
  const capabilities = lesson.capabilities !== null && typeof lesson.capabilities === 'object' ? lesson.capabilities : {}
  const playback = lesson.playback !== null && typeof lesson.playback === 'object' ? lesson.playback : {}
  const status = ['playing', 'paused', 'unknown'].includes(playback.status) ? playback.status : 'unknown'
  return {
    id: text(lesson.id, 60) || shortId('l'),
    courseId: text(lesson.courseId, 60),
    subjectId: text(lesson.subjectId, 60),
    title: text(lesson.title, 300) || '未命名课次',
    state: lesson.state === 'closed' ? 'closed' : 'open',
    startedAt: typeof lesson.startedAt === 'string' ? lesson.startedAt : isoNow(),
    endedAt: typeof lesson.endedAt === 'string' ? lesson.endedAt : null,
    capabilities: {
      mediaTime: capabilityValue(capabilities.mediaTime),
      seek: capabilityValue(capabilities.seek),
      pause: capabilityValue(capabilities.pause),
      slides: capabilityValue(capabilities.slides),
      captions: capabilityValue(capabilities.captions),
      grab: capabilityValue(capabilities.grab),
    },
    playback: {
      status,
      mediaOffsetSec: optionalNumber(playback.mediaOffsetSec, 0, 400000),
      rate: optionalNumber(playback.rate, 0.1, 8),
      source: playback.source === 'adapter' ? 'adapter' : 'declared',
      updatedAt: typeof playback.updatedAt === 'string' ? playback.updatedAt : isoNow(),
    },
    materials: Array.isArray(lesson.materials) ? lesson.materials.slice(0, 100).map(normalizeMaterial) : [],
    anchors: Array.isArray(lesson.anchors) ? lesson.anchors.slice(0, 500).map(normalizeAnchor) : [],
    knowledge: Array.isArray(lesson.knowledge) ? lesson.knowledge.slice(0, 300).map(normalizeKnowledge) : [],
    marks: Array.isArray(lesson.marks) ? lesson.marks.slice(-200).map(normalizeMark) : [],
    notes: Array.isArray(lesson.notes) ? lesson.notes.slice(-300).map(normalizeNote) : [],
    sections: Array.isArray(lesson.sections) ? lesson.sections.slice(-100).map(normalizeSection) : [],
    trace: Array.isArray(lesson.trace) ? lesson.trace.slice(-200).map(normalizeTrace) : [],
    calibration: lesson.calibration !== null && typeof lesson.calibration === 'object'
      ? {
          method: text(lesson.calibration.method, 60),
          classStartEpoch: Number.isFinite(Number(lesson.calibration.classStartEpoch)) ? Number(lesson.calibration.classStartEpoch) : null,
          videoDurationSec: optionalNumber(lesson.calibration.videoDurationSec, 0, 400000),
          source: text(lesson.calibration.source, 80),
          derivedAt: typeof lesson.calibration.derivedAt === 'string' ? lesson.calibration.derivedAt : isoNow(),
        }
      : null,
  }
}

function normalizePrefs(raw) {
  const prefs = raw !== null && typeof raw === 'object' ? raw : {}
  const defaultOrder = ['intuition', 'visual', 'example', 'formula', 'conditions', 'pitfalls']
  const normalizeStyle = (style) => {
    const value = style !== null && typeof style === 'object' ? style : {}
    const order = Array.isArray(value.order) && value.order.length > 0
      ? value.order.filter((item) => defaultOrder.includes(item))
      : []
    return {
      order: order.length > 0 ? order : defaultOrder,
      language: text(value.language, 20) || 'zh',
      notation: text(value.notation, 200),
      ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    }
  }
  const subjects = {}
  const rawSubjects = prefs.subjects !== null && typeof prefs.subjects === 'object' ? prefs.subjects : {}
  for (const [key, value] of Object.entries(rawSubjects)) {
    if (/^s_[A-Za-z0-9_]+$/u.test(key) || key.length < 80) subjects[key] = normalizeStyle(value)
  }
  return { global: normalizeStyle(prefs.global), subjects }
}

async function listJsonDir(dir, normalize) {
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const items = []
  for (const fileName of names) {
    if (!fileName.endsWith('.json')) continue
    try {
      items.push(normalize(JSON.parse(await readFile(join(dir, fileName), 'utf8'))))
    } catch {
      // 单个文件损坏时跳过。
    }
  }
  return items
}

async function listCourses(dataDir) {
  return listJsonDir(coursesDir(dataDir), normalizeCourse)
}

async function listLessons(dataDir) {
  return listJsonDir(lessonsDir(dataDir), normalizeLesson)
}

async function readLessonById(dataDir, lessonId) {
  try {
    return normalizeLesson(JSON.parse(await readFile(lessonFile(dataDir, lessonId), 'utf8')))
  } catch {
    return null
  }
}

async function saveLesson(dataDir, lesson) {
  lesson.updatedAt = isoNow()
  await writeJson(lessonFile(dataDir, lesson.id), { ...lesson, version: 1 })
  return lesson
}

async function saveCourse(dataDir, course) {
  course.updatedAt = isoNow()
  await writeJson(courseFile(dataDir, course.id), { ...course, version: 1 })
  return course
}

async function readPrefs(dataDir) {
  try {
    return normalizePrefs(JSON.parse(await readFile(prefsFile(dataDir), 'utf8')))
  } catch {
    return normalizePrefs({})
  }
}

async function savePrefs(dataDir, prefs) {
  prefs.global = { ...prefs.global, updatedAt: isoNow() }
  await writeJson(prefsFile(dataDir), { version: 1, ...prefs })
  return prefs
}

function mergedPrefs(prefs, subjectId) {
  const override = prefs.subjects[subjectId] ?? null
  return override === null
    ? { scope: 'global', ...prefs.global }
    : { scope: 'subject', ...prefs.global, ...override, order: override.order }
}

function lessonSummary(lesson) {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    subjectId: lesson.subjectId,
    title: lesson.title,
    state: lesson.state,
    startedAt: lesson.startedAt,
    endedAt: lesson.endedAt,
    playbackStatus: lesson.playback.status,
    mediaOffsetSec: lesson.playback.mediaOffsetSec,
    marks: lesson.marks.length,
    notes: lesson.notes.length,
    anchors: lesson.anchors.length,
    slideAnchors: lesson.anchors.filter((anchor) => anchor.kind === 'slide').length,
    sections: lesson.sections.length,
  }
}

async function pickLessonForWrite(dataDir, subject, args, strict) {
  const lessonId = text(args.lessonId, 60)
  if (lessonId !== '') {
    const lesson = await readLessonById(dataDir, lessonId)
    if (lesson === null) throw new Error(`找不到课次 ${lessonId}；先 lesson_read 看现有课次。`)
    if (lesson.subjectId !== subject.id) throw new Error('该课次不属于当前学科：课次与学科不能串写。')
    return lesson
  }
  const lessons = (await listLessons(dataDir))
    .filter((lesson) => lesson.subjectId === subject.id)
    .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1))
  const open = lessons.find((lesson) => lesson.state === 'open')
  if (open !== undefined) return open
  if (strict === true) throw new Error('没有打开中的课次；先在网页开始听课时调用 lesson_open。')
  return lessons[0] ?? null
}

/**
 * 用 Safari 适配器读一次媒体状态并写回课次。
 * 拿不到 JavaScript 权限时绝不写入假位置：只回传错误与建议。
 */
async function syncLessonFromSafari(lesson) {
  const result = await readMediaState({ preferPlatforms: ['yuketang', 'bilibili', 'xuetangx'] })
  if (result.ok !== true) {
    return {
      ok: false,
      javascript: result.javascript,
      media: null,
      message: 'Safari 未允许执行 JavaScript，媒体位置保持未知；不写入任何推测值。',
      lesson,
    }
  }
  const media = result.media
  if (media === null || media.hasVideo !== true || media.video === null) {
    return { ok: true, javascript: result.javascript, media, message: '当前标签页没有可读的 <video>，媒体位置保持未知。', lesson }
  }
  lesson.playback = {
    status: media.video.paused === true ? 'paused' : 'playing',
    mediaOffsetSec: media.video.currentTime,
    rate: media.video.playbackRate,
    source: 'adapter',
    updatedAt: isoNow(),
  }
  lesson.capabilities.mediaTime = 'available'
  lesson.capabilities.pause = 'available'
  lesson.capabilities.seek = 'available'

  // 课件页：页码 + 页面授课时刻 + （可推定时）媒体起止秒。
  //
  // 对齐方法：雨课堂回放的 iframe 里，每个课件项带 data-dt（直播墙钟毫秒）与「放映X分Y秒」。
  // 墙钟间隔与逐页放映时长在多个点互相吻合（误差 ≤1s），因此可用
  //   classStart = 最后一项 dt + 最后一项时长 − 视频总时长
  //   startSec   = (dt − classStart)/1000
  // 推定媒体坐标。已用「seek → 播放 → 截帧」与课件封面做三点比对验证（67s/2073s/3567s）。
  // 仍标记 confidence=inferred：推定值，可复算，不等同播放器直接读出。
  const slideItems = Array.isArray(media.slideItems) ? media.slideItems : []
  let imported = 0
  let aligned = 0
  if (slideItems.length > 0) {
    lesson.capabilities.slides = 'available'
    if (lesson.materials.length === 0) {
      lesson.materials.push(normalizeMaterial({
        id: 'm1',
        kind: 'slide',
        title: '雨课堂课件（页面抓取）',
        ref: result.tab !== undefined && result.tab !== null ? result.tab.url : '',
        version: '',
      }, 0))
    }
    const parsed = slideItems
      .map((item) => {
        const pageMatch = String(item.text ?? '').match(/P\s?(\d+)/u)
        const durationMatch = String(item.text ?? '').match(/放映(?:(\d+)分)?(\d+)秒/u)
        const dt = Number(item.dt)
        if (pageMatch === null || !Number.isFinite(dt)) return null
        const minutes = durationMatch !== null && durationMatch[1] !== undefined ? Number(durationMatch[1]) : 0
        const seconds = durationMatch !== null ? Number(durationMatch[2]) : 0
        return { page: Number(pageMatch[1]), clock: item.clock ?? '', dt, durationSec: minutes * 60 + seconds, text: String(item.text ?? '').slice(0, 200) }
      })
      .filter((item) => item !== null)

    let calibration = null
    if (parsed.length > 0) {
      const last = parsed[parsed.length - 1]
      const classStartEpoch = last.dt + last.durationSec * 1000 - (Number.isFinite(Number(media.video.duration)) ? Number(media.video.duration) : 0) * 1000
      if (Number.isFinite(classStartEpoch)) {
        calibration = {
          method: 'wall-clock-delta',
          classStartEpoch,
          videoDurationSec: Number.isFinite(Number(media.video.duration)) ? Number(media.video.duration) : null,
          source: 'yuketang-slide-list',
          derivedAt: isoNow(),
        }
        lesson.calibration = calibration
      }
    }

    const byKey = new Map(lesson.anchors.map((anchor, index) => [`${anchor.page}|${anchor.observedClock}`, index]))
    for (const item of parsed) {
      const key = `${item.page}|${item.clock}`
      const existingIndex = byKey.get(key)
      const timing = calibration === null
        ? {}
        : {
            startSec: Math.max(0, Math.round((item.dt - calibration.classStartEpoch) / 100) / 10),
            endSec: Math.max(0, Math.round((item.dt - calibration.classStartEpoch + item.durationSec * 1000) / 100) / 10),
            aligned: true,
          }
      if (existingIndex !== undefined) {
        const existing = lesson.anchors[existingIndex]
        if (timing.startSec !== undefined && (existing.startSec === null || existing.startSec === undefined)) {
          lesson.anchors[existingIndex] = normalizeAnchor({ ...existing, ...timing, confidence: 'inferred' }, existingIndex)
          aligned += 1
        }
        continue
      }
      byKey.set(key, lesson.anchors.length)
      lesson.anchors.push(normalizeAnchor({
        id: `a${lesson.anchors.length + 1}`,
        kind: 'slide',
        materialId: 'm1',
        page: item.page,
        observedClock: item.clock,
        label: item.text,
        confidence: timing.startSec === undefined ? 'observed' : 'inferred',
        ...timing,
      }, lesson.anchors.length))
      imported += 1
      if (timing.startSec !== undefined) aligned += 1
      if (lesson.anchors.length >= 500) break
    }
  }

  const offsetText = lesson.playback.mediaOffsetSec === null
    ? '未知'
    : `${Math.round(lesson.playback.mediaOffsetSec)}s`
  const slideText = imported > 0 || aligned > 0
    ? `；课件锚点：新增 ${imported}，对齐 ${aligned}（媒体起止秒按墙钟+时长推定，confidence=inferred）`
    : ''
  return {
    ok: true,
    javascript: result.javascript,
    media,
    message: `已同步：${lesson.playback.status} @ ${offsetText}（适配器实测）${slideText}`,
    lesson,
  }
}

async function applyLessonAction(dataDir, subject, action, args) {
  if (action === 'lesson_open') {
    const courseTitle = text(args.courseTitle, 300) || text(args.lessonTitle, 300) || '未命名课程'
    const platformRaw = text(args.platform, 40)
    const courses = await listCourses(dataDir)
    let course = courses.find((item) => item.subjectId === subject.id && item.title === courseTitle)
    if (course === undefined) {
      course = normalizeCourse({
        id: shortId('c'),
        subjectId: subject.id,
        title: courseTitle,
        platform: platformRaw,
        url: text(args.url, 1000),
      })
      await saveCourse(dataDir, course)
    } else if (course.platform === 'other' && platformRaw !== '') {
      course = normalizeCourse({ ...course, platform: platformRaw })
      await saveCourse(dataDir, course)
    }
    const lesson = normalizeLesson({
      id: shortId('l'),
      courseId: course.id,
      subjectId: subject.id,
      title: text(args.lessonTitle, 300) || courseTitle,
      startedAt: isoNow(),
    })
    await saveLesson(dataDir, lesson)
    return { lesson, message: `已开始跟随课次「${lesson.title}」（${course.platform}）。播放能力默认 unverified：没有接口就不要填 mediaOffsetSec。` }
  }

  if (action === 'pref_set') {
    const prefs = await readPrefs(dataDir)
    const scope = text(args.scope, 20) === 'subject' ? 'subject' : 'global'
    const patch = args.patch !== null && typeof args.patch === 'object' ? args.patch : {}
    if (scope === 'subject') {
      if (subject === null) throw new Error('pref_set 的 scope=subject 需要当前学科。')
      prefs.subjects[subject.id] = normalizePrefs({ global: { ...prefs.subjects[subject.id], ...patch } }).global
    } else {
      prefs.global = normalizePrefs({ global: { ...prefs.global, ...patch } }).global
    }
    await savePrefs(dataDir, prefs)
    return { lesson: null, prefs, message: `表达偏好已写入（${scope}）。` }
  }

  const lesson = await pickLessonForWrite(dataDir, subject, args, action !== 'lesson_close')
  if (lesson === null) throw new Error('还没有任何课次；先 lesson_open。')

  switch (action) {
    case 'lesson_close':
      lesson.state = 'closed'
      lesson.endedAt = isoNow()
      await saveLesson(dataDir, lesson)
      return { lesson, message: '课次已关闭。' }

    case 'lesson_capability': {
      const capability = text(args.capability, 40)
      const value = text(args.value, 20)
      if (!(capability in lesson.capabilities)) throw new Error(`未知能力「${capability}」；可用：${Object.keys(lesson.capabilities).join(', ')}。`)
      if (!['available', 'unavailable', 'unverified'].includes(value)) throw new Error('value 只能是 available / unavailable / unverified。')
      lesson.capabilities[capability] = value
      await saveLesson(dataDir, lesson)
      return { lesson, message: `能力 ${capability} 记为 ${value}。` }
    }

    case 'lesson_playback': {
      const status = text(args.status, 20)
      if (!['playing', 'paused', 'unknown'].includes(status)) throw new Error('status 只能是 playing / paused / unknown。')
      lesson.playback.status = status
      lesson.playback.mediaOffsetSec = optionalNumber(args.mediaOffsetSec, 0, 400000)
      lesson.playback.rate = optionalNumber(args.rate, 0.1, 8)
      lesson.playback.source = text(args.source, 20) === 'adapter' ? 'adapter' : 'declared'
      lesson.playback.updatedAt = isoNow()
      await saveLesson(dataDir, lesson)
      return { lesson, message: `播放状态记为 ${status}${lesson.playback.mediaOffsetSec === null ? '（媒体位置未知，记为 null）' : ''}。` }
    }

    case 'lesson_mark': {
      const kind = text(args.kind, 20)
      if (!['important', 'confused', 'think', 'question'].includes(kind)) throw new Error('kind 只能是 important / confused / think / question。')
      const mark = normalizeMark({
        id: `mk${lesson.marks.length + 1}`,
        kind,
        text: args.text,
        observedClock: args.observedClock,
        pauseRequested: kind === 'think',
      }, lesson.marks.length)
      lesson.marks.push(mark)
      await saveLesson(dataDir, lesson)
      return { lesson, mark, message: kind === 'think' ? '已记「我想一下」；暂停请求仅为请求，实际状态以原页面为准。' : '标记已记录。' }
    }

    case 'material_add': {
      const material = normalizeMaterial({
        id: `m${lesson.materials.length + 1}`,
        kind: text(args.kind, 20),
        title: args.title,
        ref: args.ref,
        version: args.version,
      }, lesson.materials.length)
      if (material.ref === '' && material.title === '') throw new Error('material_add 至少需要 title 或 ref。')
      lesson.materials.push(material)
      await saveLesson(dataDir, lesson)
      return { lesson, material, message: '资料引用已记录（只存引用，不存文件）。' }
    }

    case 'anchor_add': {
      const anchor = normalizeAnchor({
        id: `a${lesson.anchors.length + 1}`,
        kind: text(args.kind, 20),
        materialId: args.materialId,
        page: args.page,
        region: args.region,
        startSec: args.startSec,
        endSec: args.endSec,
        aligned: args.aligned === true,
        observedClock: args.observedClock,
        label: args.label,
        confidence: args.confidence,
      }, lesson.anchors.length)
      if (anchor.kind === 'media' && anchor.startSec === null && anchor.observedClock === '') {
        throw new Error('media 锚点至少要有真实 media 时间（startSec）或页面显示的 observedClock；两者都没有就不是锚点。')
      }
      if (anchor.kind === 'media' && anchor.startSec !== null && anchor.aligned !== true) {
        throw new Error('media 锚点填了 startSec 就必须 aligned=true；未对齐的时间只能进 observedClock。')
      }
      lesson.anchors.push(anchor)
      await saveLesson(dataDir, lesson)
      return { lesson, anchor, message: '来源锚点已记录。' }
    }

    case 'knowledge_add': {
      const name = text(args.name, 200)
      if (name === '') throw new Error('knowledge_add 需要 name。')
      const knowledge = normalizeKnowledge({ id: `k${lesson.knowledge.length + 1}`, name, anchorIds: args.anchorIds }, lesson.knowledge.length)
      lesson.knowledge.push(knowledge)
      await saveLesson(dataDir, lesson)
      return { lesson, knowledge, message: '知识点与锚点已关联。' }
    }

    case 'note_write': {
      const noteId = text(args.noteId, 40)
      const existingIndex = noteId === '' ? -1 : lesson.notes.findIndex((note) => note.id === noteId)
      const merged = normalizeNote({
        ...(existingIndex >= 0 ? lesson.notes[existingIndex] : { id: `n${lesson.notes.length + 1}`, status: 'agent' }),
        title: args.title ?? (existingIndex >= 0 ? lesson.notes[existingIndex].title : ''),
        intuition: args.intuition ?? (existingIndex >= 0 ? lesson.notes[existingIndex].intuition : ''),
        example: args.example ?? (existingIndex >= 0 ? lesson.notes[existingIndex].example : ''),
        formula: args.formula ?? (existingIndex >= 0 ? lesson.notes[existingIndex].formula : ''),
        conditions: args.conditions ?? (existingIndex >= 0 ? lesson.notes[existingIndex].conditions : ''),
        pitfalls: args.pitfalls ?? (existingIndex >= 0 ? lesson.notes[existingIndex].pitfalls : ''),
        sourcePoints: args.sourcePoints ?? (existingIndex >= 0 ? lesson.notes[existingIndex].sourcePoints : []),
        generated: args.generated ?? (existingIndex >= 0 ? lesson.notes[existingIndex].generated : []),
        anchorIds: args.anchorIds ?? (existingIndex >= 0 ? lesson.notes[existingIndex].anchorIds : []),
        knowledgeIds: args.knowledgeIds ?? (existingIndex >= 0 ? lesson.notes[existingIndex].knowledgeIds : []),
        tags: args.tags ?? (existingIndex >= 0 ? lesson.notes[existingIndex].tags : []),
        status: text(args.status, 20) || (existingIndex >= 0 ? lesson.notes[existingIndex].status : 'agent'),
        updatedAt: isoNow(),
      }, existingIndex >= 0 ? existingIndex : lesson.notes.length)
      if (existingIndex >= 0) lesson.notes[existingIndex] = merged
      else lesson.notes.push(merged)
      await saveLesson(dataDir, lesson)
      return { lesson, note: merged, message: existingIndex >= 0 ? '笔记已更新。' : '笔记已新建（原课要点与 agent 补充分栏保存）。' }
    }

    case 'section_write': {
      const sectionId = text(args.sectionId, 40)
      const index = sectionId === '' ? -1 : lesson.sections.findIndex((section) => section.id === sectionId)
      const section = normalizeSection({
        ...(index >= 0 ? lesson.sections[index] : { id: `sec${lesson.sections.length + 1}` }),
        title: args.title ?? (index >= 0 ? lesson.sections[index].title : ''),
        objective: args.objective ?? (index >= 0 ? lesson.sections[index].objective : ''),
        prerequisites: args.prerequisites ?? (index >= 0 ? lesson.sections[index].prerequisites : ''),
        blocks: args.blocks ?? (index >= 0 ? lesson.sections[index].blocks : []),
        sourceRefIds: args.sourceRefIds ?? (index >= 0 ? lesson.sections[index].sourceRefIds : []),
        status: 'generated',
        createdAt: index >= 0 ? lesson.sections[index].createdAt : isoNow(),
      }, index >= 0 ? index : lesson.sections.length)
      if (index >= 0) lesson.sections[index] = section
      else lesson.sections.push(section)
      await saveLesson(dataDir, lesson)
      return { lesson, section, message: '互动补讲小节已保存（status=generated，不附原课时间点）。' }
    }

    case 'trace_record': {
      const trace = normalizeTrace({
        id: `t${lesson.trace.length + 1}`,
        concept: args.concept,
        gapId: args.gapId,
        anchorIds: args.anchorIds,
        noteIds: args.noteIds,
      }, lesson.trace.length)
      lesson.trace.push(trace)
      await saveLesson(dataDir, lesson)
      return { lesson, trace, message: '回溯证据已记录。' }
    }

    case 'lesson_sync': {
      const synced = await syncLessonFromSafari(lesson)
      await saveLesson(dataDir, lesson)
      return { lesson, message: synced.message, sync: { ok: synced.ok, javascript: synced.javascript, media: synced.media } }
    }

    default:
      throw new Error(`未知课次动作「${action}」。`)
  }
}

function lessonReadOutput() {
  return {
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        error: { type: 'string' },
        lesson: { oneOf: [{ type: 'null' }, { type: 'object' }] },
        lessons: { type: 'array', items: { type: 'object' } },
        prefs: { type: 'object' },
      },
      required: ['ok'],
      additionalProperties: true,
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function lessonReadTool(dataDir) {
  return {
    name: 'lesson_read',
    description:
      '读取「同堂伴学」的课次档案：课程平台与网址、播放状态（unknown/playing/paused 与媒体位置，未知为 null）、能力声明（available/unavailable/unverified）、课中标记、来源锚点（课件页/原课时间/页面显示时刻但未对齐）、按偏好组织的课堂笔记、互动补讲小节与回溯证据，以及该学科的合并后表达偏好。用户说「刚才那段讲了什么 / 找某题的来源 / 继续听课」时先调用。没有课次时返回 lesson=null。',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '学科 id 或主题关键词；省略时用当前活动学科。' },
        lessonId: { type: 'string', description: '精确课次 id；省略时取该学科最近一次打开（open）的课次。' },
      },
    },
    output: lessonReadOutput(),
    async execute(args = {}) {
      try {
        const subjects = await listSubjects(dataDir)
        const active = await selectActive(dataDir, subjects)
        let subject = active
        if (text(args.subject, 300) !== '') subject = pickSubject(subjects, active, args.subject)
        if (subject === null) return { ok: true, lesson: null, lessons: [], prefs: await readPrefs(dataDir) }
        const lessons = (await listLessons(dataDir))
          .filter((lesson) => lesson.subjectId === subject.id)
          .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1))
        let lesson = null
        if (text(args.lessonId, 60) !== '') lesson = await readLessonById(dataDir, text(args.lessonId, 60))
        else lesson = lessons.find((item) => item.state === 'open') ?? lessons[0] ?? null
        const prefs = await readPrefs(dataDir)
        return {
          ok: true,
          subject: { id: subject.id, topic: subject.topic },
          lesson,
          lessons: lessons.slice(0, 20).map(lessonSummary),
          prefs: mergedPrefs(prefs, subject.id),
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), lesson: null, lessons: [], prefs: {} }
      }
    },
    presentCall: () => ({ card: 'generic', title: '读取课次档案', kind: 'read' }),
  }
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

const SNAPSHOT_OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      generatedAt: { type: 'string' },
      active: { oneOf: [{ type: 'null' }, { type: 'object' }] },
      subjects: { type: 'array', items: { type: 'object' } },
    },
    required: ['ok'],
    additionalProperties: true,
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function readTool(dataDir) {
  return {
    name: 'study_read',
    description:
      '读取「伴学」档案：当前学科的五级学习阶梯位置、20 小时计划（10 个 2 小时单元）进度、待作答或待评分的考试题、到期复测、最薄弱漏洞、资源清单、速查表是否存在。只读。用户说「开始伴学 / 继续学 / 我学到哪了 / 继续考试 / 该复习什么」时先调用它。没有学科时返回 active=null。',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '学科 id 或主题关键词；省略时读取当前活动学科。' },
      },
    },
    output: SNAPSHOT_OUTPUT,
    async execute(args = {}) {
      try {
        const subjects = await listSubjects(dataDir)
        const active = await selectActive(dataDir, subjects)
        const wanted = text(args.subject, 300)
        const chosen = wanted === '' ? active : pickSubject(subjects, active, wanted)
        return {
          ok: true,
          generatedAt: isoNow(),
          active: chosen === null
            ? null
            : { subject: chosen, derived: buildDerived(chosen), pendingExam: chosen.pendingExam },
          subjects: subjects.map(subjectSummary),
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), active: null, subjects: [] }
      }
    },
    presentCall: () => ({ card: 'generic', title: '读取伴学档案', kind: 'read' }),
  }
}

function writeTool(dataDir) {
  return {
    name: 'study_write',
    description:
      '写入「伴学」学科档案。伴学回路（按顺序，不要一次抛整套课程）：① create 建学科（topic/goal/deadline/budgetHours/baseline）→ ② set_ladder 给 5 级阶梯（每级的能力/精通表现/里程碑/自测）→ ③ set_plan 拆 10 个 2 小时单元（练习、可检查产出、通过标准）→ ④ set_resources 只留最多 5 个资源 → ⑤ ask_exam 出题（一次只出一题，按阶梯难度递增；用户在面板作答后，用 study_read 读答案再 grade_exam：0-10 打分、指出确切漏洞、只重讲答错部分，然后 ask_exam 出下一题）→ ⑥ log_feynman 记复述直到干净 → ⑦ save_cheatsheet 压缩成一页、schedule_reviews 排 1/3/7 天复测。每完成一个单元调用 complete_unit。规则：一次只问一题并等用户回答；不编造资料、链接或章节；不凭「讲得流畅」判定掌握。\n同堂伴学（v4）：lesson_open 开课次 → lesson_capability 声明播放能力（没有实测就是 unverified）→ material_add 记课件引用 → 课上用 lesson_mark 记「这里重要／没懂／我想一下／提问」→ anchor_add 记来源锚点（课件页用 page；原课时间只在真拿到播放器时间时填 startSec 并 aligned=true；页面显示的 09:45 只能进 observedClock）→ note_write 写分栏笔记（sourcePoints=老师讲的，generated=你补的）→ 从练习回溯时用 trace_record 把 concept/gap 与 anchorIds/noteIds 绑定 → section_write 生成可追问的互动补讲小节。没有播放器接口时 mediaOffsetSec 必须为 null，不得用电脑时间或页面时刻冒充。lesson_sync 会通过本机 Safari 适配器读一次真实 currentTime/paused/playbackRate 并写回（source=adapter）；适配器不可用时只返回错误，不写假数据。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description:
            'create 建学科｜update 改主题/目标/截止/预算/状态｜select 切换当前学科｜bind_session 绑定主伴学对话｜set_ladder 写五级阶梯｜set_plan 写学习单元｜set_resources 写资源｜ask_exam 出题｜grade_exam 评分并归档｜record_mastery 记掌握度（独立/复测/提示后）｜log_feynman 记复述｜save_cheatsheet 存速查表｜complete_unit 标记计划进度｜schedule_reviews 排复测｜complete_review 标记复测完成｜lesson_open 开课次｜lesson_close 关课次｜lesson_capability 声明播放能力｜lesson_playback 记播放状态｜lesson_mark 课中标记｜material_add 记课件引用｜anchor_add 记来源锚点｜knowledge_add 关联知识点｜note_write 写/改分栏笔记｜section_write 写互动补讲小节｜trace_record 记练习→来源回溯｜lesson_sync 用 Safari 适配器同步播放状态｜pref_set 写表达偏好',
        },
        subject: { type: 'string', description: '学科 id 或主题关键词；省略时用当前活动学科。' },
        topic: { type: 'string', description: '学科 / 主题名（create 必填）。' },
        goal: { type: 'string', description: '在什么情境下独立完成什么任务；目标要可检查。' },
        deadline: { type: 'string', description: '截止日期 YYYY-MM-DD。' },
        budgetHours: { type: 'number', description: '总学习预算（小时），默认 20。' },
        baseline: { type: 'string', description: '当前基础：会什么、不会什么。' },
        status: { type: 'string', enum: ['active', 'paused', 'done'], description: '学科状态。' },
        levels: {
          type: 'array',
          description: 'set_ladder：最多 5 级，从低到高。',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '等级名，如「完全初学者」。' },
              understand: { type: 'string', description: '这一级应当理解什么。' },
              mastery: { type: 'string', description: '这一级的精通表现。' },
              milestone: { type: 'string', description: '可检查的升级里程碑。' },
              selfTest: { type: 'string', description: '进入下一级前的自测题。' },
            },
            required: ['name'],
          },
        },
        currentLevel: { type: 'number', description: 'set_ladder：当前等级（1-5，0 表示未评估）。' },
        units: {
          type: 'array',
          description: 'set_plan：学习单元，建议 10 个、每个 2 小时。',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              concepts: { type: 'string' },
              exercise: { type: 'string' },
              deliverable: { type: 'string' },
              pass: { type: 'string' },
              hours: { type: 'number' },
            },
            required: ['title'],
          },
        },
        resources: {
          type: 'array',
          description: 'set_resources：最多 5 个高杠杆资源。',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              why: { type: 'string' },
              part: { type: 'string' },
              level: { type: 'string' },
              how: { type: 'string' },
              skip: { type: 'string' },
            },
            required: ['name'],
          },
        },
        question: { type: 'string', description: 'ask_exam：题目正文。' },
        replace: { type: 'boolean', description: 'ask_exam：当前还有未完成的题时，显式传 true 才会跳过旧题（旧题保留在 discardedExams）。默认 false，会报错要求先处理旧题。' },
        questionId: { type: 'string', description: 'grade_exam：要评分的题号，必须与 study_read 读到的 pendingExam.questionId 一致；不匹配会拒绝评分。' },
        answerSeq: { type: 'number', description: 'grade_exam：要评分的答案版本号，必须与 study_read 读到的 pendingExam.answerSeq 一致；不匹配会拒绝评分（用户可能改过答案）。' },
        concept: { type: 'string', description: 'ask_exam / log_feynman：对应概念。' },
        level: { type: 'number', description: 'ask_exam：题目对应的阶梯等级。' },
        score: { type: 'number', description: 'grade_exam：得分 0-10。' },
        gap: { type: 'string', description: 'grade_exam / log_feynman：确切漏洞或遗漏。' },
        feedback: { type: 'string', description: 'grade_exam：只针对答错部分的简短重讲。' },
        independent: { type: 'boolean', description: 'grade_exam：是否在无提示下独立完成；提示后才答对记 false（按半分计，下一轮不提示重考）。' },
        holes: { type: 'string', description: 'log_feynman：讲不清或跳过的部分。' },
        passed: { type: 'boolean', description: 'log_feynman：这次复述是否已经干净准确。' },
        markdown: { type: 'string', description: 'save_cheatsheet：一页速查表正文（Markdown）。' },
        unitIndex: { type: 'number', description: 'complete_unit：单元序号，从 1 开始。' },
        done: { type: 'boolean', description: 'complete_unit：true 标记完成，false 撤销。' },
        dates: { type: 'array', items: { type: 'string' }, description: 'schedule_reviews：日期（YYYY-MM-DD），省略则 +1/+3/+7 天。' },
        due: { type: 'string', description: 'complete_review：要标记完成的复测日期。' },
        reviewIndex: { type: 'number', description: 'complete_review：复测序号（从 1 开始）。' },
        sessionId: { type: 'string', description: 'bind_session：要绑定为主伴学对话的 session id；省略则绑定当前调用对话。' },
        sessionLabel: { type: 'string', description: 'bind_session：给这个对话一个可读标签（可选）。' },
        kind: { type: 'string', enum: ['independent', 'review', 'prompted'], description: 'record_mastery：independent=当次不看提示独立通过；review=隔天新变式复测通过；prompted=给过提示才完成。' },
        items: {
          type: 'array',
          description: 'grade_exam：拆项得分，例如 [{label:"写对对偶模型",score:9,max:10},{label:"选对偶可行解并用弱对偶给界",score:4,max:5}]。不传则只有总分。',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              score: { type: 'number' },
              max: { type: 'number' },
            },
            required: ['label', 'score', 'max'],
          },
        },
        source: { type: 'string', description: 'grade_exam：判分依据，写到文件与页码，例如“slides/线性规划_对偶.pdf 第 5、10、13 页”。' },
        courseTitle: { type: 'string', description: 'lesson_open：课程名，例如「雨课堂 · 机器学习」。' },
        platform: { type: 'string', enum: ['yuketang', 'bilibili', 'xuetangx', 'other'], description: 'lesson_open：课程平台。' },
        url: { type: 'string', description: 'lesson_open / material_add(url)：课程网页地址。' },
        lessonTitle: { type: 'string', description: 'lesson_open：本次课次标题，例如「Chap5-1（2）」。' },
        lessonId: { type: 'string', description: '课次 id；省略时用该学科最近打开（open）的课次。' },
        capability: { type: 'string', enum: ['mediaTime', 'seek', 'pause', 'slides', 'captions', 'grab'], description: 'lesson_capability：能力名。' },
        value: { type: 'string', enum: ['available', 'unavailable', 'unverified'], description: 'lesson_capability：能力状态；没有实测就保持 unverified。' },
        mediaOffsetSec: { type: 'number', description: 'lesson_playback：播放器真实 currentTime（秒）。没有接口时必须不传或传 null，不得用电脑时间或页面显示时刻代替。' },
        rate: { type: 'number', description: 'lesson_playback：播放倍速。' },
        observedClock: { type: 'string', description: 'lesson_mark / anchor_add：页面上显示的授课时刻（如 09:45）。它只是观察，不是媒体偏移；未对齐时只放这里。' },
        materialId: { type: 'string', description: 'anchor_add：关联的资料 id。' },
        page: { type: 'number', description: 'anchor_add：课件页码。' },
        region: { type: 'string', description: 'anchor_add：页面区域或图表位置。' },
        startSec: { type: 'number', description: 'anchor_add：原课媒体起止秒；只有真拿到播放器时间才填，并置 aligned=true。' },
        endSec: { type: 'number', description: 'anchor_add：原课媒体结束秒。' },
        aligned: { type: 'boolean', description: 'anchor_add：时间是否已对齐到原媒体坐标。' },
        label: { type: 'string', description: 'anchor_add / material_add：可读说明。' },
        confidence: { type: 'string', enum: ['declared', 'observed', 'inferred'], description: 'anchor_add：来源可信类别。' },
        title: { type: 'string', description: 'material_add / note_write / section_write：标题。' },
        kind: { type: 'string', description: 'lesson_mark：important/confused/think/question；material_add：slide/pdf/image/url/captions；anchor_add：slide/media/note/material。' },
        ref: { type: 'string', description: 'material_add：资料引用（文件路径或网址）；只存引用不存文件。' },
        version: { type: 'string', description: 'material_add：资料版本。' },
        anchorIds: { type: 'array', items: { type: 'string' }, description: 'knowledge_add / note_write / trace_record：关联锚点 id。' },
        knowledgeIds: { type: 'array', items: { type: 'string' }, description: 'note_write：关联知识点 id。' },
        noteId: { type: 'string', description: 'note_write：要更新的笔记 id；省略则新建。' },
        intuition: { type: 'string', description: 'note_write：一句话直觉。' },
        example: { type: 'string', description: 'note_write：图示或具体例子。' },
        formula: { type: 'string', description: 'note_write：公式与推导。' },
        conditions: { type: 'string', description: 'note_write：假设与适用条件。' },
        pitfalls: { type: 'string', description: 'note_write：易错点。' },
        sourcePoints: { type: 'array', items: { type: 'string' }, description: 'note_write：原课要点（老师讲的），与 generated 分栏。' },
        generated: { type: 'array', items: { type: 'string' }, description: 'note_write：agent 补充解释；不得附原课时间点。' },
        tags: { type: 'array', items: { type: 'string' }, description: 'note_write：标签。' },
        blocks: { type: 'array', description: 'section_write：互动补讲内容块，例如 [{kind:"text",body:"…"},{kind:"question",body:"…"}]。', items: { type: 'object', properties: { kind: { type: 'string', enum: ['text', 'example', 'formula', 'question'] }, body: { type: 'string' } }, required: ['kind', 'body'] } },
        sourceRefIds: { type: 'array', items: { type: 'string' }, description: 'section_write：引用的锚点 id。' },
        sectionId: { type: 'string', description: 'section_write：要更新的小节 id；省略则新建。' },
        objective: { type: 'string', description: 'section_write：教学目标。' },
        prerequisites: { type: 'string', description: 'section_write：前置知识。' },
        gapId: { type: 'string', description: 'trace_record：对应的漏洞 id。' },
        noteIds: { type: 'array', items: { type: 'string' }, description: 'trace_record：命中的笔记 id。' },
        scope: { type: 'string', enum: ['global', 'subject'], description: 'pref_set：global=个人默认；subject=本学科覆盖。' },
        patch: { type: 'object', description: 'pref_set：要覆盖的偏好字段，例如 {order:["intuition","example","formula"],language:"zh"}。' },
      },
      required: ['action'],
    },
    output: SNAPSHOT_OUTPUT,
    async execute(args = {}, exec = {}) {
      // 对话身份只从工具执行上下文取，不从全局面板推断。
      const callerSessionId = text(exec?.agent?.session?.id ?? exec?.agent?.id ?? '', 120) || null
      try {
        return await withMutation(dataDir, async () => {
          const action = text(args.action, 40)
          const subjects = await listSubjects(dataDir)
          const active = await selectActive(dataDir, subjects)

          if (action === 'create') {
            const created = createSubject(subjects, args)
            if (callerSessionId !== null) {
              created.mainSessionId = callerSessionId
              created.mainSessionLabel = ''
            }
            await saveSubject(dataDir, created)
            await writeActiveId(dataDir, created.id)
            return await buildState(dataDir)
          }

        if (action === 'pref_set') {
          const scope = text(args.scope, 20) === 'subject' ? 'subject' : 'global'
          const target = scope === 'subject' ? pickSubject(subjects, active, args.subject) : (active ?? null)
          const result = await applyLessonAction(dataDir, target, action, args)
          return { ...(await buildState(dataDir)), prefs: result.prefs }
        }

        const subject = pickSubject(subjects, active, args.subject)
        if (['ask_exam', 'grade_exam', 'record_mastery', 'lesson_open', 'lesson_mark', 'note_write', 'section_write'].includes(action)) {
          requireMainSession(subject, callerSessionId, action)
        }
        if (LESSON_ACTIONS.includes(action)) {
          const result = await applyLessonAction(dataDir, subject, action, args)
          const state = await buildState(dataDir)
          if (text(args.subject, 300) !== '') {
            state.active = { subject, derived: buildDerived(subject), pendingExam: subject.pendingExam }
          }
          return {
            ...state,
            lesson: result.lesson,
            message: result.message,
            sync: result.sync,
            prefs: mergedPrefs(await readPrefs(dataDir), subject.id),
          }
        }
        if (action === 'bind_session') {
          bindSession(subject, args, callerSessionId)
          await saveSubject(dataDir, subject)
          return await buildState(dataDir)
        }
        switch (action) {
          case 'update': updateSubject(subject, args); break
          case 'select':
            await writeActiveId(dataDir, subject.id)
            return await buildState(dataDir)
          case 'set_ladder': setLadder(subject, args); break
          case 'set_plan': setPlan(subject, args); break
          case 'set_resources': setResources(subject, args); break
          case 'ask_exam': askExam(subject, args); break
          case 'grade_exam': gradeExam(subject, args); break
          case 'log_feynman': logFeynman(subject, args); break
          case 'save_cheatsheet': saveCheatsheet(subject, args); break
          case 'complete_unit': completeUnit(subject, args); break
          case 'schedule_reviews': scheduleReviews(subject, args); break
          case 'complete_review': completeReview(subject, args); break
          case 'record_mastery': recordMastery(subject, args); break
          default: throw new Error(`未知 action「${action}」；可用：${ACTIONS.join(', ')}。`)
        }
        await saveSubject(dataDir, subject)
          const state = await buildState(dataDir)
          // 显式指定了 subject 时，响应里的 active 必须是刚改的那一个，否则 agent 会误读成另一个学科。
          if (text(args.subject, 300) !== '') {
            state.active = { subject, derived: buildDerived(subject), pendingExam: subject.pendingExam }
          }
          return state
        })
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), active: null, subjects: [] }
      }
    },
    presentCall: () => ({ card: 'generic', title: '更新伴学档案', kind: 'write' }),
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function rejectionOf(ctx, request) {
  const connection = Reflect.get(ctx, 'connection')
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') return undefined
  return connection.requestRejection(request)
}

function queryOf(request) {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const query = {}
    for (const [key, value] of url.searchParams.entries()) query[key] = value
    return query
  } catch {
    return {}
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('请求体超过 64 KiB')
      error.httpStatus = 413
      throw error
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw === '') return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.httpStatus = 400
    throw error
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('请求体必须是 JSON 对象')
    error.httpStatus = 400
    throw error
  }
  return parsed
}

async function readMethod() {
  const parsed = JSON.parse(await readFile(METHOD_FILE, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
    throw new Error('content/method.json 缺少 cards 数组')
  }
  return {
    ok: true,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    principles: Array.isArray(parsed.principles) ? parsed.principles : [],
    cards: parsed.cards,
  }
}

/**
 * 注册一条同源路由：统一处理鉴权、方法与错误。
 * @param {import('cordis').Context} ctx
 * @param {{ path: string, method: 'GET' | 'POST', handler: (request: any, body: any) => Promise<any> }} route
 */
function registerRoute(ctx, route) {
  return ctx.webServer.register({
    kind: 'exact',
    path: route.path,
    async handler(request, response) {
      const rejection = rejectionOf(ctx, request)
      if (rejection !== undefined) {
        response.statusCode = rejection
        response.end()
        return
      }
      if (request.method !== route.method) {
        response.setHeader('allow', route.method)
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const body = route.method === 'POST' ? await readJsonBody(request) : undefined
        const payload = await route.handler(request, body)
        const status = payload !== null && typeof payload === 'object' && typeof payload.__status === 'number' ? payload.__status : 200
        if (payload !== null && typeof payload === 'object' && '__status' in payload) delete payload.__status
        sendJson(response, status, payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 500
        sendJson(response, status, { ok: false, error: message })
      }
    },
  })
}

/**
 * @param {import('cordis').Context} ctx
 * @param {{ dataDir?: string } | undefined} config
 */
export function apply(ctx, config) {
  const dataDir = resolveDataDir(config)

  ctx.effect(() => ctx.tools.register(readTool(dataDir)), 'study-companion: study_read tool')
  ctx.effect(() => ctx.tools.register(writeTool(dataDir)), 'study-companion: study_write tool')
  ctx.effect(() => ctx.tools.register(lessonReadTool(dataDir)), 'study-companion: lesson_read tool')

  ctx.effect(() => registerRoute(ctx, {
    path: STATE_ROUTE,
    method: 'GET',
    async handler() {
      return await buildState(dataDir)
    },
  }), `study-companion: GET ${STATE_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: METHOD_ROUTE,
    method: 'GET',
    async handler() {
      return await readMethod()
    },
  }), `study-companion: GET ${METHOD_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: SUBJECTS_ROUTE,
    method: 'POST',
    async handler(_request, body) {
      return await withMutation(dataDir, async () => {
        const topic = text(body.topic, 300)
        if (topic === '') return { __status: 400, ok: false, error: 'topic 不能为空' }
        const subjects = await listSubjects(dataDir)
        if (subjects.some((subject) => subject.topic === topic)) {
          return { __status: 409, ok: false, error: `已经有一个叫「${topic}」的学科` }
        }
        const subject = normalizeSubject({
          id: newSubjectId(),
          topic,
          goal: body.goal,
          deadline: body.deadline,
          budgetHours: body.budgetHours,
          baseline: body.baseline,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        })
        await saveSubject(dataDir, subject)
        await writeActiveId(dataDir, subject.id)
        return { ok: true, id: subject.id, state: await buildState(dataDir) }
      })
    },
  }), `study-companion: POST ${SUBJECTS_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: ACTIVE_ROUTE,
    method: 'POST',
    async handler(_request, body) {
      return await withMutation(dataDir, async () => {
        const subjects = await listSubjects(dataDir)
        let subject
        try {
          subject = pickSubject(subjects, await selectActive(dataDir, subjects), body.subjectId)
        } catch (error) {
          return { __status: 404, ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        await writeActiveId(dataDir, subject.id)
        return { ok: true, activeSubjectId: subject.id, state: await buildState(dataDir) }
      })
    },
  }), `study-companion: POST ${ACTIVE_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: ANSWER_ROUTE,
    method: 'POST',
    async handler(_request, body) {
      return await withMutation(dataDir, async () => {
        const answer = text(body.answer, 4000)
        if (answer === '') return { __status: 400, ok: false, error: 'answer 不能为空' }
        const subjects = await listSubjects(dataDir)
        const active = await selectActive(dataDir, subjects)
        const subject = body.subjectId !== undefined ? pickSubject(subjects, active, body.subjectId) : active
        if (subject === null || subject.pendingExam === null) {
          return { __status: 409, ok: false, error: '当前没有待作答的题目' }
        }
        const pending = subject.pendingExam
        const questionId = text(body.questionId, 40)
        if (questionId === '') {
          return {
            __status: 400,
            ok: false,
            error: `缺少 questionId：这题是 ${pending.questionId}，请带上它一起提交，避免答案写到别的题上。`,
            pendingExam: pending,
          }
        }
        if (questionId !== pending.questionId) {
          return {
            __status: 409,
            ok: false,
            error: `题目已更新：这题是 ${pending.questionId}，提交的是 ${questionId}，这次答案没有写入。请刷新后重新作答。`,
            pendingExam: pending,
          }
        }
        if (pending.status === 'awaiting_grade' && body.revise !== true) {
          return {
            __status: 409,
            ok: false,
            error: '这题的答案已经提交、正在等评分；要修改请带 revise:true（评分需要匹配新的版本号）。',
            pendingExam: pending,
          }
        }
        pending.answer = answer
        pending.answerAt = isoNow()
        pending.answerSeq = pending.answerSeq + 1
        pending.status = 'awaiting_grade'
        await saveSubject(dataDir, subject)
        return {
          ok: true,
          pendingExam: pending,
          note: '答案已记录；回到伴学对话说「继续考试」，伴学会读到这一版答案、评分并出下一题。',
          state: await buildState(dataDir),
        }
      })
    },
  }), `study-companion: POST ${ANSWER_ROUTE}`)

  // ── v4：课堂 / 课次 / 偏好 ──────────────────────────────────────────────
  ctx.effect(() => registerRoute(ctx, {
    path: LESSONS_ROUTE,
    method: 'GET',
    async handler(request) {
      const query = queryOf(request)
      const subjects = await listSubjects(dataDir)
      const active = await selectActive(dataDir, subjects)
      const subject = typeof query.subjectId === 'string' && query.subjectId !== ''
        ? pickSubject(subjects, active, query.subjectId)
        : active
      if (subject === null) return { ok: true, lessons: [] }
      const lessons = (await listLessons(dataDir))
        .filter((lesson) => lesson.subjectId === subject.id)
        .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1))
      return { ok: true, subject: { id: subject.id, topic: subject.topic }, lessons: lessons.map(lessonSummary) }
    },
  }), `study-companion: GET ${LESSONS_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: LESSON_ROUTE,
    method: 'GET',
    async handler(request) {
      const query = queryOf(request)
      const lessonId = typeof query.id === 'string' ? query.id : ''
      if (lessonId === '') return { __status: 400, ok: false, error: '缺少课次 id' }
      const lesson = await readLessonById(dataDir, lessonId)
      if (lesson === null) return { __status: 404, ok: false, error: '找不到该课次' }
      const prefs = await readPrefs(dataDir)
      return { ok: true, lesson, prefs: mergedPrefs(prefs, lesson.subjectId) }
    },
  }), `study-companion: GET ${LESSON_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: PREFS_ROUTE,
    method: 'GET',
    async handler(request) {
      const query = queryOf(request)
      const subjects = await listSubjects(dataDir)
      const active = await selectActive(dataDir, subjects)
      const subjectId = typeof query.subjectId === 'string' && query.subjectId !== ''
        ? query.subjectId
        : active === null ? '' : active.id
      const prefs = await readPrefs(dataDir)
      return { ok: true, prefs: subjectId === '' ? { scope: 'global', ...prefs.global } : mergedPrefs(prefs, subjectId) }
    },
  }), `study-companion: GET ${PREFS_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: LESSON_MARK_ROUTE,
    method: 'POST',
    async handler(_request, body) {
      return await withMutation(dataDir, async () => {
        const lessonId = text(body.lessonId, 60)
        if (lessonId === '') return { __status: 400, ok: false, error: '缺少 lessonId' }
        const lesson = await readLessonById(dataDir, lessonId)
        if (lesson === null) return { __status: 404, ok: false, error: '找不到该课次' }
        const kind = text(body.kind, 20)
        if (!['important', 'confused', 'think', 'question'].includes(kind)) {
          return { __status: 400, ok: false, error: 'kind 只能是 important / confused / think / question' }
        }
        // 标记尽量落在原媒体坐标上：没有显式值时读一次适配器，读不到就保持 null。
        let mediaOffsetSec = optionalNumber(body.mediaOffsetSec, 0, 400000)
        if (mediaOffsetSec === null && kind !== 'important') {
          const observed = await readMediaState({ preferPlatforms: ['yuketang', 'bilibili', 'xuetangx'] })
          if (observed.ok === true && observed.media !== null && observed.media.video !== null) {
            mediaOffsetSec = optionalNumber(observed.media.video.currentTime, 0, 400000)
          }
        }
        const mark = normalizeMark({
          id: `mk${lesson.marks.length + 1}`,
          kind,
          text: body.text,
          observedClock: body.observedClock,
          mediaOffsetSec,
          pauseRequested: kind === 'think',
        }, lesson.marks.length)
        lesson.marks.push(mark)
        await saveLesson(dataDir, lesson)
        return {
          ok: true,
          mark,
          playback: lesson.playback,
          note: kind === 'think'
            ? '已记「我想一下」，并标记暂停请求；实际暂停状态以原页面为准，本插件无法控制原站播放器。'
            : '标记已记录。',
          lesson: lessonSummary(lesson),
        }
      })
    },
  }), `study-companion: POST ${LESSON_MARK_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: ADAPTER_PROBE_ROUTE,
    method: 'GET',
    async handler() {
      const probed = await safariProbe()
      return {
        ok: probed.ok,
        tab: probed.tab,
        javascript: probed.javascript,
        media: probed.media,
        error: probed.error,
        note: probed.javascript !== undefined && probed.javascript.allowed !== true
          ? '需要在 Safari 设置 → 开发者 中勾选「允许从 Apple 事件执行 JavaScript」。'
          : '',
      }
    },
  }), `study-companion: GET ${ADAPTER_PROBE_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: ADAPTER_CONTROL_ROUTE,
    method: 'POST',
    async handler(request, body) {
      const action = text(body.action, 20)
      if (!['pause', 'play', 'seek'].includes(action)) {
        return { __status: 400, ok: false, error: 'action 只能是 pause / play / seek' }
      }
      const result = await controlPlayback(action, { seconds: body.seconds })
      if (result.ok !== true) {
        return { __status: 409, ok: false, error: result.error, javascript: result.javascript, requested: action, playback: null }
      }
      // 回读真实状态：不能把「已请求暂停」当成「已暂停」。
      const observed = await readMediaState()
      return {
        ok: true,
        requested: action,
        javascript: observed.javascript,
        playback: observed.ok === true && observed.media !== null && observed.media.video !== null
          ? {
              status: observed.media.video.paused === true ? 'paused' : 'playing',
              mediaOffsetSec: observed.media.video.currentTime,
              rate: observed.media.video.playbackRate,
            }
          : null,
        note: observed.ok !== true ? '控制请求已发出，但回读失败；实际状态以原页面为准。' : '',
      }
    },
  }), `study-companion: POST ${ADAPTER_CONTROL_ROUTE}`)

  ctx.effect(() => registerRoute(ctx, {
    path: LESSON_SYNC_ROUTE,
    method: 'POST',
    async handler(_request, body) {
      return await withMutation(dataDir, async () => {
        const lessonId = text(body.lessonId, 60)
        if (lessonId === '') return { __status: 400, ok: false, error: '缺少 lessonId' }
        const lesson = await readLessonById(dataDir, lessonId)
        if (lesson === null) return { __status: 404, ok: false, error: '找不到该课次' }
        const synced = await syncLessonFromSafari(lesson)
        if (synced.ok === false) {
          return {
            __status: 409,
            ok: false,
            error: synced.message,
            javascript: synced.javascript,
            lesson: lessonSummary(lesson),
            playback: lesson.playback,
          }
        }
        await saveLesson(dataDir, lesson)
        return {
          ok: true,
          javascript: synced.javascript,
          media: synced.media,
          message: synced.message,
          lesson: lessonSummary(lesson),
          fullLesson: lesson,
        }
      })
    },
  }), `study-companion: POST ${LESSON_SYNC_ROUTE}`)


}