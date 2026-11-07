/**
 * 伴学（study-companion）— Client 半边。
 *
 * 侧栏入口 + 四个页签的面板：
 *  概览（学科头卡 / 进度 / 今日任务 / 到期复测 / 最近得分 / 新建学科）
 *  阶梯（五级学习阶梯时间线 + 20 小时计划）
 *  考场（显示对话里出的题 → 面板作答 → 只提交答案 → 回对话评分）
 *  方法（六张方法卡，每张可一键复制提示词）
 *
 * 只读为主：面板只写两件事——新建学科、提交考场答案（另加切换当前学科）。
 * 评分、阶梯、计划、速查表全部由对话里的 agent 通过 study_write 写入。
 */

window.__ModuleLoader__.load({
  id: '@local/study-companion',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'study-companion'
    const PANEL_ID = 'study-companion'
    const STATE_ROUTE = '/study-companion/api/state'
    const METHOD_ROUTE = '/study-companion/api/method'
    const SUBJECTS_ROUTE = '/study-companion/api/subjects'
    const ACTIVE_ROUTE = '/study-companion/api/active'
    const ANSWER_ROUTE = '/study-companion/api/exam/answer'
    const LESSONS_ROUTE = '/study-companion/api/lessons'
    const LESSON_ROUTE = '/study-companion/api/lesson'
    const LESSON_MARK_ROUTE = '/study-companion/api/lesson/mark'
    const LESSON_SYNC_ROUTE = '/study-companion/api/lesson/sync'
    const ADAPTER_PROBE_ROUTE = '/study-companion/api/adapter/probe'
    const ADAPTER_CONTROL_ROUTE = '/study-companion/api/adapter/control'
    const GRADED_MARK = '继续考试'
    const CONTINUE_TEXT = '继续考试'

    const EN = {
      title: 'Study Companion',
      subtitle: 'Turn one chat into a learning loop',
      tabOverview: 'Overview',
      tabLadder: 'Ladder',
      tabExam: 'Exam',
      tabMethod: 'Method',
      refresh: 'Refresh',
      loading: 'Loading…',
      updated: 'Updated {time}',
      errorTitle: 'Route error',
      errorHint: 'The Host route did not answer. Reload the page or check the plugin row in Settings → Plugins.',
      emptyTitle: 'No subject yet',
      emptyHint: 'Create a subject here, then ask in chat: "Build the ladder and the 20-hour plan for this subject".',
      newSubject: 'New subject',
      topic: 'Subject',
      topicPlaceholder: 'e.g. Tensor algebra',
      goal: 'Goal',
      goalPlaceholder: 'What you can do independently, where',
      deadline: 'Deadline',
      budget: 'Budget (hours)',
      baseline: 'Baseline',
      baselinePlaceholder: 'What you already know, what you do not',
      create: 'Create',
      creating: 'Creating…',
      cancel: 'Cancel',
      subjects: 'Subjects',
      subjectHead: 'Subject',
      status: 'Status',
      statusActive: 'active',
      statusPaused: 'paused',
      statusDone: 'done',
      progress: 'Progress',
      unitsDone: '{done} / {total} units',
      minutesDone: '{minutes} min studied',
      level: 'Level',
      notAssessed: 'not assessed',
      avgScore: 'Average score',
      nextTask: 'Next task',
      nextTaskHint: 'Ask in chat: "start unit {index}"',
      allUnitsDone: 'All units are done. Time for a review, or a new goal.',
      dueReviews: 'Reviews due',
      noReviews: 'No reviews scheduled yet.',
      overdue: 'overdue',
      recentScores: 'Recent scores',
      noScores: 'No graded answers yet.',
      independent: 'independent',
      prompted: 'after hint',
      ladderEmpty: 'No ladder yet. Ask in chat: "build the ladder for this subject".',
      ladderCurrent: 'current level',
      milestone: 'Milestone',
      selfTest: 'Self test',
      understand: 'What to understand',
      mastery: 'What mastery looks like',
      plan: '20-hour plan',
      planEmpty: 'No plan yet. Ask in chat: "split this into 10 two-hour units".',
      hours: '{hours} h',
      done: 'done',
      examEmptyTitle: 'No question yet',
      examEmptyHint: 'Ask in chat: "start the exam" — your companion writes the first question here.',
      examLevel: 'Level {level}',
      examQuestion: 'Question',
      examAnswerLabel: 'Your answer',
      examAnswerPlaceholder: 'Answer in your own words. No hints while answering.',
      examSubmit: 'Submit answer',
      examSubmitting: 'Submitting…',
      examAwaitingGrade: 'Awaiting grade',
      examAwaitingAnswer: 'Awaiting your answer',
      examSubmitted: 'Answer saved',
      examSubmittedHint: 'Go back to the chat and say: "continue the exam" — your companion reads this answer, grades it and asks the next question.',
      copyInstruction: 'Copy this sentence',
      copied: 'Copied',
      copyFailed: 'Copy failed — select the text manually.',
      submitFailed: 'Could not save the answer.',
      gradedTitle: 'Graded answers',
      gap: 'Gap',
      feedback: 'Re-teach',
      noGap: 'no specific gap recorded',
      methodPrinciples: 'Why random questions do not work',
      methodCards: 'Six prompts, six jobs',
      methodFooter: 'A path, a test, a compression, a feedback loop — that is the whole system. Retrieval practice and spacing are supported mechanisms (Roediger & Karpicke 2006; Cepeda et al. 2006); they are not a promise of "10x faster".',
      copyPrompt: 'Copy prompt',
      pitfall: 'Common misuse',
      whenToUse: 'When to use',
      switchFailed: 'Could not switch subject.',
      createFailed: 'Could not create the subject.',
      examSubmitAndContinue: 'Submit and continue',
      examSending: 'Answer saved; sending "continue the exam" to the companion chat…',
      examSendingHint: 'This does not touch your composer draft.',
      examSent: 'Sent — opening the companion chat',
      examSentHint: 'Grading and the next question happen in that chat; come back here for scores and gaps.',
      examSaved: 'Answer saved',
      examSavedHint: 'A failed auto-send never loses the answer; retry, or say "continue the exam" in the chat.',
      examSavedNoSession: 'Answer saved (no companion chat bound yet)',
      examSavedNoSessionHint: 'Say "bind this chat" in the companion chat; the panel can then submit and continue in one click.',
      retrySend: 'Retry continue request',
      sendFailed: 'Continue request failed',
      servicesUnavailable: 'This page cannot send messages directly; say "continue the exam" in the chat.',
      sessionBoundHint: 'Grading happens in the bound companion chat; submitting sends "continue the exam" and opens it.',
      sessionUnboundHint: 'No companion chat bound yet: say "bind this chat" there to enable one-click submit-and-continue.',
      source: 'Source',
      dockUnits: '{done}/{total} units',
      dockNextUnit: 'Next: {title}',
      dockAllDone: 'Plan complete',
      dockAwaitingAnswer: 'One question waiting',
      dockAwaitingGrade: 'One answer to grade',
      dockDue: '{count} reviews due',
      dockGradePill: 'to grade',
      dockOpenHint: 'Open Study Companion',
      tabLesson: 'Lesson',
      lessonEmptyTitle: 'No lesson yet',
      lessonEmptyHint: 'Say "start following this lesson" in chat; this panel cannot control the site player.',
      lessonList: 'Lessons',
      lessonPlatform: 'Platform',
      lessonPlayback: 'Playback',
      lessonUnknown: 'unknown',
      lessonPlaying: 'playing',
      lessonPaused: 'paused',
      lessonOffset: 'Media offset',
      lessonOffsetNone: 'unknown (no player API)',
      lessonCapabilities: 'Capabilities (unverified ≠ available)',
      capAvailable: 'available',
      capUnavailable: 'unavailable',
      capUnverified: 'unverified',
      lessonMarkImportant: 'Important',
      lessonMarkConfused: 'Confused',
      lessonMarkThink: 'Let me think',
      lessonMarkQuestion: 'Question',
      lessonThinkBanner: 'Recorded "let me think" and a pause request; this panel cannot control the site player — trust the state above.',
      lessonMarks: 'Marks',
      lessonNoMarks: 'No marks yet.',
      lessonNotes: 'Notes',
      lessonNoNotes: 'No notes yet. Say "turn that segment into notes" in chat.',
      noteSource: 'From the lecture',
      noteGenerated: 'Agent addition (generated)',
      noteIntuition: 'Intuition',
      noteVisual: 'Picture / example',
      noteExample: 'Example',
      noteFormula: 'Formula',
      noteConditions: 'Conditions',
      notePitfalls: 'Pitfalls',
      noteAnchors: 'Sources',
      lessonAnchorsCard: 'Slide anchors',
      lessonNoAnchors: 'No slide anchors yet.',
      anchorAligned: 'aligned',
      anchorInferred: 'inferred',
      lessonSections: 'Micro-lessons',
      lessonNoSections: 'No micro-lesson yet.',
      sectionGenerated: 'Generated',
      sectionObjective: 'Objective',
      sectionPrerequisites: 'Prerequisites',
      traceTitle: 'Trace sources',
      traceHint: 'Looking for "{concept}". Finding nothing means "not retrieved", not "the teacher skipped it".',
      traceNone: 'No matching anchor or note found.',
      traceButton: 'Trace',
      anchorSlide: 'Slide {page}',
      anchorMedia: 'Lecture {start}–{end}',
      anchorMinutes: '{m}:{s}',
      anchorClock: 'Page clock {clock} (unaligned)',
      anchorNote: 'Note',
      anchorMaterial: 'Material',
      openCoursePage: 'Open course page',
      markFailed: 'Mark failed',
      lessonLoadFailed: 'Could not load the lesson',
      adapterTitle: 'Safari adapter',
      adapterAllowed: 'JavaScript from Apple Events allowed',
      adapterBlocked: 'Safari blocks JavaScript from Apple Events',
      adapterBlockedHint: 'Safari Settings → Developer → enable "Allow JavaScript from Apple Events", then sync.',
      adapterNoTab: 'No Safari front tab',
      adapterHasVideo: 'video element found',
      adapterNoVideo: 'No readable video on this page',
      adapterFront: 'Front page',
      syncNow: 'Sync playback',
      pauseCourse: 'Pause course',
      resumeCourse: 'Resume course',
      syncOk: 'Synced',
      syncFailed: 'Sync failed',
      controlFailed: 'Control request failed',
      adapterObserved: 'Observed state',
      adapterUnverified: 'Until the adapter is ready, media offset stays null.',
      masteryIndependent: 'independent',
      masteryReviewed: 'review passed',
      masteryPrompted: 'after hint',
      masteryStat: 'units mastered',
    }

    const ZH = {
      title: '伴学',
      subtitle: '把一次对话变成一条学习回路',
      tabOverview: '概览',
      tabLadder: '阶梯',
      tabExam: '考场',
      tabMethod: '方法',
      refresh: '刷新',
      loading: '加载中…',
      updated: '更新于 {time}',
      errorTitle: '路由错误',
      errorHint: 'Host 路由没有响应。刷新页面，或在 设置 → 插件 里检查插件行。',
      emptyTitle: '还没有学科',
      emptyHint: '先在这里新建一个学科，然后去对话里说：给这个学科建阶梯和 20 小时计划。',
      newSubject: '新建学科',
      topic: '学科',
      topicPlaceholder: '例如：张量代数',
      goal: '目标',
      goalPlaceholder: '在什么情境下能独立完成什么',
      deadline: '截止日期',
      budget: '预算（小时）',
      baseline: '现有基础',
      baselinePlaceholder: '会什么、不会什么',
      create: '创建',
      creating: '创建中…',
      cancel: '取消',
      subjects: '学科',
      subjectHead: '学科',
      status: '状态',
      statusActive: '进行中',
      statusPaused: '暂停',
      statusDone: '已完成',
      progress: '进度',
      unitsDone: '{done} / {total} 个单元',
      minutesDone: '已学 {minutes} 分钟',
      level: '当前等级',
      notAssessed: '未评估',
      avgScore: '平均分',
      nextTask: '今日任务',
      nextTaskHint: '去对话里说：开始第 {index} 单元',
      allUnitsDone: '计划里的单元都完成了。该复习了，或者该开一个新目标。',
      dueReviews: '到期复测',
      noReviews: '还没有排复测。',
      overdue: '已过期',
      recentScores: '最近得分',
      noScores: '还没有评过分。',
      independent: '独立完成',
      prompted: '提示后完成',
      ladderEmpty: '还没有阶梯。去对话里说：给这个学科建学习阶梯。',
      ladderCurrent: '当前等级',
      milestone: '里程碑',
      selfTest: '自测题',
      understand: '这一级要理解',
      mastery: '精通表现',
      plan: '20 小时计划',
      planEmpty: '还没有计划。去对话里说：把它拆成 10 个 2 小时单元。',
      hours: '{hours} 小时',
      done: '已完成',
      examEmptyTitle: '还没有题目',
      examEmptyHint: '去对话里说「开始考试」，伴学会把第一题写到这里。',
      examLevel: '第 {level} 级',
      examQuestion: '题目',
      examAnswerLabel: '你的回答',
      examAnswerPlaceholder: '用自己的话回答。作答时不要看提示。',
      examSubmit: '提交答案',
      examSubmitting: '提交中…',
      examAwaitingGrade: '等待评分',
      examAwaitingAnswer: '等待作答',
      examSubmitted: '答案已记录',
      examSubmittedHint: '回对话说「继续考试」，伴学会读到你刚写的答案、评分并出下一题。',
      copyInstruction: '复制这句话',
      copied: '已复制',
      copyFailed: '复制失败，请手动选中文本。',
      submitFailed: '答案保存失败。',
      gradedTitle: '已评分记录',
      gap: '漏洞',
      feedback: '重讲',
      noGap: '没有记录具体漏洞',
      methodPrinciples: '为什么随口提问学不会',
      methodCards: '六个提示词，六件事',
      methodFooter: '一条路径、一场测试、一份压缩、一个反馈循环——整套系统就是这四样。检索练习与间隔重复是有研究支持的机制（Roediger & Karpicke 2006；Cepeda 等 2006），不等于「快 10 倍」的效果承诺。',
      copyPrompt: '复制提示词',
      pitfall: '常见误用',
      whenToUse: '什么时候用',
      switchFailed: '切换学科失败。',
      createFailed: '新建学科失败。',
      examSubmitAndContinue: '提交并继续考试',
      examSending: '答案已保存，正在把「继续考试」发给伴学对话…',
      examSendingHint: '这一步不会改动输入框里的草稿。',
      examSent: '已发送，正在打开伴学对话',
      examSentHint: '评分与下一题由那个对话里的伴学 agent 完成；评分后回面板看分数与漏洞。',
      examSaved: '答案已保存',
      examSavedHint: '自动发送失败时答案不会丢；点「重发继续请求」重试，或手动回伴学对话说「继续考试」。',
      examSavedNoSession: '答案已保存（这个学科还没绑定伴学对话）',
      examSavedNoSessionHint: '在伴学对话里说「绑定当前对话」，之后面板就能直接提交并继续。',
      retrySend: '重发继续请求',
      sendFailed: '继续请求发送失败',
      servicesUnavailable: '当前页面不支持直接发送消息；请手动回伴学对话说「继续考试」。',
      sessionBoundHint: '评分发生在绑定的伴学对话里；提交后会自动发「继续考试」并打开它。',
      sessionUnboundHint: '尚未绑定伴学对话：在对话里说「绑定当前对话」后，面板可一键提交并继续。',
      source: '依据',
      dockUnits: '{done}/{total} 单元',
      dockNextUnit: '下一单元：{title}',
      dockAllDone: '计划已完成',
      dockAwaitingAnswer: '有一题待作答',
      dockAwaitingGrade: '有一题待评分',
      dockDue: '{count} 个复测到期',
      dockGradePill: '待评分',
      dockOpenHint: '打开伴学面板',
      tabLesson: '课堂',
      lessonEmptyTitle: '还没有跟课记录',
      lessonEmptyHint: '在对话里说「开始跟随这节课」，伴学会建一条课次；本面板不能控制原站播放器。',
      lessonList: '课次',
      lessonPlatform: '平台',
      lessonPlayback: '播放状态',
      lessonUnknown: '未知',
      lessonPlaying: '播放中',
      lessonPaused: '已暂停',
      lessonOffset: '媒体位置',
      lessonOffsetNone: '未知（没有播放器接口）',
      lessonCapabilities: '能力（未验证不等于可用）',
      capAvailable: '可用',
      capUnavailable: '不可用',
      capUnverified: '未验证',
      lessonMarkImportant: '这里重要',
      lessonMarkConfused: '这里没懂',
      lessonMarkThink: '我想一下',
      lessonMarkQuestion: '提问',
      lessonThinkBanner: '已记「我想一下」并发起暂停请求；本面板不能控制原站播放器，实际状态以上面为准。',
      lessonMarks: '课中标记',
      lessonNoMarks: '还没有标记。',
      lessonNotes: '课堂笔记',
      lessonNoNotes: '还没有笔记。去对话里说「把刚才这段整理成笔记」。',
      noteSource: '原课要点',
      noteGenerated: 'agent 补充（生成）',
      noteIntuition: '直觉',
      noteVisual: '图示 / 例子',
      noteExample: '例子',
      noteFormula: '公式与推导',
      noteConditions: '条件',
      notePitfalls: '易错点',
      noteAnchors: '来源',
      lessonAnchorsCard: '课件锚点',
      lessonNoAnchors: '还没有课件锚点。',
      anchorAligned: '已对齐',
      anchorInferred: '推定对齐',
      lessonSections: '互动补讲',
      lessonNoSections: '还没有补讲。',
      sectionGenerated: '生成内容',
      sectionObjective: '目标',
      sectionPrerequisites: '前置',
      traceTitle: '来源回溯',
      traceHint: '正在按「{concept}」找来源；没有匹配时说明「当前未检索到」，不等于老师没讲。',
      traceNone: '当前没有检索到对应锚点或笔记。',
      traceButton: '查来源',
      anchorSlide: '课件第 {page} 页',
      anchorMedia: '原课 {start}–{end}',
      anchorMinutes: '{m}:{s}',
      anchorClock: '页面显示 {clock}（未对齐）',
      anchorNote: '笔记',
      anchorMaterial: '资料',
      openCoursePage: '打开课程网页',
      markFailed: '标记失败',
      lessonLoadFailed: '课次加载失败',
      adapterTitle: 'Safari 适配器',
      adapterAllowed: '已允许执行 JavaScript',
      adapterBlocked: 'Safari 未允许执行 JavaScript',
      adapterBlockedHint: '打开 Safari 设置 → 开发者，勾选「允许从 Apple 事件执行 JavaScript」后点同步。',
      adapterNoTab: 'Safari 没有前台标签页',
      adapterHasVideo: '检测到视频元素',
      adapterNoVideo: '当前页没有可读的 video 元素',
      adapterFront: '前台页面',
      syncNow: '同步播放状态',
      pauseCourse: '暂停原课',
      resumeCourse: '继续原课',
      syncOk: '已同步',
      syncFailed: '同步失败',
      controlFailed: '控制请求失败',
      adapterObserved: '回读状态',
      adapterUnverified: '适配器未就绪时，媒体位置保持 null。',
      masteryIndependent: '独立通过',
      masteryReviewed: '复测通过',
      masteryPrompted: '提示后完成',
      masteryStat: '独立掌握单元',
    }

    const CSS = `
      .study-panel {
        height: 100%; overflow: auto;
        padding: 24px clamp(16px, 3vw, 36px) 40px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        font-size: 13px; line-height: 1.55;
      }
      .study-panel * { box-sizing: border-box; }
      .study-head {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
      }
      .study-headline { display: flex; align-items: center; gap: 12px; }
      .study-mark {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; border-radius: 12px; flex: none;
        background: #17212B; border: 1px solid var(--dsw-alias-border-l1);
      }
      .study-headline h1 { margin: 0; font-size: 20px; line-height: 1.2; }
      .study-sub { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .study-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .study-select, .study-input, .study-textarea {
        font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; padding: 6px 9px;
      }
      .study-textarea { width: 100%; min-height: 112px; resize: vertical; line-height: 1.6; }
      .study-input:focus, .study-select:focus, .study-textarea:focus {
        outline: none; border-color: var(--dsw-alias-brand-primary);
      }
      .study-button {
        appearance: none; cursor: pointer; font: inherit; font-size: 12px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; padding: 6px 12px;
      }
      .study-button:hover { border-color: var(--dsw-alias-border-l2); }
      .study-button:disabled { opacity: 0.55; cursor: default; }
      .study-button.primary {
        color: var(--dsw-alias-bg-base);
        background: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      .study-tabs {
        display: flex; gap: 4px; margin-bottom: 18px; flex-wrap: wrap;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .study-tab {
        appearance: none; cursor: pointer; font: inherit; font-size: 13px;
        color: var(--dsw-alias-label-secondary); background: none; border: 0;
        padding: 8px 12px; border-bottom: 2px solid transparent; margin-bottom: -1px;
      }
      .study-tab[aria-selected='true'] {
        color: var(--dsw-alias-label-primary);
        border-bottom-color: var(--dsw-alias-brand-primary);
      }
      .study-grid {
        display: grid; gap: 16px;
        grid-template-columns: minmax(0, 1.45fr) minmax(260px, 1fr);
        align-items: start;
      }
      @media (max-width: 900px) { .study-grid { grid-template-columns: minmax(0, 1fr); } }
      .study-stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
      .study-card {
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px; overflow: hidden;
      }
      .study-card-head {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .study-card-title {
        font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
        text-transform: uppercase; color: var(--dsw-alias-label-secondary);
      }
      .study-card-body { padding: 14px; }
      .study-topic { margin: 0 0 4px; font-size: 17px; line-height: 1.3; overflow-wrap: anywhere; }
      .study-goal { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .study-rows { display: grid; gap: 0; margin: 0; }
      .study-row {
        display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px;
        padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .study-row:first-child { border-top: 0; }
      .study-row dt { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .study-row dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
      .study-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-2); white-space: nowrap;
      }
      .study-pill.ok { color: var(--dsw-alias-state-success-primary); }
      .study-pill.warn { color: var(--dsw-alias-state-warn-primary); }
      .study-pill.bad { color: var(--dsw-alias-state-error-primary); }
      .study-bar {
        position: relative; height: 8px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
      }
      .study-bar > i {
        position: absolute; inset: 0 auto 0 0; display: block;
        background: var(--dsw-alias-brand-primary); border-radius: 999px;
      }
      .study-bar.thin { height: 6px; }
      .study-progress-line {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 10px; margin-bottom: 8px;
      }
      .study-progress-line strong { font-size: 15px; }
      .study-muted { color: var(--dsw-alias-label-secondary); }
      .study-stats {
        display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        margin-top: 14px;
      }
      .study-stat {
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        padding: 9px 11px; background: var(--dsw-alias-bg-layer-2);
      }
      .study-stat b { display: block; font-size: 15px; line-height: 1.3; }
      .study-stat span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .study-list { display: flex; flex-direction: column; }
      .study-list-row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 9px 14px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px;
      }
      .study-list-row:first-child { border-top: 0; }
      .study-level {
        display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px;
        padding: 12px 14px; border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .study-level:first-child { border-top: 0; }
      .study-level-badge {
        width: 28px; height: 28px; border-radius: 9px; display: inline-flex;
        align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
        border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .study-level.current .study-level-badge {
        color: var(--dsw-alias-bg-base);
        background: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      .study-level h3 { margin: 0 0 2px; font-size: 13px; }
      .study-level dl { margin: 6px 0 0; display: grid; gap: 4px; }
      .study-level dl > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; }
      .study-level dt { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .study-level dd { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
      .study-unit {
        display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px;
        padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1);
        align-items: start;
      }
      .study-unit:first-child { border-top: 0; }
      .study-unit.next { background: var(--dsw-alias-bg-layer-2); }
      .study-unit-mark {
        width: 20px; height: 20px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2);
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 1px;
      }
      .study-unit.is-done .study-unit-mark {
        background: var(--dsw-alias-state-success-primary);
        border-color: var(--dsw-alias-state-success-primary);
        color: var(--dsw-alias-bg-base);
      }
      .study-unit h4 { margin: 0; font-size: 13px; }
      .study-unit p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; }
      .study-question {
        white-space: pre-wrap; overflow-wrap: anywhere;
        margin: 0; padding: 12px 14px; border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        font-size: 14px; line-height: 1.7;
      }
      .study-banner {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 10px 12px; border-radius: 10px; margin-top: 12px; flex-wrap: wrap;
        border: 1px solid var(--dsw-alias-state-success-primary);
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .study-banner b { display: block; font-size: 13px; }
      .study-banner span { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .study-banner.error { border-color: var(--dsw-alias-state-error-primary); }
      .study-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; flex-wrap: wrap; }
      .study-field { display: grid; gap: 5px; margin-bottom: 12px; }
      .study-field label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .study-field-row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
      .study-empty {
        padding: 26px 20px; display: flex; flex-direction: column; align-items: center;
        gap: 6px; text-align: center;
      }
      .study-empty strong { font-size: 14px; }
      .study-empty span { color: var(--dsw-alias-label-secondary); max-width: 520px; }
      .study-score-row {
        display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 12px;
        padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1); align-items: center;
      }
      .study-score-row:first-child { border-top: 0; }
      .study-score-row h4 { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
      .study-score-row p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; }
      .study-score-value { text-align: right; font-size: 12px; }
      .study-cards { display: grid; gap: 14px; }
      .study-method-card { padding: 14px; }
      .study-method-head { display: flex; align-items: flex-start; gap: 12px; }
      .study-method-step {
        width: 30px; height: 30px; border-radius: 10px; flex: none;
        display: inline-flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 13px;
        color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary);
      }
      .study-method-head h3 { margin: 0; font-size: 14px; }
      .study-method-head p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .study-method-card ul { margin: 10px 0 0; padding-left: 18px; }
      .study-method-card li { margin: 3px 0; }
      .study-prompt {
        margin: 10px 0 0; padding: 12px; border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
        white-space: pre-wrap; overflow-wrap: anywhere;
        font-family: inherit; font-size: 12px; line-height: 1.65; max-height: 260px; overflow: auto;
      }
      .study-pitfall {
        margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 12px;
        border: 1px dashed var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-secondary);
      }
      .study-dock {
        display: flex; align-items: center; gap: 7px;
        margin: 6px auto 0; padding: 4px 11px; max-width: 100%;
        font: inherit; font-size: 11px; line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px; cursor: pointer;
      }
      .study-dock:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-border-l2);
      }
      .study-dock-mark { display: inline-flex; color: var(--dsw-alias-brand-primary); }
      .study-dock-topic {
        color: var(--dsw-alias-label-primary); font-weight: 600;
        max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .study-dock-sep { opacity: 0.5; }
      .study-dock-meta, .study-dock-status { white-space: nowrap; }
      .study-dock-pill {
        padding: 0 7px; border-radius: 999px; font-size: 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-state-warn-primary);
        background: var(--dsw-alias-bg-layer-2);
        white-space: nowrap;
      }
      .study-lesson-grid {
        display: grid; gap: 16px;
        grid-template-columns: minmax(260px, 0.85fr) minmax(0, 1.4fr);
        align-items: start;
      }
      @media (max-width: 980px) { .study-lesson-grid { grid-template-columns: minmax(0, 1fr); } }
      .study-lesson-row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 9px 14px; border-top: 1px solid var(--dsw-alias-border-l1);
        font-size: 12px; cursor: pointer; background: none; border-left: 0; border-right: 0; border-bottom: 0; width: 100%;
        text-align: left; color: inherit; font-family: inherit;
      }
      .study-lesson-row:first-child { border-top: 0; }
      .study-lesson-row[aria-current='true'] { background: var(--dsw-alias-bg-layer-2); }
      .study-lesson-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .study-caps { display: flex; flex-wrap: wrap; gap: 6px; }
      .study-cap {
        font-size: 10px; padding: 1px 7px; border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
      }
      .study-cap.ok { color: var(--dsw-alias-state-success-primary); }
      .study-cap.bad { color: var(--dsw-alias-state-error-primary); }
      .study-cap.warn { color: var(--dsw-alias-state-warn-primary); }
      .study-mark-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .study-note-card { border-top: 1px solid var(--dsw-alias-border-l1); padding: 12px 14px; }
      .study-note-card:first-child { border-top: 0; }
      .study-note-card h4 { margin: 0 0 8px; font-size: 13px; }
      .study-note-field { margin: 6px 0 0; }
      .study-note-label { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-right: 6px; }
      .study-note-split { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 10px; }
      .study-note-pane {
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        padding: 9px 11px; background: var(--dsw-alias-bg-layer-2);
      }
      .study-note-pane h5 { margin: 0 0 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); font-weight: 600; }
      .study-note-pane p { margin: 3px 0; font-size: 12px; }
      .study-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .study-chip {
        font-size: 11px; padding: 1px 8px; border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);
      }
      .study-section-card { border-top: 1px solid var(--dsw-alias-border-l1); padding: 12px 14px; }
      .study-section-card:first-child { border-top: 0; }
      .study-section-card h4 { margin: 0 0 4px; font-size: 13px; }
      .study-block { margin: 7px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; }
      .study-block.question { border-left: 3px solid var(--dsw-alias-brand-primary); }
      .study-block.formula { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .study-trace-card { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
      .study-note {
        margin-top: 16px; padding: 10px 14px; border-radius: 10px;
        border: 1px dashed var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-secondary); font-size: 12px;
      }
    `

    const FALLBACK_LANG = (() => {
      try {
        return String(window.navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    })()
    const FALLBACK_DICT = FALLBACK_LANG === 'zh' ? ZH : EN

    function interpolate(template, vars) {
      if (vars === undefined) return template
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
    }

    function fallbackTranslate(key, vars) {
      return interpolate(FALLBACK_DICT[key] ?? EN[key] ?? key, vars)
    }

    function langOf(ctx) {
      try {
        const snapshot = ctx.locale.getSnapshot()
        const id = snapshot === null || snapshot === undefined ? '' : String(snapshot.locale ?? snapshot.id ?? '')
        return id.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return FALLBACK_LANG
      }
    }

    async function getJson(path) {
      const response = await fetch(path, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body === null || body.ok !== true) {
        throw new Error(body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
      }
      return body
    }

    async function postJson(path, payload) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => null)
      if (body === null) throw new Error(`HTTP ${response.status}`)
      return { ok: response.ok && body.ok === true, status: response.status, body }
    }

    function formatTime(iso) {
      if (typeof iso !== 'string' || iso === '') return '—'
      try {
        return new Date(iso).toLocaleString(FALLBACK_LANG === 'zh' ? 'zh-CN' : 'en-US', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      } catch {
        return iso
      }
    }

    function scoreTone(score, max) {
      const ratio = max > 0 ? score / max : 0
      if (ratio >= 0.8) return 'ok'
      if (ratio >= 0.5) return 'warn'
      return 'bad'
    }

    function StatusPill({ status, t }) {
      const key = status === 'done' ? 'statusDone' : status === 'paused' ? 'statusPaused' : 'statusActive'
      const tone = status === 'done' ? 'ok' : status === 'paused' ? 'warn' : ''
      return h('span', { className: 'study-pill ' + tone }, t(key))
    }

    function EmptyState({ title, hint, children }) {
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-empty' },
          h('strong', null, title),
          hint === undefined ? null : h('span', null, hint),
          children ?? null,
        ),
      )
    }

    function NewSubjectForm({ t, onCreated }) {
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const [form, setForm] = React.useState({ topic: '', goal: '', deadline: '', budgetHours: 20, baseline: '' })

      const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

      const submit = async () => {
        if (busy || form.topic.trim() === '') return
        setBusy(true)
        setFailure(null)
        try {
          const result = await postJson(SUBJECTS_ROUTE, {
            topic: form.topic.trim(),
            goal: form.goal.trim(),
            deadline: form.deadline.trim(),
            budgetHours: Number(form.budgetHours) || 20,
            baseline: form.baseline.trim(),
          })
          if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`)
          setForm({ topic: '', goal: '', deadline: '', budgetHours: 20, baseline: '' })
          setOpen(false)
          onCreated()
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      if (!open) {
        return h('div', null,
          h('button', { className: 'study-button primary', type: 'button', onClick: () => setOpen(true) }, t('newSubject')),
        )
      }

      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('newSubject'))),
        h('div', { className: 'study-card-body' },
          h('div', { className: 'study-field' },
            h('label', { htmlFor: 'study-topic' }, t('topic')),
            h('input', {
              id: 'study-topic', className: 'study-input', value: form.topic,
              placeholder: t('topicPlaceholder'), onChange: update('topic'),
            }),
          ),
          h('div', { className: 'study-field' },
            h('label', { htmlFor: 'study-goal' }, t('goal')),
            h('input', {
              id: 'study-goal', className: 'study-input', value: form.goal,
              placeholder: t('goalPlaceholder'), onChange: update('goal'),
            }),
          ),
          h('div', { className: 'study-field-row' },
            h('div', { className: 'study-field' },
              h('label', { htmlFor: 'study-deadline' }, t('deadline')),
              h('input', {
                id: 'study-deadline', className: 'study-input', type: 'date',
                value: form.deadline, onChange: update('deadline'),
              }),
            ),
            h('div', { className: 'study-field' },
              h('label', { htmlFor: 'study-budget' }, t('budget')),
              h('input', {
                id: 'study-budget', className: 'study-input', type: 'number', min: '0.5', step: '0.5',
                value: form.budgetHours, onChange: update('budgetHours'),
              }),
            ),
          ),
          h('div', { className: 'study-field' },
            h('label', { htmlFor: 'study-baseline' }, t('baseline')),
            h('input', {
              id: 'study-baseline', className: 'study-input', value: form.baseline,
              placeholder: t('baselinePlaceholder'), onChange: update('baseline'),
            }),
          ),
          failure === null ? null : h('div', { className: 'study-banner error' }, h('span', null, t('createFailed') + ' ' + failure)),
          h('div', { className: 'study-actions' },
            h('button', { className: 'study-button', type: 'button', onClick: () => setOpen(false), disabled: busy }, t('cancel')),
            h('button', {
              className: 'study-button primary', type: 'button', onClick: submit,
              disabled: busy || form.topic.trim() === '',
            }, busy ? t('creating') : t('create')),
          ),
        ),
      )
    }

    function SubjectHeadCard({ subject, derived, t }) {
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-body' },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } },
            h('h2', { className: 'study-topic' }, subject.topic),
            h(StatusPill, { status: subject.status, t }),
          ),
          subject.goal === '' ? null : h('p', { className: 'study-goal' }, subject.goal),
          h('dl', { className: 'study-rows' },
            h('div', { className: 'study-row' }, h('dt', null, t('deadline')), h('dd', null, subject.deadline === '' ? '—' : subject.deadline)),
            h('div', { className: 'study-row' }, h('dt', null, t('budget')), h('dd', null, t('hours', { hours: subject.budgetHours }))),
            h('div', { className: 'study-row' }, h('dt', null, t('level')), h('dd', null, derived.currentLevelName ?? t('notAssessed'))),
            subject.baseline === '' ? null : h('div', { className: 'study-row' }, h('dt', null, t('baseline')), h('dd', null, subject.baseline)),
          ),
        ),
      )
    }

    function ProgressCard({ derived, subject, t }) {
      const pct = Math.max(0, Math.min(100, derived.progressPct))
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' },
          h('span', { className: 'study-card-title' }, t('progress')),
          h('span', { className: 'study-muted' }, t('unitsDone', { done: derived.unitsDone, total: derived.unitsTotal })),
        ),
        h('div', { className: 'study-card-body' },
          h('div', { className: 'study-progress-line' }, h('strong', null, `${pct}%`), h('span', { className: 'study-muted' }, t('minutesDone', { minutes: derived.minutesDone }))),
          h('div', { className: 'study-bar' }, h('i', { style: { width: `${pct}%` } })),
          h('div', { className: 'study-stats' },
            h('div', { className: 'study-stat' }, h('b', null, String(derived.currentLevelName ?? '—')), h('span', null, t('level'))),
            h('div', { className: 'study-stat' }, h('b', null, subject.stats.avgScore === null ? '—' : String(subject.stats.avgScore)), h('span', null, t('avgScore'))),
            h('div', { className: 'study-stat' }, h('b', null, String(subject.stats.examRounds)), h('span', null, t('tabExam'))),
            h('div', { className: 'study-stat' },
              h('b', null, `${derived.mastery.independentUnits} / ${derived.mastery.totalUnits}`),
              h('span', null, t('masteryStat')),
            ),
          ),
        ),
      )
    }

    function NextTaskCard({ derived, t }) {
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('nextTask'))),
        h('div', { className: 'study-card-body' },
          derived.nextUnit === null
            ? h('p', { style: { margin: 0 }, className: 'study-muted' }, t('allUnitsDone'))
            : h('div', null,
                h('strong', { style: { display: 'block', fontSize: '14px' } }, `${derived.nextUnit.index}. ${derived.nextUnit.title}`),
                h('span', { className: 'study-muted' }, t('hours', { hours: derived.nextUnit.hours })),
                h('p', { style: { margin: '8px 0 0' }, className: 'study-muted' }, t('nextTaskHint', { index: derived.nextUnit.index })),
              ),
        ),
      )
    }

    function ReviewsCard({ derived, t }) {
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('dueReviews'))),
        derived.dueReviews.length === 0
          ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('noReviews')))
          : h('div', { className: 'study-list' },
              derived.dueReviews.map((review) => h('div', { key: review.due, className: 'study-list-row' },
                h('span', null, review.due),
                review.overdue
                  ? h('span', { className: 'study-pill bad' }, t('overdue'))
                  : h('span', { className: 'study-pill' }, `#${review.stage}`),
              )),
            ),
      )
    }

    function RecentScoresCard({ subject, t }) {
      const entries = [...subject.gapLog].slice(-3).reverse()
      return h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('recentScores'))),
        entries.length === 0
          ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('noScores')))
          : h('div', null, entries.map((entry) => h('div', { key: entry.id, className: 'study-score-row' },
              h('div', null,
                h('h4', null, entry.concept === '' ? entry.question : entry.concept),
                h('p', null, entry.gap === '' ? t('noGap') : entry.gap),
              ),
              h('div', { className: 'study-score-value' },
                h('div', null, `${entry.score} / ${entry.max}`),
                h('div', { className: 'study-bar thin', style: { marginTop: '6px' } },
                  h('i', { style: { width: `${(entry.score / Math.max(1, entry.max)) * 100}%` } }),
                ),
              ),
            ))),
      )
    }

    function OverviewTab({ state, t, onChanged }) {
      const active = state.active
      if (active === null) {
        return h('div', { className: 'study-grid' },
          h('div', { className: 'study-stack' },
            h(EmptyState, { title: t('emptyTitle'), hint: t('emptyHint') }),
          ),
          h('div', { className: 'study-stack' },
            h(NewSubjectForm, { t, onCreated: onChanged }),
          ),
        )
      }
      const subject = active.subject
      const derived = active.derived
      return h('div', { className: 'study-grid' },
        h('div', { className: 'study-stack' },
          h(SubjectHeadCard, { subject, derived, t }),
          h(ProgressCard, { subject, derived, t }),
          h(NextTaskCard, { derived, t }),
        ),
        h('div', { className: 'study-stack' },
          h(ReviewsCard, { derived, t }),
          h(RecentScoresCard, { subject, t }),
          h(NewSubjectForm, { t, onCreated: onChanged }),
        ),
      )
    }

    function masteryBadges(subject, unitIndex, t) {
      const entry = (subject.unitMastery ?? []).find((item) => item.unitIndex === unitIndex)
      if (entry === undefined) return null
      const badges = []
      if (entry.independentPassAt !== null && entry.independentPassAt !== undefined) {
        badges.push(h('span', { key: 'ind', className: 'study-pill ok' }, t('masteryIndependent')))
      }
      if (entry.reviewPassAt !== null && entry.reviewPassAt !== undefined) {
        badges.push(h('span', { key: 'rev', className: 'study-pill ok' }, t('masteryReviewed')))
      }
      if (entry.promptedOnlyAt !== null && entry.promptedOnlyAt !== undefined && badges.length === 0) {
        badges.push(h('span', { key: 'pro', className: 'study-pill warn' }, t('masteryPrompted')))
      }
      return badges
    }

    function LadderTab({ state, t }) {
      const active = state.active
      if (active === null) return h(EmptyState, { title: t('emptyTitle'), hint: t('emptyHint') })
      const subject = active.subject
      const levels = subject.ladder.levels
      const units = subject.plan.units
      return h('div', { className: 'study-grid' },
        h('div', { className: 'study-stack' },
          h('div', { className: 'study-card' },
            h('div', { className: 'study-card-head' },
              h('span', { className: 'study-card-title' }, t('ladderCurrent')),
              h('span', { className: 'study-muted' }, `${subject.ladder.current} / ${levels.length || 5}`),
            ),
            levels.length === 0
              ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('ladderEmpty')))
              : h('div', null, levels.map((level) => h('div', {
                  key: level.index,
                  className: 'study-level' + (level.index === subject.ladder.current ? ' current' : ''),
                },
                  h('span', { className: 'study-level-badge' }, String(level.index)),
                  h('div', null,
                    h('h3', null, level.name, level.index === subject.ladder.current
                      ? h('span', { className: 'study-pill ok', style: { marginLeft: '8px' } }, t('ladderCurrent'))
                      : null),
                    h('dl', null,
                      level.understand === '' ? null : h('div', null, h('dt', null, t('understand')), h('dd', null, level.understand)),
                      level.mastery === '' ? null : h('div', null, h('dt', null, t('mastery')), h('dd', null, level.mastery)),
                      level.milestone === '' ? null : h('div', null, h('dt', null, t('milestone')), h('dd', null, level.milestone)),
                      level.selfTest === '' ? null : h('div', null, h('dt', null, t('selfTest')), h('dd', null, level.selfTest)),
                    ),
                  ),
                ))),
          ),
        ),
        h('div', { className: 'study-stack' },
          h('div', { className: 'study-card' },
            h('div', { className: 'study-card-head' },
              h('span', { className: 'study-card-title' }, t('plan')),
              h('span', { className: 'study-muted' }, t('unitsDone', { done: active.derived.unitsDone, total: active.derived.unitsTotal })),
            ),
            units.length === 0
              ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('planEmpty')))
              : h('div', null, units.map((unit) => h('div', {
                  key: unit.index,
                  className: 'study-unit' + (unit.done ? ' is-done' : '') + (active.derived.nextUnit !== null && active.derived.nextUnit.index === unit.index ? ' next' : ''),
                },
                  h('span', { className: 'study-unit-mark' }, unit.done ? '✓' : ''),
                  h('div', null,
                    h('h4', null, `${unit.index}. ${unit.title}`),
                    unit.deliverable === '' ? null : h('p', null, `${t('milestone')}: ${unit.deliverable}`),
                    unit.pass === '' ? null : h('p', null, `${t('selfTest')}: ${unit.pass}`),
                  ),
                  h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                    h('span', { className: 'study-pill' }, t('hours', { hours: unit.hours })),
                    masteryBadges(active.subject, unit.index, t),
                  ),
                ))),
          ),
        ),
      )
    }

function ExamTab({ state, t, onChanged, services }) {
      const active = state.active
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const [phase, setPhase] = React.useState(null) // null | 'saved' | 'sending' | 'sent'
      const [sendFailure, setSendFailure] = React.useState(null)

      if (active === null) return h(EmptyState, { title: t('emptyTitle'), hint: t('emptyHint') })

      const subject = active.subject
      const pending = active.pendingExam
      const sessionId = subject.mainSessionId ?? null

      const sendContinue = async (targetSessionId) => {
        if (services === undefined || services.sessions === undefined || services.uiWorkspace === undefined) {
          throw new Error(t('servicesUnavailable'))
        }
        const reference = services.sessions.retain(targetSessionId, { source: 'controllerOperation' })
        try {
          await reference.ready
          const result = await reference.binding.session.prompt([{ type: 'text', text: CONTINUE_TEXT }], 'queue')
          if (result === null || result.ok !== true) {
            throw new Error(result !== null && result.error !== undefined ? result.error.message : t('sendFailed'))
          }
          services.uiWorkspace.openSession(targetSessionId)
        } finally {
          reference.release()
        }
      }

      const submit = async () => {
        if (busy || draft.trim() === '' || pending === null) return
        setBusy(true)
        setFailure(null)
        setSendFailure(null)
        try {
          const result = await postJson(ANSWER_ROUTE, {
            subjectId: subject.id,
            questionId: pending.questionId,
            answer: draft.trim(),
          })
          if (!result.ok) {
            await onChanged()
            throw new Error(result.body.error ?? `HTTP ${result.status}`)
          }
          setDraft('')
          await onChanged()
          if (sessionId === null) {
            setPhase('saved')
            return
          }
          setPhase('sending')
          try {
            await sendContinue(sessionId)
            setPhase('sent')
          } catch (error) {
            setSendFailure(error instanceof Error ? error.message : String(error))
            setPhase('saved')
          }
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      const retrySend = async () => {
        if (sessionId === null) return
        setSendFailure(null)
        setPhase('sending')
        try {
          await sendContinue(sessionId)
          setPhase('sent')
        } catch (error) {
          setSendFailure(error instanceof Error ? error.message : String(error))
          setPhase('saved')
        }
      }

      const banner = phase === null
        ? null
        : phase === 'sending'
          ? h('div', { className: 'study-banner' }, h('b', null, t('examSending')), h('span', null, t('examSendingHint')))
          : phase === 'sent'
            ? h('div', { className: 'study-banner' }, h('div', null, h('b', null, t('examSent')), h('span', null, t('examSentHint'))))
            : h('div', { className: 'study-banner' },
                h('div', null,
                  h('b', null, sessionId === null ? t('examSavedNoSession') : t('examSaved')),
                  h('span', null, sessionId === null ? t('examSavedNoSessionHint') : t('examSavedHint')),
                ),
                sessionId === null ? null : h('button', { className: 'study-button', type: 'button', onClick: retrySend }, t('retrySend')),
              )

      const masteryOf = (unitIndex) => (subject.unitMastery ?? []).find((entry) => entry.unitIndex === unitIndex) ?? null

      return h('div', { className: 'study-grid' },
        h('div', { className: 'study-stack' },
          h('div', { className: 'study-card' },
            h('div', { className: 'study-card-head' },
              h('span', { className: 'study-card-title' }, t('tabExam')),
              pending === null
                ? null
                : h('span', { className: 'study-pill ' + (pending.status === 'awaiting_grade' ? 'warn' : '') },
                    pending.status === 'awaiting_grade' ? t('examAwaitingGrade') : t('examAwaitingAnswer')),
            ),
            pending === null
              ? h('div', { className: 'study-empty' }, h('strong', null, t('examEmptyTitle')), h('span', null, t('examEmptyHint')))
              : h('div', { className: 'study-card-body' },
                  pending.level > 0 ? h('div', { style: { marginBottom: '8px' } }, h('span', { className: 'study-pill' }, t('examLevel', { level: pending.level }))) : null,
                  pending.concept === '' ? null : h('div', { className: 'study-muted', style: { marginBottom: '6px' } }, pending.concept),
                  h('pre', { className: 'study-question' }, pending.question),
                  sessionId === null
                    ? h('p', { className: 'study-muted', style: { marginTop: '10px' } }, t('sessionUnboundHint'))
                    : h('p', { className: 'study-muted', style: { marginTop: '10px' } }, t('sessionBoundHint')),
                  pending.status === 'awaiting_answer'
                    ? h('div', { style: { marginTop: '12px' } },
                        h('div', { className: 'study-field' },
                          h('label', { htmlFor: 'study-answer' }, t('examAnswerLabel')),
                          h('textarea', {
                            id: 'study-answer', className: 'study-textarea', value: draft,
                            placeholder: t('examAnswerPlaceholder'),
                            onChange: (event) => setDraft(event.target.value),
                          }),
                        ),
                        h('div', { className: 'study-actions' },
                          h('button', {
                            className: 'study-button primary', type: 'button', onClick: submit,
                            disabled: busy || draft.trim() === '',
                          }, busy ? t('examSubmitting') : t('examSubmitAndContinue')),
                        ),
                      )
                    : h('div', null,
                        h('div', { style: { marginTop: '12px' } },
                          h('div', { className: 'study-muted' }, t('examAnswerLabel')),
                          h('pre', { className: 'study-question', style: { marginTop: '4px' } }, pending.answer === '' ? '—' : pending.answer),
                        ),
                      ),
                  banner,
                  sendFailure === null ? null : h('div', { className: 'study-banner error' },
                    h('div', null, h('b', null, t('sendFailed')), h('span', null, sendFailure)),
                    sessionId === null ? null : h('button', { className: 'study-button', type: 'button', onClick: retrySend }, t('retrySend')),
                  ),
                  failure === null ? null : h('div', { className: 'study-banner error' }, h('span', null, `${t('submitFailed')} ${failure}`)),
                ),
          ),
        ),
        h('div', { className: 'study-stack' },
          h('div', { className: 'study-card' },
            h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('gradedTitle'))),
            subject.gapLog.length === 0
              ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('noScores')))
              : h('div', null, [...subject.gapLog].slice(-6).reverse().map((entry) => h('div', { key: entry.id, className: 'study-score-row' },
                  h('div', null,
                    h('h4', null, entry.concept === '' ? entry.question : entry.concept),
                    h('p', null, `${t('gap')}: ${entry.gap === '' ? t('noGap') : entry.gap}`),
                    entry.items !== undefined && entry.items.length > 0
                      ? h('p', null, entry.items.map((item) => `${item.label} ${item.score}/${item.max}`).join(' · '))
                      : null,
                    entry.source === '' ? null : h('p', null, `${t('source')}: ${entry.source}`),
                    h('p', null, entry.independent === null || entry.independent === undefined
                      ? (entry.level > 0 ? t('examLevel', { level: entry.level }) : '')
                      : (entry.independent ? t('independent') : t('prompted'))),
                    typeof onTrace === 'function' && (entry.concept !== '' || entry.question !== '')
                      ? h('button', {
                          className: 'study-button', type: 'button', style: { marginTop: '6px' },
                          onClick: () => onTrace(entry.concept !== '' ? entry.concept : entry.question),
                        }, t('traceButton'))
                      : null,
                  ),
                  h('div', { className: 'study-score-value' },
                    h('span', { className: 'study-pill ' + scoreTone(entry.score, entry.max) }, `${entry.score} / ${entry.max}`),
                    h('div', { className: 'study-bar thin', style: { marginTop: '6px' } },
                      h('i', { style: { width: `${(entry.score / Math.max(1, entry.max)) * 100}%` } }),
                    ),
                  ),
                ))),
          ),
        ),
      )
    }


    function MethodTab({ method, t }) {
      const [copiedId, setCopiedId] = React.useState(null)
      const copy = async (card) => {
        try {
          await window.navigator.clipboard.writeText(card.prompt)
          setCopiedId(card.id)
          window.setTimeout(() => setCopiedId(null), 2000)
        } catch {
          setCopiedId('__failed__')
        }
      }
      if (method === null) return h(EmptyState, { title: t('methodCards'), hint: t('loading') })
      return h('div', { className: 'study-stack' },
        h('div', { className: 'study-card' },
          h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('methodPrinciples'))),
          h('div', { className: 'study-card-body' },
            h('ul', { style: { margin: 0, paddingLeft: '18px' } },
              method.principles.map((line, index) => h('li', { key: index, style: { margin: '4px 0' } }, line)),
            ),
          ),
        ),
        h('div', { className: 'study-cards' }, method.cards.map((card) => h('div', { className: 'study-card', key: card.id },
          h('div', { className: 'study-card-body study-method-card' },
            h('div', { className: 'study-method-head' },
              h('span', { className: 'study-method-step' }, String(card.step)),
              h('div', null,
                h('h3', null, card.title),
                h('p', null, card.tagline),
              ),
            ),
            h('p', { className: 'study-muted', style: { margin: '10px 0 0' } }, `${t('whenToUse')}：${card.when}`),
            h('ul', null, card.body.map((line, index) => h('li', { key: index }, line))),
            h('pre', { className: 'study-prompt' }, card.prompt),
            h('div', { className: 'study-actions' },
              h('button', { className: 'study-button', type: 'button', onClick: () => copy(card) },
                copiedId === card.id ? t('copied') : copiedId === '__failed__' ? t('copyFailed') : t('copyPrompt')),
            ),
            h('div', { className: 'study-pitfall' }, `${t('pitfall')}：${card.pitfall}`),
          ),
        ))),
        h('div', { className: 'study-note' }, t('methodFooter')),
      )
    }


    function formatSec(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
      const whole = Math.max(0, Math.round(seconds))
      return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
    }

    function capTone(value) {
      if (value === 'available') return 'ok'
      if (value === 'unavailable') return 'bad'
      return 'warn'
    }

    function playbackLabel(lesson, t) {
      const status = lesson.playback.status
      if (status === 'playing') return t('lessonPlaying')
      if (status === 'paused') return t('lessonPaused')
      return t('lessonUnknown')
    }

    function anchorLabel(anchor, t) {
      if (anchor.kind === 'slide' && anchor.page !== null && anchor.page !== undefined) {
        return t('anchorSlide', { page: anchor.page })
      }
      if (anchor.kind === 'media') {
        if (anchor.startSec !== null && anchor.startSec !== undefined) {
          return t('anchorMedia', {
            start: formatSec(anchor.startSec),
            end: anchor.endSec === null || anchor.endSec === undefined ? '…' : formatSec(anchor.endSec),
          })
        }
        if (anchor.observedClock !== '') return t('anchorClock', { clock: anchor.observedClock })
        return t('anchorMedia', { start: '—', end: '—' })
      }
      if (anchor.kind === 'note') return t('anchorNote')
      return anchor.label === '' ? t('anchorMaterial') : anchor.label
    }

    const NOTE_FIELDS = [
      ['intuition', 'noteIntuition'],
      ['example', 'noteExample'],
      ['formula', 'noteFormula'],
      ['conditions', 'noteConditions'],
      ['pitfalls', 'notePitfalls'],
    ]

    function LessonsTab({ t, subjectId, traceQuery, onClearTrace }) {
      const [lessons, setLessons] = React.useState(null)
      const [selectedId, setSelectedId] = React.useState('')
      const [lesson, setLesson] = React.useState(null)
      const [prefs, setPrefs] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [banner, setBanner] = React.useState('')
      const [adapter, setAdapter] = React.useState(null)
      const [adapterBusy, setAdapterBusy] = React.useState(false)

      const loadAdapter = React.useCallback(async () => {
        try {
          const data = await getJson(ADAPTER_PROBE_ROUTE)
          setAdapter(data)
        } catch (error) {
          setAdapter({ ok: false, javascript: { allowed: false, error: error instanceof Error ? error.message : String(error) } })
        }
      }, [])

      React.useEffect(() => { loadAdapter() }, [loadAdapter])

      const syncNow = async () => {
        if (adapterBusy || selectedId === '') return
        setAdapterBusy(true)
        setBanner('')
        try {
          const result = await postJson(LESSON_SYNC_ROUTE, { lessonId: selectedId })
          if (!result.ok) {
            setBanner(`${t('syncFailed')}：${result.body.error ?? `HTTP ${result.status}`}`)
          } else {
            setBanner(`${t('syncOk')}：${result.body.message ?? ''}`)
            await loadLesson(selectedId)
            await loadLessons()
          }
          await loadAdapter()
        } catch (error) {
          setBanner(`${t('syncFailed')}：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setAdapterBusy(false)
        }
      }

      const control = async (action) => {
        if (adapterBusy) return
        setAdapterBusy(true)
        setBanner('')
        try {
          const result = await postJson(ADAPTER_CONTROL_ROUTE, { action })
          if (!result.ok) {
            setBanner(`${t('controlFailed')}：${result.body.error ?? `HTTP ${result.status}`}`)
          } else if (result.body.playback !== null) {
            setBanner(`${t('adapterObserved')}：${result.body.playback.status} @ ${result.body.playback.mediaOffsetSec === null ? '—' : formatSec(result.body.playback.mediaOffsetSec)}`)
          }
          await loadLesson(selectedId)
          await loadAdapter()
        } catch (error) {
          setBanner(`${t('controlFailed')}：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setAdapterBusy(false)
        }
      }

      const loadLessons = React.useCallback(async () => {
        if (subjectId === undefined || subjectId === '') { setLessons([]); return }
        try {
          const data = await getJson(`${LESSONS_ROUTE}?subjectId=${encodeURIComponent(subjectId)}`)
          setLessons(data.lessons ?? [])
          setFailure(null)
          setSelectedId((current) => {
            if (current !== '') return current
            const open = (data.lessons ?? []).find((item) => item.state === 'open')
            return open !== undefined ? open.id : (data.lessons ?? [])[0]?.id ?? ''
          })
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
          setLessons([])
        }
      }, [subjectId])

      React.useEffect(() => { loadLessons() }, [loadLessons])

      const loadLesson = React.useCallback(async (id) => {
        if (id === '') { setLesson(null); return }
        try {
          const data = await getJson(`${LESSON_ROUTE}?id=${encodeURIComponent(id)}`)
          setLesson(data.lesson)
          if (data.prefs !== undefined) setPrefs(data.prefs)
          setFailure(null)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [])

      React.useEffect(() => { loadLesson(selectedId) }, [selectedId, loadLesson])

      const mark = async (kind) => {
        if (busy || lesson === null) return
        setBusy(true)
        setFailure(null)
        try {
          const result = await postJson(LESSON_MARK_ROUTE, { lessonId: lesson.id, kind })
          if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`)
          setBanner(kind === 'think' ? t('lessonThinkBanner') : '')
          await loadLesson(lesson.id)
          await loadLessons()
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      if (lessons === null) return h(EmptyState, { title: t('tabLesson'), hint: t('loading') })
      if (lessons.length === 0) {
        return h(EmptyState, { title: t('lessonEmptyTitle'), hint: t('lessonEmptyHint') })
      }

      const activeLesson = lesson
      const order = prefs !== null && Array.isArray(prefs.order) ? prefs.order : ['intuition', 'visual', 'example', 'formula', 'conditions', 'pitfalls']
      const query = typeof traceQuery === 'string' ? traceQuery.trim().toLowerCase() : ''
      const anchorById = new Map()
      const noteList = activeLesson === null ? [] : activeLesson.notes
      const anchorList = activeLesson === null ? [] : activeLesson.anchors
      for (const anchor of anchorList) anchorById.set(anchor.id, anchor)

      const matchedNotes = query === '' ? [] : noteList.filter((note) => {
        const haystack = [note.title, note.intuition, note.example, note.formula, note.conditions, note.pitfalls, ...(note.tags ?? [])]
          .join(' ').toLowerCase()
        return haystack.includes(query)
      })
      const matchedAnchors = query === '' ? [] : anchorList.filter((anchor) => {
        if (anchor.label.toLowerCase().includes(query)) return true
        const knowledge = activeLesson.knowledge.find((item) => item.anchorIds.includes(anchor.id))
        return knowledge !== undefined && knowledge.name.toLowerCase().includes(query)
      })

      const lessonRows = lessons.map((item) => h('button', {
        key: item.id, type: 'button', className: 'study-lesson-row',
        'aria-current': item.id === selectedId ? 'true' : 'false',
        onClick: () => setSelectedId(item.id),
      },
        h('span', null, h('strong', { style: { display: 'block', fontSize: '12px' } }, item.title),
          h('span', { className: 'study-muted' },
            `${formatTime(item.startedAt)} · ${item.marks} 标记 · ${item.notes} 笔记${item.state === 'open' ? '' : ' · 已结束'}`)),
        h('span', { className: 'study-pill' }, item.playbackStatus === 'playing' ? t('lessonPlaying') : item.playbackStatus === 'paused' ? t('lessonPaused') : t('lessonUnknown')),
      ))

      const left = h('div', { className: 'study-stack' },
        h('div', { className: 'study-card' },
          h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('lessonList'))),
          h('div', null, lessonRows),
        ),
        activeLesson === null ? null : h('div', { className: 'study-card' },
          h('div', { className: 'study-card-head' },
            h('span', { className: 'study-card-title' }, t('lessonPlayback')),
            h('span', { className: 'study-pill ' + (activeLesson.playback.status === 'playing' ? 'ok' : activeLesson.playback.status === 'paused' ? 'warn' : '') }, playbackLabel(activeLesson, t)),
          ),
          h('div', { className: 'study-card-body' },
            h('dl', { className: 'study-rows' },
              h('div', { className: 'study-row' }, h('dt', null, t('lessonPlatform')), h('dd', null, activeLesson.courseId)),
              h('div', { className: 'study-row' }, h('dt', null, t('lessonOffset')),
                h('dd', null, activeLesson.playback.mediaOffsetSec === null ? t('lessonOffsetNone') : formatSec(activeLesson.playback.mediaOffsetSec))),
            ),
            h('p', { className: 'study-muted', style: { margin: '10px 0 6px' } }, t('lessonCapabilities')),
            h('div', { className: 'study-caps' },
              Object.entries(activeLesson.capabilities).map(([name, value]) => h('span', {
                key: name, className: 'study-cap ' + capTone(value),
              }, `${name}: ${value === 'available' ? t('capAvailable') : value === 'unavailable' ? t('capUnavailable') : t('capUnverified')}`)),
            ),
            h('div', { className: 'study-mark-actions' },
              h('button', { className: 'study-button', type: 'button', disabled: busy, onClick: () => mark('important') }, t('lessonMarkImportant')),
              h('button', { className: 'study-button', type: 'button', disabled: busy, onClick: () => mark('confused') }, t('lessonMarkConfused')),
              h('button', { className: 'study-button primary', type: 'button', disabled: busy, onClick: () => mark('think') }, t('lessonMarkThink')),
              h('button', { className: 'study-button', type: 'button', disabled: busy, onClick: () => mark('question') }, t('lessonMarkQuestion')),
            ),
            banner === '' ? null : h('div', { className: 'study-banner', style: { marginTop: '10px' } }, h('span', null, banner)),
            failure === null ? null : h('div', { className: 'study-banner error', style: { marginTop: '10px' } }, h('span', null, `${t('markFailed')} ${failure}`)),
            h('p', { className: 'study-muted', style: { margin: '10px 0 4px' } }, t('lessonMarks')),
            activeLesson.marks.length === 0
              ? h('span', { className: 'study-muted' }, t('lessonNoMarks'))
              : h('div', null, activeLesson.marks.map((item) => h('div', { key: item.id, style: { padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px' } },
                  h('span', { className: 'study-pill' }, item.kind),
                  item.text === '' ? null : h('span', { style: { marginLeft: '8px' } }, item.text),
                  item.mediaOffsetSec === null || item.mediaOffsetSec === undefined
                    ? (item.observedClock === '' ? null : h('span', { className: 'study-muted', style: { marginLeft: '8px' } }, item.observedClock))
                    : h('span', { className: 'study-muted', style: { marginLeft: '8px' } }, formatSec(item.mediaOffsetSec)),
                ))),
          ),
        ),
      )

      const adapterCard = h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' },
          h('span', { className: 'study-card-title' }, t('adapterTitle')),
          h('span', { className: 'study-pill ' + (adapter !== null && adapter.javascript !== undefined && adapter.javascript.allowed === true ? 'ok' : 'bad') },
            adapter === null ? t('loading') : adapter.javascript !== undefined && adapter.javascript.allowed === true ? t('adapterAllowed') : t('adapterBlocked')),
        ),
        h('div', { className: 'study-card-body' },
          adapter !== null && adapter.tab !== undefined && adapter.tab !== null
            ? h('p', { className: 'study-muted', style: { margin: '0 0 6px', overflowWrap: 'anywhere' } },
                `${t('adapterFront')}：${adapter.tab.platform} · ${String(adapter.tab.title ?? '').slice(0, 40)}`)
            : h('p', { className: 'study-muted', style: { margin: '0 0 6px' } }, t('adapterNoTab')),
          adapter !== null && adapter.media !== null && adapter.media !== undefined
            ? h('p', { className: 'study-muted', style: { margin: '0 0 6px' } },
                adapter.media.hasVideo === true ? t('adapterHasVideo') : t('adapterNoVideo'))
            : null,
          adapter !== null && adapter.javascript !== undefined && adapter.javascript.allowed !== true
            ? h('p', { className: 'study-muted', style: { margin: '0 0 8px' } }, t('adapterBlockedHint'))
            : null,
          h('div', { className: 'study-mark-actions', style: { marginTop: '4px' } },
            h('button', { className: 'study-button primary', type: 'button', disabled: adapterBusy || activeLesson === null, onClick: syncNow }, t('syncNow')),
            h('button', { className: 'study-button', type: 'button', disabled: adapterBusy, onClick: () => control('pause') }, t('pauseCourse')),
            h('button', { className: 'study-button', type: 'button', disabled: adapterBusy, onClick: () => control('play') }, t('resumeCourse')),
          ),
          h('p', { className: 'study-muted', style: { margin: '8px 0 0' } }, t('adapterUnverified')),
        ),
      )

      const traceCard = query === '' ? null : h('div', { className: 'study-trace-card' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
          h('strong', null, t('traceTitle')),
          h('button', { className: 'study-button', type: 'button', onClick: onClearTrace }, t('cancel')),
        ),
        h('p', { className: 'study-muted', style: { margin: '6px 0' } }, t('traceHint', { concept: traceQuery })),
        matchedAnchors.length === 0 && matchedNotes.length === 0
          ? h('p', { style: { margin: 0 } }, t('traceNone'))
          : h('div', null,
              matchedAnchors.map((anchor) => h('div', { key: anchor.id, style: { fontSize: '12px', padding: '3px 0' } },
                h('span', { className: 'study-chip' }, anchorLabel(anchor, t)),
                h('span', { className: 'study-muted', style: { marginLeft: '8px' } }, anchor.label),
              )),
              matchedNotes.map((note) => h('div', { key: note.id, style: { fontSize: '12px', padding: '3px 0' } },
                h('span', { className: 'study-chip' }, t('anchorNote')),
                h('span', { style: { marginLeft: '8px' } }, note.title),
              )),
            ),
      )

      const slideAnchors = activeLesson === null ? [] : activeLesson.anchors.filter((anchor) => anchor.kind === 'slide')
      const anchorsCard = h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' },
          h('span', { className: 'study-card-title' }, t('lessonAnchorsCard')),
          h('span', { className: 'study-muted' }, `${slideAnchors.length}`),
        ),
        slideAnchors.length === 0
          ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('lessonNoAnchors')))
          : h('div', null, slideAnchors.slice(0, 12).map((anchor) => h('div', { key: anchor.id, className: 'study-list-row' },
              h('span', null,
                h('strong', { style: { marginRight: '6px' } }, `P${anchor.page}`),
                h('span', { className: 'study-muted' }, anchor.observedClock)),
              h('span', { className: 'study-pill ' + (anchor.aligned ? 'ok' : '') },
                anchor.startSec === null || anchor.startSec === undefined
                  ? (anchor.aligned ? t('anchorAligned') : t('lessonUnknown'))
                  : `${formatSec(anchor.startSec)}–${anchor.endSec === null ? '…' : formatSec(anchor.endSec)} · ${anchor.aligned ? t('anchorAligned') : t('anchorInferred')}`),
            ))),
      )

      const notesCard = h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' },
          h('span', { className: 'study-card-title' }, t('lessonNotes')),
          h('span', { className: 'study-muted' }, `${noteList.length}`),
        ),
        noteList.length === 0
          ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('lessonNoNotes')))
          : h('div', null, noteList.map((note) => {
              const fields = ORDERED_FIELDS(order).filter(([field]) => typeof note[field] === 'string' && note[field] !== '')
              return h('div', { key: note.id, className: 'study-note-card' },
                h('h4', null, note.title,
                  note.status === 'user_edited' ? h('span', { className: 'study-pill', style: { marginLeft: '8px' } }, '已修改') : null),
                fields.map(([field, key]) => h('div', { key: field, className: 'study-note-field' },
                  h('span', { className: 'study-note-label' }, t(key)),
                  h('span', null, note[field]),
                )),
                (note.sourcePoints.length > 0 || note.generated.length > 0) ? h('div', { className: 'study-note-split' },
                  note.sourcePoints.length === 0 ? null : h('div', { className: 'study-note-pane' },
                    h('h5', null, t('noteSource')),
                    note.sourcePoints.map((line, index) => h('p', { key: index }, line)),
                  ),
                  note.generated.length === 0 ? null : h('div', { className: 'study-note-pane' },
                    h('h5', null, t('noteGenerated')),
                    note.generated.map((line, index) => h('p', { key: index }, line)),
                  ),
                ) : null,
                note.anchorIds.length === 0 ? null : h('div', { className: 'study-chip-row' },
                  h('span', { className: 'study-note-label' }, t('noteAnchors')),
                  note.anchorIds.map((id) => {
                    const anchor = anchorById.get(id)
                    return anchor === undefined ? null : h('span', { key: id, className: 'study-chip' }, anchorLabel(anchor, t))
                  }),
                ),
              )
            })),
      )

      const sectionsCard = h('div', { className: 'study-card' },
        h('div', { className: 'study-card-head' }, h('span', { className: 'study-card-title' }, t('lessonSections'))),
        activeLesson === null || activeLesson.sections.length === 0
          ? h('div', { className: 'study-card-body' }, h('span', { className: 'study-muted' }, t('lessonNoSections')))
          : h('div', null, activeLesson.sections.map((section) => h('div', { key: section.id, className: 'study-section-card' },
              h('h4', null, section.title,
                h('span', { className: 'study-pill warn', style: { marginLeft: '8px' } }, t('sectionGenerated'))),
              section.objective === '' ? null : h('p', { className: 'study-muted', style: { margin: '4px 0' } }, `${t('sectionObjective')}：${section.objective}`),
              section.prerequisites === '' ? null : h('p', { className: 'study-muted', style: { margin: '4px 0' } }, `${t('sectionPrerequisites')}：${section.prerequisites}`),
              section.blocks.map((block, index) => h('div', { key: index, className: 'study-block ' + block.kind }, block.body)),
            ))),
      )

      return h('div', { className: 'study-lesson-grid' },
        h('div', { className: 'study-stack' }, left, adapterCard),
        h('div', { className: 'study-stack' }, traceCard, anchorsCard, notesCard, sectionsCard),
      )
    }

    function ORDERED_FIELDS(order) {
      const map = new Map(NOTE_FIELDS)
      const fields = []
      for (const item of order) {
        if (item === 'visual') continue
        if (item === 'example') { fields.push(['example', 'noteExample']); continue }
        if (map.has(item)) fields.push([item, map.get(item)])
      }
      if (fields.length === 0) return NOTE_FIELDS
      return fields
    }

    function StudyDock(props) {
      const { sessionId, t, ctx, services } = props
      const [state, setState] = React.useState(null)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) return undefined
        let cancelled = false
        let timer = null
        const load = async () => {
          try {
            const next = await getJson(STATE_ROUTE)
            if (!cancelled) {
              setState(next)
              setFailed(false)
            }
          } catch {
            if (!cancelled) setFailed(true)
          }
        }
        load()
        timer = window.setInterval(load, 10000)
        return () => {
          cancelled = true
          if (timer !== null) window.clearInterval(timer)
        }
      }, [sessionId])

      if (state === null || failed) return null
      const subjects = state.subjects ?? []
      const subject = subjects.find((item) => item.mainSessionId === sessionId)
      if (subject === undefined) return null

      const openPanel = () => {
        try {
          if (services !== undefined && services.layout !== undefined) services.layout.selectPanel(PANEL_ID)
        } catch {
          // 面板不可用时保持静默：挂件本身只是入口。
        }
      }

      const status = subject.pendingStatus === 'awaiting_grade'
        ? t('dockAwaitingGrade')
        : subject.pendingStatus === 'awaiting_answer'
          ? t('dockAwaitingAnswer')
          : subject.nextUnitTitle !== '' && subject.nextUnitTitle !== undefined
            ? t('dockNextUnit', { title: subject.nextUnitTitle })
            : t('dockAllDone')

      return h('button', { type: 'button', className: 'study-dock', onClick: openPanel, title: t('dockOpenHint') },
        h('span', { className: 'study-dock-mark', 'aria-hidden': true },
          h('svg', { viewBox: '0 0 24 24', width: 13, height: 13 },
            h('path', { d: 'M4 6.6c2.6-.9 5.2-.8 7.6 1v9.6c-2.4-1.8-5-1.9-7.6-1z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
            h('path', { d: 'M20 6.6c-2.6-.9-5.2-.8-7.6 1v9.6c2.4-1.8 5-1.9 7.6-1z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
            h('path', { d: 'M6.8 2.6a8.2 8.2 0 0 1 10.4 0', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
          ),
        ),
        h('span', { className: 'study-dock-topic' }, subject.topic),
        h('span', { className: 'study-dock-sep' }, '·'),
        h('span', { className: 'study-dock-meta' }, t('dockUnits', { done: subject.unitsDone, total: subject.unitsTotal })),
        h('span', { className: 'study-dock-sep' }, '·'),
        h('span', { className: 'study-dock-status' }, status),
        subject.dueReviews > 0 ? h('span', { className: 'study-dock-pill' }, t('dockDue', { count: subject.dueReviews })) : null,
        subject.pendingStatus === 'awaiting_grade' ? h('span', { className: 'study-dock-pill' }, t('dockGradePill')) : null,
      )
    }

    function StudyPanel(props) {
      const lang = langOf(props.ctx)
      const t = typeof props.t === 'function' ? props.t : fallbackTranslate
      const services = props.services
      const [tab, setTab] = React.useState('overview')
      const [state, setState] = React.useState(null)
      const [method, setMethod] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [failure, setFailure] = React.useState(null)
      const [switching, setSwitching] = React.useState(false)
      const [traceQuery, setTraceQuery] = React.useState('')

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const [nextState, nextMethod] = await Promise.all([
            getJson(STATE_ROUTE),
            getJson(METHOD_ROUTE).catch(() => null),
          ])
          setState(nextState)
          if (nextMethod !== null) setMethod(nextMethod)
          setFailure(null)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const switchSubject = async (event) => {
        const subjectId = event.target.value
        if (subjectId === '' || switching) return
        setSwitching(true)
        try {
          const result = await postJson(ACTIVE_ROUTE, { subjectId })
          if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`)
          await load()
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setSwitching(false)
        }
      }

      const subjects = state === null ? [] : state.subjects
      const activeId = state !== null && state.active !== null ? state.active.subject.id : ''
      const tabs = [
        ['overview', t('tabOverview')],
        ['ladder', t('tabLadder')],
        ['exam', t('tabExam')],
        ['lesson', t('tabLesson')],
        ['method', t('tabMethod')],
      ]

      let body = null
      if (state === null) {
        body = failure === null
          ? h(EmptyState, { title: t('title'), hint: t('loading') })
          : h(EmptyState, { title: t('errorTitle'), hint: `${t('errorHint')} (${failure})` })
      } else if (tab === 'overview') {
        body = h(OverviewTab, { state, t, onChanged: load })
      } else if (tab === 'ladder') {
        body = h(LadderTab, { state, t })
      } else if (tab === 'exam') {
        body = h(ExamTab, {
          state, t, onChanged: load, services,
          onTrace: (concept) => { setTraceQuery(concept); setTab('lesson') },
        })
      } else if (tab === 'lesson') {
        body = h(LessonsTab, {
          t,
          subjectId: state !== null && state.active !== null ? state.active.subject.id : '',
          traceQuery,
          onClearTrace: () => setTraceQuery(''),
        })
      } else {
        body = h(MethodTab, { method, t })
      }

      return h('div', { className: 'study-panel' },
        h('div', { className: 'study-head' },
          h('div', { className: 'study-headline' },
            h('span', { className: 'study-mark', 'aria-hidden': true },
              h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
                h('path', { d: 'M4 6.4c2.6-.9 5.2-.8 7.6 1v9.4c-2.4-1.8-5-1.9-7.6-1z', fill: '#F3EDE3' }),
                h('path', { d: 'M20 6.4c-2.6-.9-5.2-.8-7.6 1v9.4c2.4-1.8 5-1.9 7.6-1z', fill: '#D8C8B2' }),
                h('path', { d: 'M6.4 2.6a8 8 0 0 1 11.2 0', fill: 'none', stroke: '#6FD3AE', strokeWidth: '1.8', strokeLinecap: 'round' }),
              ),
            ),
            h('div', null,
              h('h1', null, t('title')),
              h('p', { className: 'study-sub' }, t('subtitle')),
            ),
          ),
          h('div', { className: 'study-tools' },
            subjects.length === 0
              ? null
              : h('select', { className: 'study-select', value: activeId, onChange: switchSubject, disabled: switching, 'aria-label': t('subjects') },
                  subjects.map((subject) => h('option', { key: subject.id, value: subject.id }, `${subject.topic} · ${subject.progressPct}%`)),
                ),
            h('button', { className: 'study-button', type: 'button', onClick: load, disabled: loading }, t('refresh')),
            state === null ? null : h('span', { className: 'study-muted' }, t('updated', { time: formatTime(state.generatedAt) })),
          ),
        ),
        h('div', { className: 'study-tabs', role: 'tablist' },
          tabs.map(([id, label]) => h('button', {
            key: id, type: 'button', role: 'tab', className: 'study-tab',
            'aria-selected': tab === id ? 'true' : 'false',
            onClick: () => setTab(id),
          }, label)),
        ),
        failure !== null && state !== null
          ? h('div', { className: 'study-banner error', style: { marginBottom: '12px' } }, h('span', null, `${t('errorTitle')}：${failure}`))
          : null,
        body,
      )
    }

    function SidebarIcon({ size, active }) {
      const edge = Math.max(16, Math.round(size ?? 18))
      return h('svg', { viewBox: '0 0 24 24', width: edge, height: edge, 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M4 6.6c2.6-.9 5.2-.8 7.6 1v9.6c-2.4-1.8-5-1.9-7.6-1z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
          opacity: active === true ? 1 : 0.85,
        }),
        h('path', {
          d: 'M20 6.6c-2.6-.9-5.2-.8-7.6 1v9.6c2.4-1.8 5-1.9 7.6-1z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
          opacity: active === true ? 1 : 0.85,
        }),
        h('path', {
          d: 'M6.6 2.4a8.4 8.4 0 0 1 10.8 0',
          fill: 'none', stroke: active === true ? 'var(--dsw-alias-brand-primary)' : '#6FD3AE',
          strokeWidth: 1.8, strokeLinecap: 'round',
        }),
      )
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'study-companion: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = NS
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        }, 'study-companion: styles')

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'study-companion-dock',
          order: 50,
          label: () => t('title'),
          locale: NS,
        }, (props) => h(StudyDock, { ...props, t, ctx, services })))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t('title'),
          locale: NS,
        }, SidebarIcon))

        const services = { sessions: ctx.sessions, uiWorkspace: ctx.uiWorkspace, layout: ctx.layout }
        const Panel = (props) => h(StudyPanel, { ...props, ctx, t, services })
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, Panel))
      },
    }
  },
})