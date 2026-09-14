/* =========================================================
   Flank for Windows · 产品宣传页
   ---------------------------------------------------------
   1) 下载地址：启动时读取 GitHub 最新 Release，并按 Windows / macOS 选择安装包。
   2) 便签栏的结构/尺寸/动效对齐 src/features/dock/DockView.vue：
      gsap.quickTo 驱动 x / scaleX / scaleY（power3.out .34）；
      指针距离决定 influence，当前项与邻居一起放大；
      悬停 1 秒浮出归档 / 删除；控制按钮 back.out(1.9) 交错入场；
      卡片从屏幕边缘旋转回弹进入（power3.out → back.out(1.7)）。
      项目已移除拖拽换边，这里同样没有拖拽把手。
   ========================================================= */

/*
 * 从仓库配置读取版本号，再拼出 Release 直链。
 * 不使用 api.github.com，避免未登录 API 的共享 IP 限流导致下载退回 Release 页面。
 */
const RELEASE_VERSION_URL = 'https://raw.githubusercontent.com/qbbmnnnnnn/flank/master/src-tauri/tauri.conf.json';
const RELEASE_DOWNLOAD_BASE = 'https://github.com/qbbmnnnnnn/flank/releases/download';
const RELEASE_PAGE_URL = 'https://github.com/qbbmnnnnnn/flank/releases/latest';

(() => {
  'use strict';

  const gsap = window.gsap;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = gsap ? gsap.utils.clamp : (min, max, v) => Math.min(max, Math.max(min, v));
  const mapRange = gsap
    ? gsap.utils.mapRange
    : (a, b, c, d, v) => c + (d - c) * clamp(0, 1, (v - a) / (b - a));
  const esc = (v) =>
    String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- 系统识别与下载地址 ---------------- */

  const STORAGE_KEY = 'flank-platform';

  /** 识别访客系统；识别不出时默认给 Windows（产品以 Windows 版为主）。 */
  function detectPlatform() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const hint = String(
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
    ).toLowerCase();
    if (/mac/.test(hint) || /macintosh|mac os x/.test(ua)) return 'mac';
    if (/win/.test(hint) || /windows/.test(ua)) return 'windows';
    return 'windows';
  }

  function readStoredPlatform() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'mac' || value === 'windows' ? value : null;
    } catch {
      return null;
    }
  }

  function storePlatform(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  const downloadLinks = [...document.querySelectorAll('[data-download]')];
  const osCopies = [...document.querySelectorAll('[data-os-windows], [data-os-mac]')];
  const switchButtons = [...document.querySelectorAll('[data-platform-switch] button')];
  const downloadUrls = { windows: '', mac: '' };
  let platform = 'windows';
  let releaseLoaded = false;

  async function loadLatestRelease() {
    try {
      const response = await fetch(RELEASE_VERSION_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub Raw ${response.status}`);
      const config = await response.json();
      const version = String(config.version || '').trim();
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error('无效的 Release 版本号');
      }

      const releaseBase = `${RELEASE_DOWNLOAD_BASE}/v${version}`;
      downloadUrls.windows = `${releaseBase}/Flank_${version}_x64-setup.exe`;
      downloadUrls.mac = `${releaseBase}/Flank_${version}_aarch64.dmg`;
    } catch (error) {
      console.warn('无法解析 Flank 最新安装包直链，将打开 Release 页面。', error);
    } finally {
      releaseLoaded = true;
      applyPlatform(platform);
    }
  }

  function applyPlatform(next, { remember = false } = {}) {
    platform = next === 'mac' ? 'mac' : 'windows';
    if (remember) storePlatform(platform);
    document.documentElement.dataset.platform = platform;

    const url = downloadUrls[platform];
    downloadLinks.forEach((link) => {
      link.href = url || RELEASE_PAGE_URL;
      link.removeAttribute('download');
      if (url) {
        link.removeAttribute('title');
      } else {
        link.title = releaseLoaded
          ? `最新 Release 中没有找到 ${platform === 'mac' ? 'macOS' : 'Windows'} 安装包，点击查看 Release 页面`
          : '正在获取最新安装包…';
      }
    });

    osCopies.forEach((el) => {
      const value = el.getAttribute(`data-os-${platform}`);
      if (value) el.textContent = value;
    });

    switchButtons.forEach((button) => {
      const active = button.dataset.platform === platform;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const switcher = document.querySelector('[data-platform-switch]');
    const x = platform === 'mac' ? '88px' : '0px';
    if (switcher) {
      if (gsap && remember && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to(switcher, { '--platform-x': x, duration: .32, ease: 'power3.out', overwrite: true });
      } else {
        switcher.style.setProperty('--platform-x', x);
      }
    }
  }

  applyPlatform(readStoredPlatform() || detectPlatform());
  const releasePromise = loadLatestRelease();

  downloadLinks.forEach((link) => {
    link.addEventListener('click', async (event) => {
      if (downloadUrls[platform] || releaseLoaded) return;
      event.preventDefault();
      await releasePromise;
      window.location.assign(downloadUrls[platform] || RELEASE_PAGE_URL);
    });
  });

  switchButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.platform === platform) return;
      applyPlatform(button.dataset.platform, { remember: true });
      // Keep copy fully opaque: the sliding selection and button scale provide feedback.
    });
  });

  /* ---------------- 顶栏 ---------------- */

  const header = document.getElementById('siteHeader');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------- 滚动显现（克制：短距离 + power3.out） ---------------- */

  const reveals = [...document.querySelectorAll('[data-reveal]')];
  if (gsap && !reduceMotion && 'IntersectionObserver' in window) {
    gsap.set(reveals, { opacity: 0, y: 14 });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          gsap.to(entry.target, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', clearProps: 'opacity,transform' });
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }
    );
    reveals.forEach((el) => io.observe(el));
    // Reveal only when visible; never pre-play below-the-fold content.
  }

  /* The download surface stays anchored; its contents gently arrive once. */
  const downloadPanel = document.querySelector('[data-download-reveal]');
  if (downloadPanel && gsap && !reduceMotion && 'IntersectionObserver' in window) {
    const children = [...downloadPanel.querySelectorAll('.download-copy, .download-actions')];
    gsap.set(children, { opacity: 0 });
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      gsap.to(children, { opacity: 1, duration: .45, stagger: .08, ease: 'power2.out', clearProps: 'opacity' });
      observer.disconnect();
    }, { threshold: .15 });
    observer.observe(downloadPanel);
  }

  /* ---------------- Hero 入场 ---------------- */

  if (gsap && !reduceMotion) {
    gsap
      .timeline({ defaults: { ease: 'power3.out', duration: 0.7 } })
      .from('.eyebrow', { opacity: 0, y: 10 })
      .from('.hero h1 .line', { opacity: 0, y: 18, stagger: 0.09 }, '-=0.45')
      .from('.lede', { opacity: 0, y: 12 }, '-=0.5')
      .from('.hero-actions', { opacity: 0, y: 10, clearProps: 'opacity,transform' }, '-=0.5')
      .from('.hero-meta', { opacity: 0 }, '-=0.45')
      .from('.showcase', { opacity: 0, y: 26, duration: 0.9 }, '-=0.4');
  }

  /* Interactive surfaces: transforms have a single owner. */
  if (gsap) {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)', () => {
      const cleanups = [];
      document.querySelectorAll('.card, .privacy-note').forEach((card) => {
        const lift = gsap.quickTo(card, 'y', { duration: 0.32, ease: 'power3.out' });
        const enter = () => lift(-4);
        const leave = () => lift(0);
        card.addEventListener('pointerenter', enter);
        card.addEventListener('pointerleave', leave);
        cleanups.push(() => { card.removeEventListener('pointerenter', enter); card.removeEventListener('pointerleave', leave); });
      });
      return () => cleanups.forEach((cleanup) => cleanup());
    });
  }

  const privacyCards = [...document.querySelectorAll('[data-privacy]')];
  const privacyDetails = {
    body: '正文经 AES-GCM 加密，写入你电脑上的 SQLite 数据库。',
    meta: '标题、颜色与时间等元数据明文存储。加密范围明确，不夸大保护。',
    network: '没有账号或笔记服务器。应用更新检查需要联网，也可以关闭。'
  };
  privacyCards.forEach((card) => card.addEventListener('click', () => {
    if (card.getAttribute('aria-pressed') === 'true') return;
    const before = privacyCards.map((item) => item.getBoundingClientRect().top);
    privacyCards.forEach((item) => item.setAttribute('aria-pressed', String(item === card)));
    const detail = document.querySelector('[data-privacy-detail]');
    detail.textContent = privacyDetails[card.dataset.privacy];
    if (gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Independent translate keeps FLIP separate from hover's transform.
      privacyCards.forEach((item, i) => {
        const delta = before[i] - item.getBoundingClientRect().top;
        item.getAnimations().forEach((animation) => animation.cancel());
        item.animate([{ translate: `0 ${delta}px` }, { translate: '0 0' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
      });
      // The cards shift into place; do not reset content opacity on every click.
    }
  }));

  /* ---------------- 数据 ---------------- */

  const NOTES = [
    { title: '今日灵感', color: '#ffe57a', body: '让工具像家具一样安静，像朋友一样及时。\n\n- 调整首页留白\n- 试试侧边吸附\n- 周五前完成原型' },
    { title: '产品待办', color: '#ffb8a7', body: '## 高优先级\n\n- [x] 纵向 Dock 动效\n- [ ] 便签快速唤起\n- [ ] 本地自动保存' },
    { title: '阅读清单', color: '#a9e5d1', body: '这个月想读：\n\n- 设计中的设计\n- 毫无意义的工作\n- 制造消费者' },
    { title: '会议速记', color: '#aed6ff', body: '> 减少永久可见的控件，用上下文和动效提示下一步。\n\nDesign Sync · 14:30' }
  ];
  const SWATCHES = ['#ffe57a', '#ffb8a7', '#f5b8cd', '#d8c1ff', '#aed6ff', '#a9e5d1'];
  const ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.38.73.6 1 .28.34.67.54 1.1.6H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
    archive: '<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
    task: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7.5 12 3 3 6-7"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>'
  };

  /* ---------------- Markdown ---------------- */

  function renderInline(value) {
    let out = esc(value);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    return out;
  }

  function renderMarkdown(body) {
    return String(body || '')
      .split('\n')
      .map((line, index) => {
        const task = line.match(/^\s*(☐|☑)\s?(.*)$/) || line.match(/^\s*-\s*\[([ xX])\]\s?(.*)$/);
        if (task) {
          const checked = task[1] === '☑' || /x/i.test(task[1]);
          return `<div class="preview-task${checked ? ' is-done' : ''}"><button class="preview-check${
            checked ? ' is-checked' : ''
          }" data-task-line="${index}" aria-label="${checked ? '标记为未完成' : '标记为完成'}"></button><span class="preview-task-copy">${renderInline(
            task[2] || ''
          )}</span></div>`;
        }
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading) return `<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`;
        const list = line.match(/^\s*[-*+]\s+(.*)$/);
        if (list)
          return `<div class="preview-list-item"><span class="preview-list-dot"></span><span>${renderInline(list[1])}</span></div>`;
        const quote = line.match(/^>\s?(.*)$/);
        if (quote) return `<blockquote>${renderInline(quote[1])}</blockquote>`;
        return `<div class="preview-paragraph">${renderInline(line)}</div>`;
      })
      .join('');
  }

  /* ---------------- 便签栏 ---------------- */

  function createDock(scene, noteCount, options = {}) {
    const mountDelay = options.mountDelay ?? 0.2;

    const rail = document.createElement('aside');
    rail.className = 'dock-rail';
    rail.setAttribute('aria-label', '便签栏');
    rail.innerHTML = `
      <div class="note-list-shell"><div class="note-list"></div></div>
      <div class="rail-controls">
        <span class="separator" role="separator"></span>
        <button class="adaptive-control" data-control="add" type="button" aria-label="新建便签" title="新建便签">${ICON.plus}</button>
        <button class="adaptive-control" data-control="settings" type="button" aria-label="把便签栏换到屏幕另一侧" title="换到另一侧">${ICON.gear}</button>
      </div>`;

    const panel = document.createElement('article');
    panel.className = 'note-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="panel-toolbar">
        <h3 class="panel-title"></h3><span>Markdown</span>
        <button class="panel-close" type="button" aria-label="关闭便签">${ICON.close}</button>
      </div>
      <div class="panel-preview"><div class="panel-body"></div></div>`;

    const backdrop = document.createElement('div');
    backdrop.className = 'create-backdrop';
    backdrop.innerHTML = `
      <section class="create-dialog" role="dialog" aria-modal="true" aria-label="新建便签">
        <header class="create-bar">
          <div class="create-label"><b>新便签</b><span class="autosave-status" data-state="idle">自动保存</span></div>
          <div class="color-palette"></div>
          <button class="panel-close" type="button" aria-label="关闭">${ICON.close}</button>
        </header>
        <input class="create-title" maxlength="28" placeholder="标题" aria-label="便签标题" />
        <textarea class="create-body" placeholder="写点什么… 支持 Markdown" aria-label="便签内容"></textarea>
        <footer class="markdown-bar">
          <div class="format-tools">
            <button class="format-btn" type="button" data-format="task" title="勾选事项">${ICON.task}</button>
            <button class="format-btn" type="button" data-format="heading" title="标题">H</button>
            <button class="format-btn" type="button" data-format="list" title="列表">${ICON.list}</button>
          </div>
          <span class="markdown-hint">停止输入后自动保存</span>
        </footer>
      </section>`;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    scene.append(rail, panel, backdrop, toast);

    const noteList = rail.querySelector('.note-list');
    const railControls = rail.querySelector('.rail-controls');
    const addButton = rail.querySelector('[data-control="add"]');
    const settingsButton = rail.querySelector('[data-control="settings"]');
    const palette = backdrop.querySelector('.color-palette');
    const titleInput = backdrop.querySelector('.create-title');
    const bodyInput = backdrop.querySelector('.create-body');
    const autosave = backdrop.querySelector('.autosave-status');

    SWATCHES.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `color-swatch${index === 0 ? ' is-selected' : ''}`;
      swatch.dataset.color = color;
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('aria-label', `便签颜色 ${color}`);
      palette.appendChild(swatch);
    });

    const items = [];
    const quickSetters = new Map();
    const hoverTimers = new Map();
    let side = 'right';
    let activeNote = null;
    let actionNote = null;
    let peekNote = null;
    let controlsVisible = false;
    let panelOpen = false;
    let createOpen = false;
    let selectedColor = SWATCHES[0];
    let controlsTl = null;
    let panelTl = null;
    let controlsHideTimer = null;
    let autoTimer = null;
    let autoIndex = 0;
    let userEngaged = false;
    let toastTimer = null;
    let autosaveTimer = null;
    let mounted = false;
    let sortable = null;
    let sorting = false;
    let dragEndedAt = 0;
    let reorderToggle = false;

    const inward = () => (side === 'left' ? 1 : -1);
    const peek = () => (Number.parseFloat(getComputedStyle(scene).getPropertyValue('--rail')) || 104) / 104;
    const tabOf = (note) => items.find((tab) => tab._note === note);

    /* 列表高度：与 dockLayout() 同一套算法 */
    const step = 126 + 2 - 16;
    scene.style.setProperty('--list-target', `${28 + 126 + (Math.max(1, noteCount) - 1) * step}px`);

    function setupQuickSetters() {
      quickSetters.clear();
      const tabs = [...noteList.querySelectorAll('.note-tab')];
      if (gsap) {
        const duration = reduceMotion ? 0 : 0.34;
        tabs.forEach((item) => {
          quickSetters.set(item, {
            x: gsap.quickTo(item, 'x', { duration, ease: 'power3.out' }),
            scaleX: gsap.quickTo(item, 'scaleX', { duration, ease: 'power3.out' }),
            scaleY: gsap.quickTo(item, 'scaleY', { duration, ease: 'power3.out' })
          });
        });
        return;
      }
      tabs.forEach((item) => {
        const s = { x: 0, sx: 1, sy: 1 };
        const apply = () => {
          item.style.transform = `translateX(${s.x}px) scale(${s.sx}, ${s.sy})`;
        };
        quickSetters.set(item, {
          x: (v) => { s.x = v; apply(); },
          scaleX: (v) => { s.sx = v; apply(); },
          scaleY: (v) => { s.sy = v; apply(); }
        });
      });
    }

    function displayTitle(title) {
      const chars = Array.from(title);
      return chars.length > 5 ? `${chars.slice(0, 5).join('')}…` : title;
    }

    function addNote(note, atTop = false) {
      const item = document.createElement('div');
      item.className = 'note-tab';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `打开${note.title}`);
      item.innerHTML = `
        <span class="paper" style="--paper:${note.color}">
          <span class="title">${esc(displayTitle(note.title))}</span>
          <span class="quick-actions">
            <button type="button" data-action="archive" title="归档" aria-label="归档">${ICON.archive}</button>
            <button type="button" data-action="delete" title="删除" aria-label="删除">${ICON.trash}</button>
          </span>
        </span>`;
      item._note = note;
      if (atTop) noteList.prepend(item);
      else noteList.appendChild(item);
      items.splice(atTop ? 0 : items.length, 0, item);

      item.addEventListener('pointerenter', () => beginHover(note));
      item.addEventListener('pointerleave', () => endHover(note));
      item.addEventListener('click', (event) => {
        if (event.target.closest('.quick-actions')) return;
        // 排序刚结束时的 click 不当作打开，和项目里 160ms 的判定一致
        if (sorting || Date.now() - dragEndedAt < 160) return;
        stopAuto();
        openNote(note);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openNote(note);
      });
      item.querySelectorAll('.quick-actions button').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          showToast(button.dataset.action === 'archive' ? `“${note.title}”已归档` : `“${note.title}”已移到废纸篓`);
        });
      });
      setupQuickSetters();
      return item;
    }

    /* --- 距离驱动放大（对齐 onRailMove） --- */

    rail.addEventListener('pointermove', (event) => {
      if (sorting) return;
      showControls();
      const direction = inward();
      const k = peek();
      const hovered = event.target.closest('.note-tab');
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
        const influence = clamp(0, 1, 1 - distance / (132 * k));
        const scale = 1 + influence * 0.14;
        let x = mapRange(0, 1, 0, 24 * k * direction, influence);
        if (item._note === activeNote) x += 20 * k * direction;
        if (item === hovered) {
          x = mapRange(0, 1, 0, 4 * k * direction, influence);
          x += (actionNote === item._note ? 42 : 20) * k * direction;
        }
        const setter = quickSetters.get(item);
        if (setter) {
          setter.scaleX(scale);
          setter.scaleY(scale);
          setter.x(x);
        }
        if (distance < nearestDistance) {
          nearest = item;
          nearestDistance = distance;
        }
      });
      items.forEach((item) =>
        item.classList.toggle('nearest', item === nearest && nearestDistance < 58 * k)
      );
    });

    rail.addEventListener('pointerleave', () => {
      resetRail();
      window.clearTimeout(controlsHideTimer);
      controlsHideTimer = window.setTimeout(() => hideControls(), 1200);
    });
    noteList.addEventListener('pointerenter', showControls);

    function resetRail() {
      actionNote = null;
      peekNote = null;
      items.forEach((item) => {
        item.classList.remove('nearest', 'actions');
        const setter = quickSetters.get(item);
        if (!setter) return;
        setter.scaleX(1);
        setter.scaleY(1);
        setter.x(item._note === activeNote ? 20 * peek() * inward() : 0);
      });
    }

    function beginHover(note) {
      window.clearTimeout(hoverTimers.get(note.title));
      stopAuto();
      markEngaged();
      peekNote = note;
      const item = tabOf(note);
      if (item) quickSetters.get(item)?.x(20 * peek() * inward());
      hoverTimers.set(
        note.title,
        window.setTimeout(() => {
          if (peekNote !== note) return;
          actionNote = note;
          const current = tabOf(note);
          if (current) {
            current.classList.add('actions');
            quickSetters.get(current)?.x(42 * peek() * inward());
          }
        }, 1000)
      );
    }

    function endHover(note) {
      window.clearTimeout(hoverTimers.get(note.title));
      if (peekNote === note) peekNote = null;
      if (actionNote === note) actionNote = null;
      const item = tabOf(note);
      if (item) {
        item.classList.remove('actions');
        quickSetters.get(item)?.x(note === activeNote ? 20 * peek() * inward() : 0);
      }
    }

    /* --- 控制按钮入场（对齐 buildControlsTimeline） --- */

    function buildControlsTimeline() {
      const actions = [...railControls.querySelectorAll('button')];
      controlsTl?.kill();
      gsap.killTweensOf([railControls, ...actions]);
      const duration = reduceMotion ? 0 : 0.42;
      controlsTl = gsap
        .timeline({ paused: true, defaults: { overwrite: 'auto' } })
        .fromTo(railControls, { autoAlpha: 0, x: 18 * -inward() }, { autoAlpha: 1, x: 0, duration: duration * 0.55, ease: 'power2.out' }, 0)
        .fromTo(
          actions,
          { autoAlpha: 0, y: -30, scale: 0.76 },
          { autoAlpha: 1, y: 0, scale: 1, duration, stagger: reduceMotion ? 0 : 0.12, ease: 'back.out(1.9)' },
          reduceMotion ? 0 : 0.08
        );
    }

    function showControls() {
      window.clearTimeout(controlsHideTimer);
      if (controlsVisible) return;
      controlsVisible = true;
      rail.classList.add('controls-visible');
      if (!gsap) return;
      if (!controlsTl) buildControlsTimeline();
      controlsTl.play();
    }

    function hideControls() {
      window.clearTimeout(controlsHideTimer);
      controlsVisible = false;
      rail.classList.remove('controls-visible');
      if (!gsap) return;
      controlsTl?.reverse();
    }

    /* --- 卡片入场 / 退场（对齐 playPanelEntrance / playPanelExit） --- */

    function playPanelEntrance() {
      if (!gsap) {
        panel.style.opacity = '1';
        panel.style.visibility = 'visible';
        return;
      }
      panelTl?.kill();
      gsap.killTweensOf(panel);
      if (reduceMotion) {
        gsap.set(panel, { clearProps: 'transform', autoAlpha: 1 });
        return;
      }
      const direction = inward();
      gsap.set(panel, {
        x: -(panel.offsetWidth + 128) * direction,
        rotation: -9 * direction,
        autoAlpha: 0,
        transformOrigin: side === 'left' ? 'left 42%' : 'right 42%'
      });
      panelTl = gsap
        .timeline({ defaults: { overwrite: 'auto' } })
        .set(panel, { autoAlpha: 1 })
        .to(panel, { x: 12 * direction, rotation: 2.2 * direction, duration: 0.56, ease: 'power3.out' })
        .to(panel, { x: 0, rotation: 0, duration: 0.3, ease: 'back.out(1.7)' });
    }

    function playPanelExit(onDone) {
      if (!gsap || reduceMotion) {
        panel.style.opacity = '0';
        panel.style.visibility = 'hidden';
        onDone?.();
        return;
      }
      panelTl?.kill();
      gsap.killTweensOf(panel);
      gsap.to(panel, {
        autoAlpha: 0,
        x: 42 * -inward(),
        rotation: 2.5 * -inward(),
        duration: 0.2,
        ease: 'power2.in',
        onComplete: onDone
      });
    }

    function openNote(note) {
      markEngaged();
      activeNote = note;
      items.forEach((item) => {
        const isActive = item._note === note;
        item.classList.toggle('active', isActive);
        quickSetters.get(item)?.x(isActive ? 20 * peek() * inward() : 0);
      });
      panel.querySelector('.panel-title').textContent = note.title;
      panel.querySelector('.panel-body').innerHTML = renderMarkdown(note.body);
      panel.style.setProperty('--panel-paper', note.color);
      panel.setAttribute('aria-hidden', 'false');
      panelOpen = true;
      scene.classList.add('has-open-note');
      playPanelEntrance();
    }

    function closePanel() {
      if (!panelOpen) return;
      panelOpen = false;
      scene.classList.remove('has-open-note');
      panel.setAttribute('aria-hidden', 'true');
      activeNote = null;
      items.forEach((item) => {
        item.classList.remove('active');
        quickSetters.get(item)?.x(0);
      });
      playPanelExit();
    }

    panel.querySelector('.panel-close').addEventListener('click', closePanel);
    panel.querySelector('.panel-body').addEventListener('click', (event) => {
      const checkbox = event.target.closest('[data-task-line]');
      if (!checkbox || !activeNote) return;
      const index = Number(checkbox.dataset.taskLine);
      const lines = (activeNote.body || '').split('\n');
      if (/^\s*☐/.test(lines[index])) lines[index] = lines[index].replace('☐', '☑');
      else if (/^\s*☑/.test(lines[index])) lines[index] = lines[index].replace('☑', '☐');
      else if (/^\s*-\s*\[\s\]/.test(lines[index])) lines[index] = lines[index].replace(/\[\s\]/, '[x]');
      else lines[index] = lines[index].replace(/\[[xX]\]/, '[ ]');
      activeNote.body = lines.join('\n');
      panel.querySelector('.panel-body').innerHTML = renderMarkdown(activeNote.body);
    });

    /* --- 新建便签 --- */

    function setAutosave(state) {
      const labels = { idle: '自动保存', typing: '自动保存中…', saving: '自动保存中…', saved: '已自动保存' };
      autosave.dataset.state = state;
      autosave.textContent = labels[state];
    }

    function scheduleAutosave() {
      setAutosave('saving');
      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(() => setAutosave('saved'), 700);
    }

    function openCreate() {
      stopAuto();
      markEngaged();
      closePanel();
      createOpen = true;
      titleInput.value = '';
      bodyInput.value = '';
      selectedColor = SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
      palette.querySelectorAll('.color-swatch').forEach((s) => s.classList.toggle('is-selected', s.dataset.color === selectedColor));
      backdrop.querySelector('.create-dialog').style.setProperty('--create-paper', selectedColor);
      setAutosave('idle');
      backdrop.classList.add('is-open');
      addButton.classList.add('selected');
      if (gsap && !reduceMotion) {
        gsap.fromTo(
          backdrop.querySelector('.create-dialog'),
          { x: 34 * -inward(), autoAlpha: 0, scale: 0.9 },
          { x: 0, autoAlpha: 1, scale: 1, duration: 0.46, ease: 'back.out(1.22)' }
        );
      }
      window.setTimeout(() => titleInput.focus(), 180);
    }

    function closeCreate() {
      if (!createOpen) return;
      createOpen = false;
      window.clearTimeout(autosaveTimer);
      backdrop.classList.remove('is-open');
      addButton.classList.remove('selected');
    }

    function saveDraft() {
      const body = bodyInput.value.trim();
      const title = titleInput.value.trim() || body.split('\n').find((l) => l.trim()) || '未命名便签';
      if (!titleInput.value.trim() && !body) {
        closeCreate();
        return;
      }
      const note = { title: title.slice(0, 28), body, color: selectedColor };
      addNote(note, true);
      closeCreate();
      openNote(note);
      showToast(`“${note.title}”已保存`);
    }

    palette.addEventListener('click', (event) => {
      const swatch = event.target.closest('.color-swatch');
      if (!swatch) return;
      selectedColor = swatch.dataset.color;
      palette.querySelectorAll('.color-swatch').forEach((s) => s.classList.toggle('is-selected', s === swatch));
      backdrop.querySelector('.create-dialog').style.setProperty('--create-paper', selectedColor);
    });

    titleInput.addEventListener('input', scheduleAutosave);
    bodyInput.addEventListener('input', scheduleAutosave);
    backdrop.querySelector('.panel-close').addEventListener('click', saveDraft);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) saveDraft();
    });
    backdrop.querySelectorAll('[data-format]').forEach((button) => {
      button.addEventListener('click', () => {
        const prefix = button.dataset.format === 'task' ? '- [ ] ' : button.dataset.format === 'heading' ? '## ' : '- ';
        const start = bodyInput.selectionStart;
        const value = bodyInput.value;
        const needsBreak = start > 0 && value[start - 1] !== '\n';
        const insert = `${needsBreak ? '\n' : ''}${prefix}`;
        bodyInput.value = value.slice(0, start) + insert + value.slice(bodyInput.selectionEnd);
        bodyInput.focus();
        bodyInput.selectionStart = bodyInput.selectionEnd = start + insert.length;
        scheduleAutosave();
      });
    });

    /* --- 控制按钮 --- */

    addButton.addEventListener('click', openCreate);

    // 项目里换边是偏好设置项（已无拖拽），这里让设置按钮演示一次平滑换边。
    settingsButton.addEventListener('click', () => {
      stopAuto();
      markEngaged();
      const before = rail.getBoundingClientRect();
      side = side === 'right' ? 'left' : 'right';
      scene.classList.toggle('dock-left', side === 'left');
      const after = rail.getBoundingClientRect();
      if (gsap && !reduceMotion) {
        gsap.fromTo(rail, { x: before.left - after.left }, { x: 0, duration: 0.52, ease: 'power3.out' });
      }
      controlsTl = null;
      buildControlsTimelineSafe();
      resetRail();
      closePanel();
      showToast(side === 'left' ? '便签栏已吸附到左侧' : '便签栏已吸附到右侧');
    });

    function buildControlsTimelineSafe() {
      if (!gsap) return;
      buildControlsTimeline();
      if (controlsVisible) controlsTl.play();
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (createOpen) saveDraft();
      else if (panelOpen) closePanel();
    });

    /* --- Toast --- */

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('is-open');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('is-open'), 1800);
    }

    /* --- 自动演示 --- */

    function magnify(index) {
      const target = items[clamp(0, items.length - 1, index)];
      if (!target) return;
      const direction = inward();
      const k = peek();
      items.forEach((item, i) => {
        const distance = Math.abs(i - items.indexOf(target));
        const influence = clamp(0, 1, 1 - distance / 1.6);
        const setter = quickSetters.get(item);
        if (setter) {
          setter.scaleX(1 + influence * 0.14);
          setter.scaleY(1 + influence * 0.14);
          setter.x(item === target ? 20 * k * direction : 22 * k * direction * influence * 0.9);
        }
        item.classList.toggle('nearest', item === target);
      });
      showControls();
    }

    function startAuto() {
      if (reduceMotion || userEngaged || autoTimer) return;
      // A single hint, after entrance; no endless movement or competing tweens.
      autoTimer = window.setTimeout(() => {
        autoTimer = null;
        if (!userEngaged && !panelOpen) magnify(autoIndex);
      }, 1800);
    }

    function stopAuto() {
      if (!autoTimer) return;
      window.clearInterval(autoTimer);
      autoTimer = null;
    }

    function markEngaged() {
      if (userEngaged) return;
      userEngaged = true;
      stopAuto();
      const hint = scene.querySelector('[data-scene-hint]');
      if (hint) hint.classList.add('is-hidden');
    }

    scene.addEventListener('pointerleave', () => {
      if (!userEngaged) return;
      resetRail();
    });

    /* --- 拖拽排序（对齐 createNoteSortable 的参数） --- */

    function syncItemsFromDom() {
      items.length = 0;
      noteList.querySelectorAll('.note-tab').forEach((tab) => items.push(tab));
    }

    function setupSortable() {
      const Sortable = window.Sortable;
      if (!Sortable || sortable || items.length < 2) return;
      sortable = Sortable.create(noteList, {
        draggable: '.note-tab',
        delay: 240,
        delayOnTouchOnly: false,
        touchStartThreshold: 4,
        fallbackTolerance: 4,
        forceFallback: true,
        fallbackOnBody: false,
        animation: reduceMotion ? 0 : 230,
        easing: 'cubic-bezier(.22,1,.36,1)',
        filter: "button,a,input,textarea,select,[contenteditable='true']",
        preventOnFilter: false,
        ghostClass: 'note-sort-ghost',
        chosenClass: 'note-sort-chosen',
        dragClass: 'note-sort-drag',
        onStart() {
          sorting = true;
          actionNote = null;
          peekNote = null;
          stopAuto();
          hoverTimers.forEach((timer) => window.clearTimeout(timer));
          const tabs = [...noteList.querySelectorAll('.note-tab')];
          if (gsap) {
            gsap.killTweensOf(tabs);
            gsap.set(tabs, { clearProps: 'transform' });
          } else {
            tabs.forEach((tab) => (tab.style.transform = ''));
          }
          quickSetters.clear();
          noteList.classList.add('sorting');
        },
        onEnd(event) {
          sorting = false;
          noteList.classList.remove('sorting');
          dragEndedAt = Date.now();
          syncItemsFromDom();
          setupQuickSetters();
          resetRail();
          if (event.oldIndex === undefined || event.newIndex === undefined) return;
          if (event.oldIndex !== event.newIndex) showToast('便签顺序已保存');
        },
        onCancel() {
          sorting = false;
          noteList.classList.remove('sorting');
          setupQuickSetters();
        }
      });
    }

    /** 步骤 04 的演示：用 FLIP 把一张便签移到新位置 */
    function reorderDemo() {
      if (items.length < 3) return;
      const from = reorderToggle ? 2 : 0;
      const to = reorderToggle ? 0 : 2;
      reorderToggle = !reorderToggle;

      const before = new Map();
      [...noteList.querySelectorAll('.note-tab')].forEach((tab) => before.set(tab, tab.getBoundingClientRect().top));

      const tabs = [...noteList.querySelectorAll('.note-tab')];
      const moved = tabs[from];
      const anchor = tabs[to];
      noteList.insertBefore(moved, from < to ? anchor.nextSibling : anchor);

      syncItemsFromDom();
      setupQuickSetters();
      moved.classList.add('note-sort-chosen');

      if (gsap && !reduceMotion) {
        items.forEach((tab) => {
          const delta = (before.get(tab) ?? 0) - tab.getBoundingClientRect().top;
          if (Math.abs(delta) < 1) return;
          gsap.fromTo(tab, { y: delta }, { y: 0, duration: 0.52, ease: 'power3.out' });
        });
      }
      window.setTimeout(() => moved.classList.remove('note-sort-chosen'), 820);
      showToast('便签顺序已保存');
    }

    /* --- 挂载动画（对齐 DockView 的 gsap.context / matchMedia） --- */

    function mount() {
      if (mounted) return;
      mounted = true;
      if (!gsap || reduceMotion) {
        showControls();
        return;
      }
      gsap
        .timeline()
        .from(rail, { x: 80, autoAlpha: 0, duration: 0.8, delay: mountDelay, ease: 'back.out(1.2)' })
        .from(noteList.querySelectorAll('.note-tab'), { x: 24, autoAlpha: 0, duration: 0.45, stagger: 0.045, ease: 'power3.out' }, `-=0.42`)
        .from(railControls.querySelectorAll('button'), { autoAlpha: 0, scale: 0.6, duration: 0.4, stagger: 0.1, ease: 'back.out(1.7)' }, '-=0.3')
        .add(() => showControls());
    }

    NOTES.slice(0, noteCount).forEach((note) => addNote({ ...note }));
    setupSortable();

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              mount();
              startAuto();
            } else {
              stopAuto();
              resetRail();
            }
          });
        },
        { threshold: 0.3 }
      );
      io.observe(scene);
    } else {
      mount();
      startAuto();
    }

    return {
      magnify,
      revealActions(index) {
        const item = items[clamp(1, items.length - 1, index)];
        if (!item) return;
        stopAuto();
        magnify(items.indexOf(item));
        actionNote = item._note;
        item.classList.add('actions');
        quickSetters.get(item)?.x(42 * peek() * inward());
      },
      openNote(index) {
        const item = items[clamp(0, items.length - 1, index)];
        stopAuto();
        if (item) openNote(item._note);
      },
      flip() {
        stopAuto();
        settingsButton.click();
      },
      reorder() {
        stopAuto();
        reorderDemo();
      },
      reset() {
        markEngaged();
        resetRail();
        closePanel();
        closeCreate();
      }
    };
  }

  /* ---------------- 挂载 ---------------- */

  const dockApis = [];
  document.querySelectorAll('[data-dock-mount]').forEach((scene) => {
    const count = Number(scene.dataset.notes) || NOTES.length;
    const isHero = scene.closest('.hero') !== null;
    dockApis.push(createDock(scene, count, { mountDelay: isHero ? 0.62 : 0.15 }));
  });

  /* ---------------- 交互步骤演示 ---------------- */

  const stepList = document.querySelector('[data-steps]');
  if (stepList && dockApis.length > 1) {
    const demo = dockApis[1];
    const steps = [...stepList.querySelectorAll('.step')];
    let stepTimer = null;
    const placeSelection = (animate = false) => {
      const active = stepList.querySelector('.is-active');
      if (!active) return;
      const y = `${active.offsetTop}px`;
      if (gsap && animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to(stepList, { '--step-y': y, duration: .38, ease: 'power3.out', overwrite: true });
      } else {
        if (gsap) gsap.killTweensOf(stepList);
        stepList.style.setProperty('--step-y', y);
      }
    };
    if ('ResizeObserver' in window) new ResizeObserver(() => placeSelection()).observe(stepList);
    else window.addEventListener('resize', () => placeSelection(), { passive: true });
    document.fonts?.ready.then(() => placeSelection());

    const run = (name) => {
      window.clearTimeout(stepTimer);
      demo.reset();
      const captions = { magnify: ['01 / 靠近', '把指针移向右侧便签，感受距离带来的变化。'], actions: ['02 / 停留', '停留片刻，归档与删除出现在纸边。'], panel: ['03 / 展开', '点击纸边展开内容；也可以试着勾选任务。'], reorder: ['04 / 排序', '按住纸边再上下拖动，让常用便签更顺手。'] };
      document.querySelector('[data-demo-state]').textContent = captions[name][0];
      document.querySelector('[data-demo-caption]').textContent = captions[name][1];
      if (name === 'magnify') demo.magnify(1);
      if (name === 'actions') demo.revealActions(1);
      if (name === 'panel') stepTimer = window.setTimeout(() => demo.openNote(1), 140);
      if (name === 'reorder') stepTimer = window.setTimeout(() => demo.reorder(), 140);
    };

    steps.forEach((step) => {
      step.querySelector('button').addEventListener('click', () => {
        steps.forEach((other) => {
          other.classList.toggle('is-active', other === step);
          other.querySelector('button').setAttribute('aria-pressed', String(other === step));
        });
        placeSelection(true);
        run(step.dataset.demo);
      });
      step.querySelector('button').addEventListener('keydown', (event) => {
        const index = steps.indexOf(step);
        const destinations = { ArrowDown: (index + 1) % steps.length, ArrowUp: (index + steps.length - 1) % steps.length, Home: 0, End: steps.length - 1 };
        if (!(event.key in destinations)) return;
        event.preventDefault();
        const button = steps[destinations[event.key]].querySelector('button');
        button.focus({ preventScroll: true });
        button.click();
      });
    });

    steps.forEach((step, i) => step.querySelector('button').setAttribute('aria-pressed', String(i === 0)));
    placeSelection();
    run('magnify');
  }
})();
