# 发布说明 · 伴学 1.0.0

一个 DeepSeek Harness（DSH）Web 插件：把「随手问 AI」变成一条可续、可测、可复习的学习回路，并支持跟着网页网课记笔记、从练习回溯到课件页与原讲解时间点。

- 包名：`@local/study-companion`
- 版本：`1.0.0`
- 许可：MIT（见 `LICENSE`）
- 形态：DSH bundle（Host 行 + Web 客户端 + 一个可选平台适配器）

---

## 一、安装

### 方式 A：从 GitHub 安装（推荐）

在 DeepSeek Harness 侧栏打开「插件 → 添加插件」，填入：

```text
git+https://github.com/zgdllt/study-companion.git#v1.0.0
```

安装完成后点击「立即启用」，按提示重启宿主并刷新页面。侧栏出现「伴学」，插件包名为 `@local/study-companion`。首次使用宿主、安装结果检查与常见问题见 [README 的安装章节](README.md#安装)。

### 方式 B：从 tarball 安装

从 [GitHub Release](https://github.com/zgdllt/study-companion/releases/tag/v1.0.0) 下载 `local-study-companion-1.0.0.tgz`，在「添加插件」中填入压缩包绝对路径；或让 DSH agent 调用以下工具参数（不用在终端执行）：

```text
plugin_manager  action: install_bundle
                target: /绝对路径/local-study-companion-1.0.0.tgz
```

装完侧栏出现「伴学」图标；`设置 → 插件` 里可见标题、描述与图标。

### 方式 C：从源码目录安装（本地开发用）

克隆 `https://github.com/zgdllt/study-companion.git`，把源码绝对目录填入「添加插件」，或让 DSH agent 调用：

```text
plugin_manager  action: install_bundle
                target: /绝对路径/study-companion
```

目录安装是 **link**，改完源码刷新页面即可（Host 侧改动需在插件页禁用→启用重载）。

### 安装前提

| 项 | 要求 |
|---|---|
| DSH | 曾在 0.2.1-rc.5 开发与验证；其他版本以宿主插件 API 兼容性为准 |
| Node | 随 DSH 一起提供，无需另装 |
| 平台 | Safari 适配器仅支持 macOS；其他平台的普通学习流程未完成端到端验证 |

---

## 二、装好之后能做什么

| 能力 | 入口 |
|---|---|
| 五级学习阶梯、20 小时计划、资源策展、速查表 | 对话里让伴学写档案，面板「阶梯」页看进度 |
| 考到崩溃（一次一题、打分、抓漏洞） | 对话出题 → 面板「考场」作答 → 回对话说「继续考试」评分 |
| 掌握度（独立通过 / 隔天复测 / 提示后完成） | 与计划勾选分开记录，面板「阶梯」显示徽标 |
| 同堂伴学：跟课、课中标记、分栏笔记 | 面板「课堂」页 |
| 从练习回溯到课件页与原讲解时间点 | 「考场」里点「查来源」 |
| 互动补讲小节 | 对话里生成，面板「课堂」展示 |

---

## 三、Safari 适配器（可选）

只做「读播放状态 / 控制播放」，不承担教学。要让媒体时间可用，需要一次性手动设置：

1. Safari → 设置 → **高级** → 勾选「显示网页功能开发者功能」；
2. Safari → 设置 → **开发者** → 勾选 **「允许从 Apple 事件执行 JavaScript」**；
3. 系统设置 → 隐私与安全性 → **自动化** → 允许终端/DSH 控制 Safari。

不做这三步也能用：插件会把相关能力保持为 `unverified`，媒体位置记为 `null`，绝不编造时间。

已实测（雨课堂回放）：定位标签页、读 `currentTime/duration/paused/playbackRate`、暂停/继续/定位、抓帧；课件页与媒体时间可自校准对齐（`confidence: inferred`）。B 站、学堂在线未实测。

---

## 四、数据放在哪

```
$DSH_HOME/storages/study-companion/
├── active.json               当前学科
├── subjects/<id>.json        学科档案（阶梯/计划/考试/复测/掌握度）
├── courses/<id>.json         课程（平台 + 网址）
├── lessons/<id>.json         课次（能力/播放状态/锚点/标记/笔记/补讲/回溯/校准）
└── prefs.json                表达偏好（全局默认 + 每学科覆盖）
```

- 一学科一文件：删/备份/迁移单个学科不影响其他。
- 原子写（临时文件 + rename）；单个文件损坏只跳过该条，不拖垮面板。
- 媒体与长转写只按引用保存，不进学科快照、不进答案接口。
- 卸载插件不会删除这些数据；需要清空时手动删目录。

---

## 五、包内文件

```
local-study-companion-1.0.0.tgz
├── package.json           bundle 清单（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml       插入一行 Host 插件
├── index.js               Host：学科/课次存储、3 个工具及同源路由
├── client.js              Client：侧栏面板（概览/阶梯/考场/课堂/方法）+ 输入框下方挂件
├── adapter/safari.js      Safari 平台适配器（可选）
├── content/method.json    六张方法卡（含可直接复制的提示词）
├── locale/{zh,en}.json    插件清单文案
├── icon.svg               图标
├── README.md              使用说明
├── RELEASE.md             本文件
├── LICENSE                MIT
├── docs/CONTRACT.md       三方接口契约（Host/Client/内容）
└── tests/                 回归测试（见下）
```

`promo/`、屏幕录像等素材**不在**包内（由 `files` 字段限制），也不纳入公开 Git 仓库。学习档案、参考音色和本地配置均不随项目分发。

---

## 六、自测

```bash
npm test     # 等价于 node tests/run-all.mjs
```

会在临时目录里用包内源码重建测试环境并跑两套回归：

| 套件 | 覆盖 |
|---|---|
| `host-regress.mjs`（46 项） | 并发写不丢更新、题号/答案版本校验、`ask_exam` 覆盖防护、非法请求 400、指定学科响应归属、掌握度与计划分离、拆项评分与依据 |
| `lesson-regress.mjs`（34 项） | 能力默认 `unverified`、未知媒体位置保持 `null`（不被写成 0）、未对齐时间被拒、笔记分栏、补讲 `generated`、偏好合并、学科隔离、课次路由 |

当前状态：**46/46 + 34/34 全通过**。

GitHub 发布前在 Node.js 22、24、26 上重新运行上述回归，并检查语法和安装包内容。GitHub Actions 在 Node.js 22、24 上检查源码及解压后的安装包。这些检查使用模拟的 DSH 上下文，不代表重新完成真实浏览器或课程的端到端验收。

---

## 七、已知边界（发布时如实标注）

- **评分是模型自评**，不等于真实验收；不替代真实项目与真实反馈。
- **方法卡里的研究结论只支持机制**（检索练习、间隔重复），不构成「快 10 倍」的效果承诺。
- **Safari 适配器仅雨课堂回放实测**；B 站、学堂在线未验证，`capabilities` 会保持 `unverified`。
- **字幕、讲授画面抓取**未实现（`captions`/`grab` 恒为 `unverified`）。
- **课件↔媒体对齐是推定值**（`confidence: inferred`）：由直播墙钟与逐页时长自校准，已用三点帧比对验证，但不是播放器直接读出。
- 面板不能控制原站播放器以外的站点行为；「我想一下」记的是**暂停请求**，实际状态以原页面为准。
- 未接：其他平台、线下课堂声音、摄像头讲授画面、完整课程编排、视频导出。

---

## 八、版本历史

| 版本 | 要点 |
|---|---|
| 1.0.0 | 打包发布：可安装 tarball、MIT 许可、自测脚本、发布说明；含 v4 同堂伴学（课次/锚点/笔记/补讲/回溯）、Safari 适配器与课件时间对齐 |
| 0.1.0 | 首个可用版本：学科档案、五级阶梯、20 小时计划、考到崩溃、掌握度、面板四页签、会话内挂件 |
