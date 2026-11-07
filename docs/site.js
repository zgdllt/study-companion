// 伴学项目页：复制按钮、安装方式页签、滚动渐显、B 站宣传片嵌入。
'use strict';

// Fill in after the Bilibili upload (e.g. 'BV1xx411c7mD'); the video section stays hidden while empty.
const BILIBILI_BVID = 'BV1nN4J6REcy';

for (const btn of document.querySelectorAll('.copy')) {
  btn.addEventListener('click', async () => {
    const text = document.querySelector(btn.dataset.copy).textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已复制 ✓';
    } catch {
      btn.textContent = '请手动复制';
    }
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('done'); }, 1800);
  });
}

const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => select(tab));
  tab.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    select(next); next.focus();
  });
});

const targets = document.querySelectorAll('.q-card, .steps li, .install > *, .two > div');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, {threshold: 0.18});
  targets.forEach((el, i) => { el.classList.add('reveal'); el.style.transitionDelay = `${(i % 3) * 80}ms`; io.observe(el); });
}

if (/^BV[0-9A-Za-z]{10}$/.test(BILIBILI_BVID)) {
  const sec = document.getElementById('video');
  const frame = document.createElement('iframe');
  frame.src = `https://player.bilibili.com/player.html?bvid=${BILIBILI_BVID}&page=1&high_quality=1&autoplay=0`;
  frame.title = '伴学宣传片（B 站）';
  frame.allowFullscreen = true;
  frame.loading = 'lazy';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
  sec.querySelector('.player').append(frame);
  sec.hidden = false;
}
