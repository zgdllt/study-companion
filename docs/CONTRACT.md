# 伴学插件 · 接口契约（1.0.0，含 v2–v4 增量）

本文件是 Host / Client / 内容三部分的**唯一接口约定**。v2 依据用户确认：入口＝侧栏面板；评分回对话；面板只可「新建学科 + 记录考场答案」；数据按学科分离，一学科一文件。

阅读顺序：§0–§5 保留 v2 的基础模型，§6–§7 记录 v3 的接口增量与待实现项，§8 增加 v4 课堂、笔记及适配器接口；后面的增量补充前面的基础模型。当前使用与安装入口见 [README](../README.md)。标为待实现的决策不代表 1.0.0 已具备相应能力。

- 包名：`@local/study-companion`
- 面板 id / main key：`study-companion`
- 路由前缀：`/study-companion/api/`
- 中文名：伴学 ／ 英文名：Study Companion
- 数据目录：`$DSH_HOME/storages/study-companion/`（config `dataDir` 可覆盖）

## 0. 人机交互（这是设计基准，不要改）

| | 对话（伴学 agent） | 面板（伴学页） |
|---|---|---|
| 职责 | 讲解、拆阶梯、出 20 小时计划、**出题与评分**、费曼纠错、核验资源 | 看进度、**收答案**、查方法卡、新建学科 |
| 写入 | `study_write` 工具写学科档案 | `POST /subjects` 新建学科；`POST /active` 切换学科；`POST /exam/answer` 只写答案 |
| 不写 | — | 阶梯 / 计划 / 速查表 / 分数 / 漏洞，面板一律不写 |

典型一轮：面板新建学科 → 对话说「给这个学科建阶梯和 20 小时计划」→ agent 写档案 → 面板看到进度 → 学完一单元，对话说「开始考试」→ agent `ask_exam` 出题 → 面板「考场」显示题目 → 面板作答并提交（只存答案）→ 回对话说「继续考试」→ agent 读答案、`grade_exam` 打分并出下一题 → 面板刷新可见分数与漏洞。

## 1. 存储（一学科一文件）

```
$DSH_HOME/storages/study-companion/
├── active.json                 # {"activeSubjectId":"s_20261103_ab12"}
└── subjects/
    └── s_20261103_ab12.json    # 一个学科档案
```

学科档案（subject）：

```jsonc
{
  "version": 1,
  "id": "s_20261103_ab12",
  "topic": "自动驾驶定位与建图",
  "goal": "能独立完成一次激光雷达点云配准并解释误差来源",
  "deadline": "2026-11-20",           // 可空字符串
  "budgetHours": 20,
  "baseline": "会线性代数与 Python，没写过 SLAM",
  "status": "active",                  // active | paused | done
  "createdAt": "…", "updatedAt": "…",

  "ladder": {
    "current": 2,                      // 0..5，0=未评估
    "levels": [                        // 最多 5 条
      { "index": 1, "name": "完全初学者", "understand": "…",
        "mastery": "…", "milestone": "…", "selfTest": "…" }
    ]
  },

  "plan": {
    "units": [                         // 建议 10 条 × 2h
      { "index": 1, "title": "…", "concepts": "…", "exercise": "…",
        "deliverable": "…", "pass": "…", "hours": 2,
        "done": false, "doneAt": null }
    ]
  },

  "resources": [
    { "name": "…", "type": "书", "why": "…", "part": "第3-5章",
      "level": "入门", "how": "…", "skip": "…" }
  ],

  "gapLog": [                          // 已评分的考试记录（新→旧无所谓，按分数排序展示）
    { "id": "g1", "concept": "…", "question": "…", "answer": "…",
      "score": 4, "max": 10, "gap": "…", "feedback": "…",
      "independent": true,             // true=无提示独立完成；false=提示后才对；null=未记录
      "level": 2, "at": "2026-11-03T02:00:00.000Z" }
  ],

  "pendingExam": {                     // 当前待作答/待评分的题；无题时 null
    "questionId": "q7",
    "question": "…",
    "concept": "…",
    "level": 2,
    "askedAt": "…",
    "answer": "",                      // 面板写入
    "answerAt": null,
    "status": "awaiting_answer"        // awaiting_answer | awaiting_grade
  },

  "feynman": [                         // 费曼循环记录（对话写入）
    { "id": "f1", "concept": "…", "holes": "…", "passed": false, "at": "…" }
  ],

  "cheatsheet": { "markdown": "…", "savedAt": "…" },   // 或 null

  "reviews": [                         // 对话写入
    { "due": "2026-11-04", "stage": 1, "done": false, "doneAt": null }
  ],

  "stats": { "examRounds": 0, "avgScore": null, "feynmanRounds": 0 }
}
```

规则：键不可省；缺省用 `null` / `[]`；原子写（临时文件 + rename）；单个文件损坏时跳过该学科，不让整页崩。

## 2. 路由

### GET `/study-companion/api/state`

```jsonc
{
  "ok": true,
  "generatedAt": "…",
  "active": {                          // 无学科时 null
    "subject": { /* 上面的完整 subject 对象 */ },
    "derived": {
      "currentLevelName": "基础理解",
      "levelsTotal": 5, "unitsTotal": 10, "unitsDone": 3, "minutesDone": 240,
      "nextUnit": { "index": 4, "title": "…", "hours": 2 },   // 全完成时 null
      "dueReviews": [ { "due": "2026-11-04", "stage": 1, "overdue": false } ],
      "topGaps": [ { "concept": "…", "score": 4, "max": 10, "gap": "…" } ],  // ≤5，按分数升序
      "progressPct": 30                 // 已完成单元/总单元，无计划时 0
    },
    "pendingExam": { /* 同 subject.pendingExam，可为 null */ }
  },
  "subjects": [ {
    "id": "…", "topic": "…", "status": "active", "progressPct": 30,
    "mainSessionId": "session-…",   // 会话内挂件按它认领学科
    "unitsDone": 3, "unitsTotal": 10, "nextUnitTitle": "…",
    "pendingStatus": "awaiting_grade",   // 或 awaiting_answer / null
    "dueReviews": 1
  } ]
}
```

### GET `/study-companion/api/method`

```jsonc
{
  "ok": true, "version": 1,
  "principles": ["…","…","…"],
  "cards": [
    { "id": "ladder", "step": 1, "title": "学习阶梯",
      "tagline": "…", "when": "…",
      "body": ["…","…"],
      "prompt": "可直接复制到对话里的完整提示词，含 [主题] 占位符",
      "pitfall": "…" }
  ]
}
```

`cards` 固定 6 张，顺序 ladder → plan → exam → cheatsheet → signal → feynman。

### POST `/study-companion/api/subjects` 新建学科

请求：`{ "topic": "…", "goal": "…", "deadline": "YYYY-MM-DD", "budgetHours": 20, "baseline": "…" }`
响应：`{ "ok": true, "id": "s_…", "state": <同 GET /state 的响应体> }`
校验：`topic` 非空；`budgetHours` 0.5–400；`deadline` 可空。

### POST `/study-companion/api/active` 切换当前学科

请求：`{ "subjectId": "s_…" }`
响应：`{ "ok": true, "activeSubjectId": "s_…", "state": <同 GET /state> }`
规则：只写 `active.json`；未知 id 返回 404。

### POST `/study-companion/api/exam/answer` 提交答案

请求：`{ "subjectId": "s_…", "questionId": "q…", "answer": "…", "revise": false }`
响应：`{ "ok": true, "pendingExam": { …status:"awaiting_grade", answerSeq: n }, "state": <同 GET /state> }`

规则（v3，全部已实现）：
- **只写** `pendingExam.answer/answerAt/answerSeq/status`；**绝不评分**。
- `questionId` 必填且必须等于 `pendingExam.questionId`：缺 → 400；不匹配（题目已更新）→ 409，且**不写入任何内容**。
- `pendingExam.status === "awaiting_grade"` 时再次提交必须带 `revise: true`，否则 409：避免评分读到的版本和用户以为提交的版本不一致。
- 每次成功提交 `answerSeq += 1`；`grade_exam` 必须回传读到的 `answerSeq`。
- 没有待答题时 409 `{ "ok": false, "error": "当前没有待作答的题目" }`。

### 变更事务（并发安全）

- 所有写路径（`study_write` 工具、POST 答案、POST 新建学科、POST 切换学科）都在 `withMutation(dataDir, …)` 里串行执行整段「读最新档案 → 修改 → 原子写回」。
- 只给 `writeJson` 排队不够：两个并发调用会各自读到旧档案，后写的覆盖先写的（审查复现：10/10 次并发完成两个单元只保留一个）。

### 通用

- 只接受声明的 method；其余 405。
- 每个请求先过 `ctx.connection.requestRejection(request)`（照抄 robocup-arena 的 `rejectionOf`）。
- JSON 响应 `content-type: application/json; charset=utf-8`、`cache-control: no-store`。
- POST 请求体上限 64 KiB：非法 JSON / 非对象（含数组）→ **400**；超过上限 → 413。

## 3. 面板结构（Client）

- `sidebar.panellist`（id `study-companion`，order 40）+ `main`（key `study-companion`）。
- 图标：原创 SVG「书 + 环形回路」，`currentColor`。
- 头部：图标 +「伴学」+ 副标题「把一次对话变成一条学习回路」+ 学科切换器 + 刷新 + 上次更新时间。
- 四个页签：
  1. **概览**：无学科时是空状态（新建学科表单：主题必填，目标/截止/预算选填 + 说明「建好后去对话里说：给这个学科建阶梯和 20 小时计划」）。有学科时：项目头卡（主题/目标/截止/预算/状态）、进度条、今日任务（下一个单元）、到期复测、最近三次得分。
  2. **阶梯**：五级阶梯时间线（当前级高亮，展开里程碑与自测）+ 10 单元计划表（完成打勾、当前单元高亮）。
  3. **考场**：无题时说明「在对话里说『开始考试』，伴学会出第一题」；有待答题时显示题面 + 难度级 + 文本框 + 提交按钮；提交后横幅提示「答案已记录，回对话说『继续考试』让伴学评分」并给一键复制该句；显示待评分状态与最近考试记录（分数条 + 漏洞）。
  4. **方法**：`/api/method` 六张卡（序号、标题、何时用、要点、提示词代码块 + 复制、常见误用）+ 底部四要素与证据边界。
- 数据：GET state/method；POST subjects、exam/answer。`credentials:'same-origin'`、`cache:'no-store'`。
- 样式只用 `--dsw-alias-*` token，类名 `study-` 前缀，`<style>` 用 `ctx.effect` 挂载清理。无外部依赖、纯 JS、`React.createElement`。
- 所有可见文案走 `ctx.locale.register('study-companion',{zh,en})`；缺数据/加载中/500/无题/无计划都要有可读文案。

## 4. 内容文件 `content/method.json`

结构 = 第 2 节 `/api/method` 响应体去掉 `ok`。Host 直接读并返回。

## 5. 文件清单

```
plugin-study-companion/
├── package.json · cordis.patch.yml · index.js · client.js
├── content/method.json
├── locale/{zh,en}.json · icon.svg
├── docs/CONTRACT.md · README.md
```

---

## 6. v3 已确认规格（用户 2026-11-03 逐项拍板；✅=已实现，⏳=待实现）

以下决策已确认，尚未全部落码；实现前本节的契约字段以「待实现」为准。

1. ✅ **学科绑定主伴学对话**：每个学科档案增加 `mainSessionId` / `mainSessionLabel`；出题、提交、继续评分都精确归属该对话；允许显式更换主对话并保留历史（`sessionHistory[]`）。
2. ✅（实现路径与审查建议略有不同，见下） **面板主操作改为「提交并继续考试」**：先保存答案（现有 POST），成功后由 Client 调 `ctx.uiWorkspace.openSession(mainSessionId)` + `ctx.conversation.sendSession(session, '继续考试', [], 'queue', signal)`；`queue` 不打断当前轮；发送失败保留答案并可重试；不改动输入框已有草稿；面板区分「答案已保存 / 请求已发送或排队 / 评分完成」三态。
3. ✅ **对话身份来自工具执行上下文**：`execute(args, exec)` 用 `exec.agent.id` / `exec.agent.session.id` 认领或校验学科的 `mainSessionId`；不从全局面板选择推断。面板根 Context 不绑定 Session，因此绑定关系必须持久化在学科档案里。
4. ✅ **掌握度与计划完成度分离**：新增 `unitMastery[]`：`{ unitIndex, independentPassAt, reviewPassAt, promptedOnlyAt, note }`；`plan.units[].done` 只表示计划进度，不等于掌握。
5. ✅（不含教材内联校验） **评分拆项 + 教材可追溯**：`grade_exam` 增加 `items: [{ label, score, max }]`（如「写对偶 10 分 / 选对偶可行解并用弱对偶给界 5 分」）与 `source: { file, page, note }`；接受不同但合法的解法与界，不得要求等于某一份题解的数值。
6. ⏳ **首单元验收协议**：两道新变式独立完成 + 隔天一道新变式复测；每道都要写对对偶模型、验证所选对偶解可行、给出方向正确的目标界并解释关键理由；生成变式与推导必须可检查，不能把模型自行作答算作用户通过。
7. ⏳ **学习计划尊重真实预算与前测**：先做不看答案的短诊断（一次一题），再结合目标定起点与计划；不按自报基础直接套通用 20h 计划。
8. ⏳ **资料边界**：教学与判分优先依据指定教材/讲义/题解；资料外的补充、推断与生成题必须显式标注；结论应能追溯到文件与页码。
9. ⏳ **首版进入验收前必须补的验证**：真实 DSH 加载、面板→对话→工具评分全链路、切换面板学科不串写、发送失败可重试、等价合法解不误判；以及用户当次独立解题与隔天复测（后者尚未发生，待真实验收）。


### 6.1 v3 已实现的接口增量

学科档案新增：

```jsonc
{
  "mainSessionId": "session-…",      // 绑定的主伴学对话；未绑定为 null
  "mainSessionLabel": "运筹学主对话",
  "sessionHistory": [ { "sessionId": "…", "label": "…", "replacedAt": "…" } ],
  "unitMastery": [
    { "unitIndex": 1, "independentPassAt": "…", "reviewPassAt": null,
      "promptedOnlyAt": "…", "note": "提示了两步" }
  ]
}
```

`gapLog[]` 新增 `items[]`（拆项得分）与 `source`（依据文件与页码）。

`study_write` 新增：

- `bind_session`：`{ subject, sessionId?, sessionLabel? }`；省略 `sessionId` 时绑定调用它的对话；更换时旧值进 `sessionHistory`。
- `record_mastery`：`{ unitIndex, kind: independent|review|prompted, passed?, note? }`。
- `grade_exam` 新增 `items[]` 与 `source`；工具执行上下文由 `execute(args, exec)` 的 `exec.agent.id / exec.agent.session.id` 提供。
- `create` 自动把调用对话记为 `mainSessionId`；`ask_exam` / `grade_exam` / `record_mastery` 若学科已绑定且调用方不是该对话 → 拒绝。
- `study_read` 的 `derived` 新增 `mastery: { independentUnits, reviewedUnits, totalUnits }` 与 `mainSessionId`。

面板「提交并继续考试」实现路径（与审查建议的第 9 条不同，因为 Client 服务目录里没有 `conversation` 服务）：

```js
const ref = ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
await ref.ready
const result = await ref.binding.session.prompt([{ type: 'text', text: '继续考试' }], 'queue')
ref.release()
if (result.ok) ctx.uiWorkspace.openSession(sessionId)
```

- 先保存答案（POST），再发送继续请求，再打开对话；三态：已保存 / 发送中 / 已发送。
- 发送失败保留答案并给出「重发继续请求」；不触碰输入框草稿（`queue` 模式 + 直接 `session.prompt`，不走 composer 草稿）。
- 学科未绑定对话时，提交只保存答案，并提示去对话里 `bind_session`。


## 7. 会话内挂件（v3.1 已实现）

- 注册点：`conversation.composer.dock`（list / session scope），id `study-companion-dock`，order 50。
- 数据：`GET /state` 的 `subjects[]` 摘要，按 `mainSessionId === props.sessionId` 认领；不匹配时不渲染。
- 展示：主题 · 已完成/总单元 · 下一单元标题（或待作答/待评分/计划已完成）· 到期复测数 · 待评分提示。
- 交互：点击 → `ctx.layout.selectPanel('study-companion')` 打开全局面板；每 10 秒轮询一次；路由失败时静默隐藏。
- 与「每学科绑定主对话」一致：只有主对话显示该学科挂件，其他对话不显示。


---

## 8. v4：同堂伴学与课程回溯（本阶段实现在此定义）

依据 `research/2026-11-03-伴学插件/02-同堂伴学与课程回溯设计.md`。原则：**媒体与长转写只按引用保存**，不进 subject 快照、不进答案接口；课次、锚点、笔记、偏好各自实体化。

### 8.1 存储布局（新增）

```
$DSH_HOME/storages/study-companion/
├── subjects/<subjectId>.json      # 既有
├── courses/<courseId>.json        # 课程（平台 + 网址 + 学科归属）
├── lessons/<lessonId>.json        # 一次听课（课次）
└── prefs.json                     # 表达偏好：global 默认 + 每学科覆盖
```

三个新目录与 subject 一样走 `withMutation(dataDir, …)` 串行事务与原子写；单文件损坏只跳过该条。

### 8.2 实体

**course**：`{ id, subjectId, title, platform: 'yuketang'|'bilibili'|'xuetangx'|'other', url, createdAt, updatedAt }`

**lesson**（一次听课）：

```jsonc
{
  "id": "l_…", "courseId": "c_…", "subjectId": "s_…", "title": "Chap5-1（2）",
  "state": "open",                      // open | closed
  "startedAt": "…", "endedAt": null,
  "capabilities": {                     // available | unavailable | unverified
    "mediaTime": "unverified", "seek": "unverified", "pause": "unverified",
    "slides": "unverified", "captions": "unverified", "grab": "unverified"
  },
  "playback": {                         // 只记录观察到的状态，不假装已知
    "status": "unknown",                // unknown | playing | paused
    "mediaOffsetSec": null,             // 玩家 currentTime；无接口时必须是 null
    "rate": null,
    "source": "declared",               // declared | adapter
    "updatedAt": "…"
  },
  "materials": [                        // 只存引用，不存二进制
    { "id": "m1", "kind": "slide|pdf|image|url|captions", "title": "…", "ref": "…", "version": "" }
  ],
  "anchors": [                          // 一个知识点可有多个来源
    { "id": "a1", "kind": "slide|media|note|material",
      "materialId": "m1", "page": 5, "region": "",
      "startSec": null, "endSec": null, "aligned": true,
      "observedClock": null,            // 页面显示的「09:45」这类授课时刻，未对齐时只放这里
      "label": "…", "confidence": "declared|observed|inferred" }
  ],
  "knowledge": [ { "id": "k1", "name": "对偶构造", "anchorIds": ["a1"] } ],
  "marks": [                            // 课中主动标记（面板/对话）
    { "id": "mk1", "kind": "important|confused|think|question", "text": "…",
      "at": "…", "observedClock": null, "mediaOffsetSec": null }
  ],
  "notes": [                            // 多条笔记，按偏好顺序渲染
    { "id": "n1", "title": "…", "intuition": "…", "example": "…", "formula": "…",
      "conditions": "…", "pitfalls": "…", "sourcePoints": ["…"], "generated": ["…"],
      "anchorIds": ["a1"], "knowledgeIds": ["k1"], "tags": [],
      "status": "user_edited|agent|draft", "updatedAt": "…" }
  ],
  "sections": [                         // 互动补讲小节
    { "id": "sec1", "title": "…", "objective": "…", "prerequisites": "…",
      "blocks": [ { "kind": "text|example|formula|question", "body": "…" } ],
      "sourceRefIds": ["a1"], "status": "generated|excerpt",
      "createdAt": "…" }
  ],
  "trace": [                            // 从练习回溯的落点（写入即证据）
    { "id": "t1", "concept": "…", "gapId": "g1", "anchorIds": ["a1"], "noteIds": ["n1"], "at": "…" }
  ]
}
```

**prefs**：

```jsonc
{
  "global": {
    "order": ["intuition", "visual", "example", "formula", "conditions", "pitfalls"],
    "language": "zh",
    "notation": "",
    "updatedAt": "…"
  },
  "subjects": { "s_…": { "order": ["intuition", "example", "formula"], "language": "zh", "updatedAt": "…" } }
}
```

### 8.3 工具（`study_write` 新增 action，`study_read` 不变，新增 `lesson_read`）

| action | 参数 | 作用 |
|---|---|---|
| `lesson_open` | subject, courseTitle, platform, url, lessonTitle | 建/复用 course，开一个 lesson，返回 id |
| `lesson_close` | lessonId | 关课次，写 endedAt |
| `lesson_capability` | lessonId, capability, value | 声明能力 available/unavailable/unverified |
| `lesson_playback` | lessonId, status, mediaOffsetSec?, rate?, source? | 记录观察到的播放状态；mediaOffsetSec 只在真有接口时填 |
| `lesson_mark` | lessonId, kind, text?, observedClock? | 重要/没懂/我想一下/提问 |
| `material_add` | lessonId, kind, title, ref, version? | 只存引用 |
| `anchor_add` | lessonId, kind, page?, startSec?, endSec?, aligned?, observedClock?, materialId?, label, confidence? | 来源锚点 |
| `knowledge_add` | lessonId, name, anchorIds[] | 知识点→锚点 |
| `note_write` | lessonId, noteId?, title, intuition/example/formula/conditions/pitfalls, sourcePoints?, generated?, anchorIds?, knowledgeIds?, tags? | 新建或按 noteId 合并更新 |
| `section_write` | lessonId, sectionId?, title, objective, prerequisites?, blocks[], sourceRefIds? | 互动补讲小节（status=generated） |
| `trace_record` | lessonId, concept, gapId?, anchorIds[], noteIds? | 把一次「从练习回溯」落成证据 |
| `pref_set` | scope: global\|subject, subject?, patch | 表达偏好 |

`lesson_read` 参数：`{ subject?, lessonId? }` → `{ ok, lesson, lessons:[摘要], prefs }`；不带 lessonId 时取该学科最近一次 open 的课次。

**硬规则（写进工具描述）**：

- 没有播放器接口时 `mediaOffsetSec` 必须为 `null`，不得用电脑时间或页面显示的授课时刻填充。
- 页面显示的「09:45」只能进 `observedClock`，且 `aligned:"false"`、`confidence:"declared"`。
- 生成内容（补讲、agent 补充）必须落在 `generated[]`/`sections[].status:"generated"`，不得附加原课时间点。
- 「没检索到原片段」与「老师没讲」要分开表述。

### 8.4 面板路由（同源）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/study-companion/api/lessons?subjectId=` | 该学科的课次摘要列表 |
| GET | `/study-companion/api/lesson?id=` | 单课次全量 |
| GET | `/study-companion/api/prefs?subjectId=` | 全局偏好 + 该学科覆盖（已合并） |
| POST | `/study-companion/api/lesson/mark` | `{lessonId, kind, text?, observedClock?}` 面板标记；think 类会写 `pauseRequested:true` |
| GET | `/study-companion/api/adapter/probe` | Safari 适配器探针：前台页身份、JavaScript 权限、媒体状态 |
| POST | `/study-companion/api/adapter/control` | `{action: pause\|play\|seek, seconds?}`，执行后**回读**真实状态 |
| POST | `/study-companion/api/lesson/sync` | `{lessonId}`：用适配器读一次真实 currentTime/paused/rate 并写回；读不到就 409 且不写推测值 |

适配器（`adapter/safari.js`）能力边界：
- 前台页 URL/标题只需 macOS 自动化权限；
- 媒体时间、暂停、定位需要 Safari 设置 → 开发者 →「允许从 Apple 事件执行 JavaScript」；
- 未开启时 `probe.javascript.allowed=false`，`/lesson/sync` 返回 409，`playback.mediaOffsetSec` 保持 `null`（**未知值不会被写成 0**）；
- 控制接口只回读不猜测：`pause` 请求成功后仍以回读的 `paused` 为准。

面板的「我想一下」只做两件事：记标记 + 记「已请求暂停」。**界面显示的实际状态必须是 `playback.status`**（unknown/playing/paused），不能把请求当成事实；真正暂停要在原页面确认后由适配器/用户回填。

### 8.5 Client「课堂」页签

- 课次列表：平台、标题、开/关、当前播放状态、能力徽标（可用/不可用/未验证）。
- 当前课次：四个操作按钮（这里重要 / 这里没懂 / 我想一下 / 提问）。
- 笔记：按偏好顺序渲染（默认 直觉 → 图示/例子 → 公式 → 条件 → 易错），「原课要点」与「agent 补充」分栏，来源锚点可点开看页码/时间/未对齐提示。
- 回溯：从「考场」的漏洞条目点「查来源」→ 展示该 knowledge/概念关联的锚点、笔记与互动小节。
- 生成内容带「生成」标记；页面明示「本页不能控制原站播放，暂停状态以原页面为准」。
