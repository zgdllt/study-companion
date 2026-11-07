/**
 * Safari 平台适配器（同堂伴学 v4）。
 *
 * 通过 AppleScript 驱动 Safari：
 *  - 页面身份（URL / 标题 / 平台）只需要 macOS 自动化权限；
 *  - 媒体状态与播放控制需要 Safari 开发者设置里的
 *    「允许从 Apple 事件执行 JavaScript」。
 *
 * 雨课堂的回放把 <video> 放在同源 iframe（pro.yuketang.cn/m/v2/lesson/student/…）里，
 * 所以媒体与课件的读取都要**下钻同源 iframe**（最多两层）。
 *
 * 硬规则：
 *  - 取不到的值返回 null，绝不用电脑时间或页面显示时刻冒充媒体位置；
 *  - 课件列表里的 data-dt 是直播时的墙钟时间，只作为 observedClock 证据，不当作媒体偏移；
 *  - 控制动作执行后必须回读实际状态，不把请求当事实。
 */

import { execFile } from 'node:child_process'

const APPLESCRIPT_TIMEOUT_MS = 6000

const MEDIA_SCRIPT = `(() => {
  const clean = (value, limit) => String(value === undefined || value === null ? '' : value).replace(/\\s+/g, ' ').trim().slice(0, limit);
  const findVideo = (doc, depth) => {
    const direct = doc.querySelector('video');
    if (direct) return { video: direct, depth };
    if (depth >= 2) return null;
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      try {
        const inner = frame.contentDocument;
        if (!inner) continue;
        const found = findVideo(inner, depth + 1);
        if (found) return found;
      } catch (error) { /* 跨源 iframe 读不到，跳过 */ }
    }
    return null;
  };
  const scrapeSlides = (doc, depth) => {
    const items = Array.from(doc.querySelectorAll('.slide-item, [data-playback="true"]'));
    if (items.length > 0) {
      return items.slice(0, 80).map((el) => {
        const text = clean(el.innerText, 120);
        const clockMatch = text.match(/\\b\\d{1,2}:\\d{2}\\b/);
        const durationMatch = text.match(/放映([0-9]+分)?([0-9]+秒)?/);
        return {
          dt: el.getAttribute('data-dt'),
          clock: clockMatch ? clockMatch[0] : '',
          durationText: durationMatch ? durationMatch[0] : '',
          text,
          active: /active|current|playing/i.test(String(el.className || '')),
        };
      });
    }
    if (depth >= 2) return [];
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      try {
        const inner = frame.contentDocument;
        if (!inner) continue;
        const nested = scrapeSlides(inner, depth + 1);
        if (nested.length > 0) return nested;
      } catch (error) { /* ignore */ }
    }
    return [];
  };
  const out = { url: location.href, title: document.title, hasVideo: false, video: null, videoInIframe: false, slideItems: [], clockSamples: [] };
  const found = findVideo(document, 0);
  if (found) {
    const v = found.video;
    out.hasVideo = true;
    out.videoInIframe = found.depth > 0;
    out.video = {
      currentTime: Number.isFinite(Number(v.currentTime)) ? Number(v.currentTime) : null,
      duration: Number.isFinite(Number(v.duration)) ? Number(v.duration) : null,
      paused: typeof v.paused === 'boolean' ? v.paused : null,
      playbackRate: Number.isFinite(Number(v.playbackRate)) ? Number(v.playbackRate) : null,
      src: String(v.currentSrc || v.src || '').slice(0, 200),
    };
  }
  out.slideItems = scrapeSlides(document, 0);
  const bodyText = document.body ? String(document.body.innerText || '').slice(0, 4000) : '';
  const clocks = bodyText.match(/\\b\\d{1,2}:\\d{2}\\b/g) || [];
  out.clockSamples = clocks.slice(0, 6);
  return JSON.stringify(out);
})()`

const VIDEO_FINDER = `
  const findVideo = (doc, depth) => {
    const direct = doc.querySelector('video');
    if (direct) return direct;
    if (depth >= 2) return null;
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      try {
        const inner = frame.contentDocument;
        if (!inner) continue;
        const found = findVideo(inner, depth + 1);
        if (found) return found;
      } catch (error) { /* ignore */ }
    }
    return null;
  };`

const CONTROL_SCRIPT = (body) => `(() => {${VIDEO_FINDER}
  try {
    const video = findVideo(document, 0);
    if (!video) return 'no-video';
    ${body}
    return 'ok';
  } catch (error) { return 'error:' + String(error); }
})()`

const READ_FRONT_TAB = `
tell application "Safari"
  if (count of windows) = 0 then return "NO_WINDOW"
  set currentTab to current tab of front window
  return (URL of currentTab) & "\u0001" & (name of currentTab)
end tell`

const PLATFORM_PATTERNS = {
  yuketang: ['yuketang.cn', 'yuketang.com'],
  bilibili: ['bilibili.com'],
  xuetangx: ['xuetangx.com'],
}

function applescriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

function runAppleScript(source) {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', source],
      { timeout: APPLESCRIPT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolve({ ok: false, error: String(stderr ?? '').trim() || error.message, stdout: String(stdout ?? '').trim() })
          return
        }
        resolve({ ok: true, stdout: String(stdout ?? '').trim(), error: null })
      },
    )
  })
}

function detectPlatform(url) {
  if (typeof url !== 'string') return 'other'
  if (url.includes('yuketang.cn') || url.includes('yuketang.com')) return 'yuketang'
  if (url.includes('bilibili.com')) return 'bilibili'
  if (url.includes('xuetangx.com')) return 'xuetangx'
  return 'other'
}

/** 读前台标签页身份；不需要 JavaScript 权限。 */
export async function readFrontTab() {
  const result = await runAppleScript(READ_FRONT_TAB)
  if (result.ok !== true) return { ok: false, error: result.error, url: null, title: null, platform: 'other', windowIndex: null, tabIndex: null }
  if (result.stdout === 'NO_WINDOW') {
    return { ok: false, error: 'Safari 没有打开的窗口', url: null, title: null, platform: 'other', windowIndex: null, tabIndex: null }
  }
  const [url, title] = result.stdout.split('\u0001')
  return { ok: true, error: null, url: url ?? '', title: title ?? '', platform: detectPlatform(url), windowIndex: null, tabIndex: null }
}

/** 按平台优先级找课次标签页；找不到返回 notFound。 */
export async function findTargetTab(options = {}) {
  const patterns = []
  if (typeof options.urlIncludes === 'string' && options.urlIncludes !== '') patterns.push(options.urlIncludes)
  for (const platform of Array.isArray(options.platforms) ? options.platforms : []) {
    for (const pattern of PLATFORM_PATTERNS[platform] ?? []) patterns.push(pattern)
  }
  for (const pattern of patterns) {
    const safe = String(pattern).replace(/[\\"]/g, '')
    const source = `
tell application "Safari"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set u to URL of t
      if u contains "${safe}" then return (wi as string) & "\u0001" & (ti as string) & "\u0001" & u & "\u0001" & (name of t)
    end repeat
  end repeat
  return "NOT_FOUND"
end tell`
    const result = await runAppleScript(source)
    if (result.ok !== true) return { ok: false, error: result.error, windowIndex: null, tabIndex: null, url: null, title: null, platform: 'other' }
    if (result.stdout === 'NOT_FOUND' || result.stdout === '') continue
    const [windowIndex, tabIndex, url, title] = result.stdout.split('\u0001')
    return {
      ok: true,
      error: null,
      windowIndex: Number(windowIndex),
      tabIndex: Number(tabIndex),
      url: url ?? '',
      title: title ?? '',
      platform: detectPlatform(url),
      matchedPattern: pattern,
    }
  }
  return { ok: false, error: null, windowIndex: null, tabIndex: null, url: null, title: null, platform: 'other', notFound: true }
}

async function runJavaScript(js, target) {
  const location = target !== null && target !== undefined && Number.isInteger(target.windowIndex) && Number.isInteger(target.tabIndex)
    ? `in tab ${target.tabIndex} of window ${target.windowIndex}`
    : 'in current tab of front window'
  return runAppleScript(`tell application "Safari" to do JavaScript ${applescriptString(js)} ${location}`)
}

async function resolveTarget(options) {
  const front = await readFrontTab()
  const targeted = await findTargetTab({ platforms: options.preferPlatforms ?? ['yuketang', 'bilibili', 'xuetangx'] })
  if (targeted.ok === true) return targeted
  return front
}

function blocked(error) {
  return typeof error === 'string' && /Allow JavaScript from Apple Events/i.test(error)
}

function emptyState(error, tab) {
  return { ok: false, error, javascript: { allowed: false, error }, tab, media: null }
}

/** 读媒体状态 + 课件列表（同源 iframe 感知）。 */
export async function readMediaState(options = {}) {
  const tab = await resolveTarget(options)
  if (tab.ok !== true) return emptyState(tab.error, tab)
  const result = await runJavaScript(MEDIA_SCRIPT, tab)
  if (result.ok !== true) return emptyState(result.error, tab)
  let media = null
  try {
    media = JSON.parse(result.stdout)
  } catch {
    return emptyState('页面返回的不是可解析的 JSON', tab)
  }
  return { ok: true, error: null, javascript: { allowed: true, error: null }, tab, media }
}

/** 控制播放：pause / play / seek（秒）。执行后由调用方回读，不在此猜测状态。 */
export async function controlPlayback(action, params = {}) {
  const tab = await resolveTarget({ preferPlatforms: params.preferPlatforms })
  if (tab.ok !== true) return { ok: false, error: tab.error, javascript: { allowed: false } }
  let body = ''
  if (action === 'pause') body = 'video.pause();'
  else if (action === 'play') body = 'void video.play();'
  else if (action === 'seek') {
    const seconds = Number(params.seconds)
    if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, error: 'seek 需要合法的 seconds' }
    body = `video.currentTime = ${Math.round(seconds * 1000) / 1000};`
  } else return { ok: false, error: `不支持的动作：${action}` }

  const result = await runJavaScript(CONTROL_SCRIPT(body), tab)
  if (result.ok !== true) return { ok: false, error: result.error, javascript: { allowed: !blocked(result.error) } }
  if (result.stdout === 'no-video') return { ok: false, error: '当前页面没有可控制的 <video>', javascript: { allowed: true } }
  if (result.stdout !== 'ok') return { ok: false, error: result.stdout, javascript: { allowed: true } }
  return { ok: true, error: null, javascript: { allowed: true }, requested: action }
}

/** 综合探针。 */
export async function probe(options = {}) {
  const media = await readMediaState({ preferPlatforms: options.preferPlatforms ?? ['yuketang', 'bilibili', 'xuetangx'] })
  return { ok: media.ok === true, tab: media.tab, javascript: media.javascript, media: media.media, error: media.error }
}