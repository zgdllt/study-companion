# 伴学 · Study Companion

[![CI](https://github.com/zgdllt/study-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/zgdllt/study-companion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，把 AI 对话变成可持续的学习回路：规划 → 练习 → 测试 → 反馈 → 复习。**

在对话中让 agent 制订学习阶梯、出题与评分，在侧栏面板中查看进度、作答和回顾漏洞；还可以跟随网页课程记录笔记，把练习中的难点追溯到课件页与原课时间。

## 能做什么

| 能力 | 使用方式 |
| --- | --- |
| 学习路径 | 五级学习阶梯、20 小时计划、最多 5 个精选资源 |
| 一次一题的考试 | 对话出题 → 面板作答 → 对话评分，记录具体漏洞与判分依据 |
| 掌握度与复习 | 分开记录计划完成、独立通过、提示后完成、隔天复测；安排 +1/+3/+7 天复习 |
| 知识压缩 | 费曼复述记录与一页速查表 |
| 同堂伴学 | 课中标记、原课要点与 agent 补充分栏笔记、互动补讲与来源回溯 |
| Safari 适配器（可选） | 在 macOS 上读取课程播放状态、暂停/继续/定位、同步课件锚点 |

## 安装

### 1. 准备 DeepSeek Harness

伴学依赖 DSH 的 Host 和 Web 界面。已有 DeepSeek Harness 桌面版的用户可以直接打开应用；使用命令行的用户可以按[官方说明](https://github.com/deepseek-ai/deepseek-harness#run)启动：

```sh
npx @deepseek-ai/dsh web
```

默认界面地址为 `http://127.0.0.1:3080`。先在「设置 → 模型」配置可用模型，再选择或添加工作区。模型配置细节见 [DSH 使用指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.zh.md)。

插件此前在 **DSH 0.2.1-rc.5** 中开发和验证。DSH 仍处于开发预览期，其他版本以宿主插件 API 的兼容性为准。Safari 课程控制需要 macOS；普通学习档案和考试流程不依赖 Safari。

### 2. 安装伴学（推荐：Git 地址）

1. 在 DSH 侧栏打开「**插件**」，点击「**添加插件**」。
2. 在安装输入框粘贴下面的完整地址，固定安装 `v1.0.0`：

   ```text
   git+https://github.com/zgdllt/study-companion.git#v1.0.0
   ```

3. 点击「**安装**」，等待完成后点击「**立即启用**」。如果页面提示需要重启，重启 DSH。
4. 刷新 DSH 界面。侧栏应出现「**伴学**」入口，插件列表中包名为 `@local/study-companion`。

安装时需要运行 DSH 的机器能够访问 GitHub。无需单独构建本插件，也无需将源码复制进 DSH 安装目录。

### 其他安装方式

**下载 Release 安装包**：打开 [Releases](https://github.com/zgdllt/study-companion/releases/latest)，下载 `local-study-companion-1.0.0.tgz`，保持压缩包原样。在同一个「添加插件」输入框中填写该文件的**绝对路径**，然后安装并启用。例如：

```text
/absolute/path/to/local-study-companion-1.0.0.tgz
```

**从源码安装（开发用）**：

```sh
git clone https://github.com/zgdllt/study-companion.git
cd study-companion
pwd
```

把 `pwd` 输出的绝对目录填入「添加插件」。目录安装会链接到源码，保留该目录；修改客户端后刷新页面，修改 Host 后按 DSH 提示重载插件或重启宿主。

本地路径必须位于**运行 DSH 的那台机器**上。远程使用 DSH 时，浏览器所在电脑的下载路径不能直接用于远端安装。

也可以在 DSH 对话中让 agent 安装，明确提供 `plugin_manager` 工具参数：

```json
{
  "action": "install_bundle",
  "target": "git+https://github.com/zgdllt/study-companion.git#v1.0.0"
}
```

这是 **DSH 内的工具调用参数**，不用在终端执行；若当前 agent 预设没有 `plugin_manager`，使用上面的插件页面安装。`@local/study-companion` 是插件包的内部名称，本项目通过 GitHub 分发，未发布到 npm 注册表。

### 3. 检查安装结果

- 「插件」页中「伴学」已启用，Host 行没有加载错误。
- 侧栏能打开「伴学」，看到「概览 / 阶梯 / 考场 / 课堂 / 方法」。
- 在「概览」新建学科后，回对话让 agent 读取学习档案，应能调用 `study_read`。

若只有插件条目、没有面板，先确认组合包已启用，再刷新页面；有 `restart-required` 提示时重启 DSH。若 GitHub 下载失败，可以改用下载后放到 DSH 主机上的 `.tgz` 安装包。其他错误请附 DSH 版本与插件安装日志[提交 Issue](https://github.com/zgdllt/study-companion/issues)。

## 第一次使用

1. 在「概览」新建学科，填写主题、目标、截止时间和可用小时数。
2. 回到一个 DSH 对话，发送：

   > 请用伴学工具读取我刚创建的学科，先通过 study_write 的 bind_session 操作将它绑定到当前对话，再建立学习阶梯和学习计划并写入档案。先带我完成第一个单元，不要一次讲完整套课程。

3. 学完一个单元后说「开始考试」。agent 用 `ask_exam` 一次出一道题。
4. 打开「考场」作答，点击「提交并继续考试」。答案先保存，再向绑定的伴学对话发送继续请求；也可以保存后自己回到该对话说「继续考试」。
5. agent 读取答案，评分并指出具体漏洞，再讲解或出下一题。面板展示结果，不自行评分。
6. 学完后让 agent 保存一页速查表并安排复测。

每个学科可以绑定一个主伴学对话；换对话继续时，先让 agent 使用 `bind_session` 重新绑定。「方法」页提供六张方法卡和可复制的提示词。

## 跟随网页课程（Safari，可选）

普通学习流程无需这些设置。要在 macOS 上同步课程播放状态：

1. 用 Safari 打开课程回放。
2. Safari「设置 → 高级」中打开网页开发者功能，再在「开发者」设置中勾选「允许从 Apple 事件执行 JavaScript」（名称可能随 Safari 版本略有不同）。
3. macOS 提示自动化授权时，允许运行 DSH 的应用或终端控制 Safari；可在「系统设置 → 隐私与安全性 → 自动化」查看。
4. 在伴学对话中让 agent 使用 `lesson_open` 建立课次；打开「课堂」，检查适配器探针，再同步播放状态。

此前仅在**雨课堂回放**上实测了媒体状态、播放控制、课件锚点和时间对齐。B 站、学堂在线及其他站点未完成验证。字幕和讲授画面抓取未接入。

没有播放器接口时，媒体位置保持 `null`，能力保持未验证或不可用；页面上的授课时刻不会被冒充为视频时间。课件与媒体的自动对齐属于推定结果（`confidence: inferred`）。笔记中的「原课要点」和「agent 补充」分别保存，补讲带有生成内容标记。

## 数据与隐私

学习档案保存在运行 DSH 的机器上：

```text
$DSH_HOME/storages/study-companion/
├── active.json                # 当前学科
├── subjects/<id>.json         # 计划、考试、漏洞、掌握度与复测
├── courses/<id>.json          # 课程身份与网址
├── lessons/<id>.json          # 播放状态、锚点、标记、笔记、补讲与回溯
└── prefs.json                 # 全局及各学科表达偏好
```

`DSH_HOME` 未设置时使用 `~/.dsh`。可在 bundle 的 `cordis.patch.yml` 中为 Host 行设置 `config.dataDir` 来更换目录。

- 每个学科独立保存，支持单独备份和迁移；卸载插件不会删除档案。
- 媒体和长转写按引用记录，不把完整视频装进学科快照。
- 插件自身没有额外的云端服务或遥测。对话和 agent 使用学习内容时，仍按 DSH 中配置的模型服务和权限处理。
- 开源仓库和 Release 包均不含个人学习档案、录屏、宣传素材或参考音色。

## 开发与验证

插件使用原生 JavaScript ESM，没有需要单独安装的运行时依赖。测试使用 Node.js 内置模块；自动检查覆盖 Node.js 22 和 24。

```sh
git clone https://github.com/zgdllt/study-companion.git
cd study-companion
npm run check       # Host、Client、Safari 适配器语法检查
npm test            # Host 46 项 + 课次 34 项回归
npm pack            # 生成 local-study-companion-1.0.0.tgz
```

CI 同时检查源码和解压后的安装包。测试使用模拟的 DSH 上下文与临时数据目录，不会读取个人学习档案或控制浏览器；它们不替代真实 DSH 界面的完整交互验收。

| 文件 | 职责 |
| --- | --- |
| `package.json` / `cordis.patch.yml` | DSH bundle、Host 行和客户端声明 |
| `index.js` | 档案存储、`study_read` / `study_write` / `lesson_read`、同源路由 |
| `client.js` | 五页签侧栏面板与会话输入框下方挂件 |
| `adapter/safari.js` | 可选 Safari 平台适配器 |
| `content/method.json` | 六张学习方法卡 |
| `locale/` / `icon.svg` | 中文、英文清单文案与图标 |
| [docs/CONTRACT.md](docs/CONTRACT.md) | 接口、数据模型、设计决策及待实现项 |
| [RELEASE.md](RELEASE.md) / [tests/README.md](tests/README.md) | 版本说明与测试范围 |

欢迎通过 [Issues](https://github.com/zgdllt/study-companion/issues) 或 Pull Request 反馈。修改工具、存储或路由时，请同步接口契约并运行现有回归；提交中不要包含真实学科档案、密钥或未获授权的素材。

## 当前边界

- 评分是模型对本次回答的判断，不等于真实能力验收，也不替代真实项目与反馈。
- 学习方法不构成「快 10 倍」的效果承诺。
- 自动前测与真实预算编排、首单元完整验收协议、教材边界自动核验、真实浏览器全链路验收仍有待完成；状态以接口契约中的标记为准。
- 本次发布未重新执行真实课程、其他操作系统或其他 DSH 版本的端到端验收。

## 来源与许可

学习方法参考 Rahul 的 [How To Learn Anything 10x Faster Using Claude](https://x.com/sairahul1/article/2068250224532050089) 及[中文解读](https://zhuanlan.zhihu.com/p/2070979462934565425)。这些链接用于说明方法来源，不代表效果验证。

本项目为独立开发的社区插件，采用 [MIT 许可证](LICENSE)。
