<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

import { useAppStore } from "../../app/stores/app";

type SectionId = "general" | "shortcuts" | "dock" | "notes" | "privacy" | "updates";

type Shortcut = {
  id: string;
  label: string;
  description: string;
  keys: string[];
};

const app = useAppStore();
const activeSection = ref<SectionId>("general");
const toast = ref("");
const recordingShortcut = ref<string | null>(null);
let toastTimer: number | undefined;

const settings = reactive({
  language: "zh-CN",
  launchAtLogin: false,
  dockSide: "right",
  verticalPosition: 52,
  dockSize: "medium",
  hoverAnimation: true,
  actionDelay: 1,
  fullscreenBehavior: "hide",
  displayPreference: "cursor",
  font: "system",
  fontSize: 16,
  textDirection: "automatic",
  markdown: true,
  defaultColor: "random",
  automaticUpdates: true,
});

const shortcuts = ref<Shortcut[]>([
  { id: "dock", label: "显示 / 隐藏 Dock", description: "在当前屏幕边缘召出便签栏", keys: ["Ctrl", "Alt", "N"] },
  { id: "new", label: "新建便签", description: "创建便签并直接进入编辑", keys: ["Ctrl", "Alt", "⇧", "N"] },
  { id: "capture", label: "Quick Capture", description: "在当前应用上方快速记录", keys: ["Ctrl", "Alt", "Space"] },
  { id: "all", label: "All Notes", description: "打开全部便签资料库", keys: ["Ctrl", "Alt", "L"] },
  { id: "archive", label: "Archive", description: "打开已归档便签", keys: ["Ctrl", "Alt", "A"] },
]);

const sections: Array<{ id: SectionId; label: string; caption: string }> = [
  { id: "general", label: "通用", caption: "启动与窗口" },
  { id: "shortcuts", label: "快捷键", caption: "全局操作" },
  { id: "dock", label: "便签栏", caption: "位置与行为" },
  { id: "notes", label: "便签", caption: "编辑与外观" },
  { id: "privacy", label: "数据与隐私", caption: "本地存储" },
  { id: "updates", label: "更新", caption: "版本与发布" },
];

const activeMeta = computed(() => sections.find((section) => section.id === activeSection.value)!);

const colors = [
  { id: "lemon", name: "Lemon", hex: "#FFE57A" },
  { id: "peach", name: "Peach", hex: "#FFB8A7" },
  { id: "rose", name: "Rose", hex: "#F5B8CD" },
  { id: "lilac", name: "Lilac", hex: "#D8C1FF" },
  { id: "sky", name: "Sky", hex: "#AED6FF" },
  { id: "mint", name: "Mint", hex: "#A9E5D1" },
];

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2400);
}

function chooseSection(id: SectionId) {
  activeSection.value = id;
  recordingShortcut.value = null;
}

async function openDockWindow() {
  try {
    const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
    const dock = (await getAllWebviewWindows()).find((window) => window.label === "dock");
    await dock?.show();
    showToast("便签栏已显示");
  } catch {
    showToast("浏览器预览中可通过 /#/dock 查看便签栏");
  }
}

function startShortcutRecording(id: string) {
  recordingShortcut.value = recordingShortcut.value === id ? null : id;
  if (recordingShortcut.value) showToast("请按下新的快捷键组合");
}

function resetShortcuts() {
  shortcuts.value = [
    { id: "dock", label: "显示 / 隐藏 Dock", description: "在当前屏幕边缘召出便签栏", keys: ["Ctrl", "Alt", "N"] },
    { id: "new", label: "新建便签", description: "创建便签并直接进入编辑", keys: ["Ctrl", "Alt", "⇧", "N"] },
    { id: "capture", label: "Quick Capture", description: "在当前应用上方快速记录", keys: ["Ctrl", "Alt", "Space"] },
    { id: "all", label: "All Notes", description: "打开全部便签资料库", keys: ["Ctrl", "Alt", "L"] },
    { id: "archive", label: "Archive", description: "打开已归档便签", keys: ["Ctrl", "Alt", "A"] },
  ];
  showToast("已恢复 Windows 默认快捷键");
}

onMounted(() => app.initialize());
</script>

<template>
  <main class="settings-app">
    <aside class="sidebar" aria-label="设置分类">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><strong>Noty</strong><small>贴在手边</small></div>
      </div>

      <nav class="settings-nav">
        <button
          v-for="section in sections"
          :key="section.id"
          class="nav-item"
          :class="{ active: activeSection === section.id }"
          type="button"
          :aria-current="activeSection === section.id ? 'page' : undefined"
          @click="chooseSection(section.id)"
        >
          <svg v-if="section.id === 'general'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.5 1.6H9.5A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 13.5v-3A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10.5 3h3A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1.5v3a1.7 1.7 0 0 0-1.6 1.5Z"/></svg>
          <svg v-else-if="section.id === 'shortcuts'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h2M7 14h7M17 14h.01"/></svg>
          <svg v-else-if="section.id === 'dock'" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M15 7h1M15 11h1M15 15h1"/></svg>
          <svg v-else-if="section.id === 'notes'" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg>
          <svg v-else-if="section.id === 'privacy'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>
          <span><b>{{ section.label }}</b><small>{{ section.caption }}</small></span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="library-link" @click="showToast('资料库将在下一阶段接入')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v14H4zM14 5h6v14h-6z"/></svg>
          <span>打开资料库</span><kbd>Ctrl Alt L</kbd>
        </button>
        <div class="runtime-state" :class="{ ready: app.ready, error: app.error }">
          <span class="runtime-dot"></span>
          <span v-if="app.loading">正在连接本地数据…</span>
          <span v-else-if="app.error">界面预览模式</span>
          <span v-else>本地数据已就绪</span>
        </div>
      </div>
    </aside>

    <section class="settings-main">
      <header class="content-header">
        <div>
          <p>SETTINGS</p>
          <h1>{{ activeMeta.label }}</h1>
        </div>
        <button class="dock-launch" type="button" @click="openDockWindow">
          <span class="dock-launch-icon" aria-hidden="true"><i></i><i></i><i></i></span>
          显示便签栏
          <kbd>Ctrl Alt N</kbd>
        </button>
      </header>

      <div class="content-scroll">
        <div v-if="activeSection === 'general'" class="settings-page">
          <section class="settings-group">
            <div class="group-heading"><div><h2>外观与语言</h2><p>选择 Noty 界面的显示方式。</p></div></div>
            <div class="setting-row">
              <div class="setting-copy"><b>界面语言</b><span>更改后会即时应用到所有窗口</span></div>
              <select v-model="settings.language" aria-label="界面语言"><option value="zh-CN">简体中文</option><option value="en-US">English</option><option value="ja-JP">日本語</option></select>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>颜色主题</b><span>Noty 会跟随系统浅色或深色模式</span></div>
              <div class="segmented"><button class="selected" type="button">跟随系统</button><button type="button" disabled>浅色</button><button type="button" disabled>深色</button></div>
            </div>
          </section>

          <section class="settings-group">
            <div class="group-heading"><div><h2>启动与关闭</h2><p>控制 Noty 在系统中的运行方式。</p></div></div>
            <label class="setting-row clickable">
              <div class="setting-copy"><b>登录时启动 Noty</b><span>静默驻留系统托盘，不主动打开窗口</span></div>
              <input v-model="settings.launchAtLogin" class="switch-input" type="checkbox"><span class="switch" aria-hidden="true"></span>
            </label>
            <div class="setting-row">
              <div class="setting-copy"><b>关闭主窗口时</b><span>同时关闭便签栏并退出 Noty</span></div>
              <div class="segmented"><button class="selected" type="button">退出 Noty</button></div>
            </div>
          </section>

          <section class="settings-group compact">
            <div class="setting-row">
              <div class="setting-copy"><b>首次使用引导</b><span>重新查看便签栏、快捷键和隐私说明</span></div>
              <button class="secondary-button" type="button" @click="showToast('已准备重新运行首次引导')">重新运行引导</button>
            </div>
          </section>
        </div>

        <div v-else-if="activeSection === 'shortcuts'" class="settings-page">
          <div class="page-intro"><p>快捷键在任意应用中生效。点击组合键后，直接按下新的按键组合。</p><button class="text-button" type="button" @click="resetShortcuts">恢复默认值</button></div>
          <section class="settings-group shortcuts-card">
            <div v-for="shortcut in shortcuts" :key="shortcut.id" class="shortcut-row">
              <div class="setting-copy"><b>{{ shortcut.label }}</b><span>{{ shortcut.description }}</span></div>
              <button class="key-recorder" :class="{ recording: recordingShortcut === shortcut.id }" type="button" @click="startShortcutRecording(shortcut.id)">
                <template v-if="recordingShortcut === shortcut.id"><span class="recording-dot"></span>请按快捷键</template>
                <template v-else><kbd v-for="key in shortcut.keys" :key="key">{{ key }}</kbd></template>
              </button>
            </div>
          </section>
          <div class="notice"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><p><b>冲突会被即时拦截</b><span>若系统或其他应用已占用组合键，Noty 会保留原快捷键并说明原因。</span></p></div>
        </div>

        <div v-else-if="activeSection === 'dock'" class="settings-page dock-page">
          <section class="dock-preview-card">
            <div class="preview-copy"><span>实时预览</span><h2>让便签栏待在<br>最顺手的位置。</h2><p>它会贴附在屏幕边缘，悬停时安静展开。</p></div>
            <div class="mini-screen" :class="`side-${settings.dockSide}`">
              <div class="mini-wallpaper"></div><div class="mini-dock"><i style="--paper:#FFE57A">今</i><i style="--paper:#FFB8A7">待</i><i style="--paper:#A9E5D1">读</i><span>＋</span></div>
            </div>
          </section>
          <section class="settings-group">
            <div class="setting-row">
              <div class="setting-copy"><b>屏幕边缘</b><span>拖动便签栏后也会自动更新</span></div>
              <div class="segmented"><button :class="{ selected: settings.dockSide === 'left' }" type="button" @click="settings.dockSide = 'left'">左侧</button><button :class="{ selected: settings.dockSide === 'right' }" type="button" @click="settings.dockSide = 'right'">右侧</button></div>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>垂直位置</b><span>{{ settings.verticalPosition }}% · 以屏幕工作区为基准</span></div>
              <input v-model="settings.verticalPosition" class="range" type="range" min="10" max="90" aria-label="便签栏垂直位置">
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>便签栏大小</b><span>不会改变便签正文的字体大小</span></div>
              <select v-model="settings.dockSize"><option value="small">紧凑</option><option value="medium">标准</option><option value="large">宽松</option></select>
            </div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>悬停动画</b><span>按指针距离放大当前便签和相邻便签</span></div><input v-model="settings.hoverAnimation" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row"><div class="setting-copy"><b>快捷操作延迟</b><span>持续悬停后显示归档与删除</span></div><select v-model="settings.actionDelay"><option :value="0.6">0.6 秒</option><option :value="1">1 秒</option><option :value="1.5">1.5 秒</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>全屏应用</b><span>播放视频、演示或游戏时的行为</span></div><select v-model="settings.fullscreenBehavior"><option value="hide">自动隐藏</option><option value="show">保持可见</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>召出时显示器</b><span>多显示器环境中的优先规则</span></div><select v-model="settings.displayPreference"><option value="cursor">鼠标所在屏幕</option><option value="active">活动窗口所在屏幕</option><option value="primary">主显示器</option></select></div>
          </section>
        </div>

        <div v-else-if="activeSection === 'notes'" class="settings-page">
          <section class="settings-group">
            <div class="group-heading"><div><h2>编辑体验</h2><p>设置所有新建和已有便签的阅读体验。</p></div></div>
            <div class="setting-row"><div class="setting-copy"><b>字体</b><span>正文和 Markdown 预览使用的字体</span></div><select v-model="settings.font"><option value="system">系统默认</option><option value="serif">衬线字体</option><option value="mono">等宽字体</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>正文字号</b><span>{{ settings.fontSize }} px</span></div><input v-model="settings.fontSize" class="range short" type="range" min="13" max="22"></div>
            <div class="setting-row"><div class="setting-copy"><b>默认文字方向</b><span>支持 Arabic / Hebrew 基础 RTL</span></div><select v-model="settings.textDirection"><option value="automatic">自动检测</option><option value="ltr">从左到右</option><option value="rtl">从右到左</option></select></div>
            <label class="setting-row clickable"><div class="setting-copy"><b>启用 Markdown</b><span>支持标题、粗体、列表、任务与行内代码</span></div><input v-model="settings.markdown" class="switch-input" type="checkbox"><span class="switch"></span></label>
          </section>
          <section class="settings-group color-settings">
            <div class="group-heading"><div><h2>新便签颜色</h2><p>新建时可继续在编辑器中选择颜色。</p></div></div>
            <label class="color-option"><input v-model="settings.defaultColor" value="random" type="radio"><span class="color-random"><i v-for="color in colors" :key="color.id" :style="{ background: color.hex }"></i></span><div><b>每次随机选择</b><small>在 6 种 Noty 颜色中随机选取</small></div><em>推荐</em></label>
            <div class="color-grid"><label v-for="color in colors" :key="color.id" :class="{ selected: settings.defaultColor === color.id }"><input v-model="settings.defaultColor" :value="color.id" type="radio"><span :style="{ '--note-color': color.hex }"></span><b>{{ color.name }}</b></label></div>
          </section>
        </div>

        <div v-else-if="activeSection === 'privacy'" class="settings-page">
          <div class="privacy-hero"><div class="shield"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg></div><div><span>LOCAL-FIRST</span><h2>你的便签，默认只属于你。</h2><p>正文加密保存在本机。Noty 无账号、无产品遥测，也不会上传你的便签内容。</p></div></div>
          <section class="settings-group">
            <div class="setting-row"><div class="setting-copy path-copy"><b>数据位置</b><span>%APPDATA%\Noty\data</span></div><button class="secondary-button" type="button" @click="showToast('数据目录将在 Tauri 接口接入后打开')">打开文件夹</button></div>
            <div class="privacy-facts"><div><i class="green"></i><p><b>正文</b><span>使用设备密钥加密</span></p></div><div><i class="amber"></i><p><b>标题与元数据</b><span>为检索与排序明文保存</span></p></div><div><i class="blue"></i><p><b>网络</b><span>仅用于可关闭的更新检查</span></p></div></div>
          </section>
          <section class="action-grid">
            <button type="button" @click="showToast('选择要导入的 .stickies、Markdown 或 TXT 文件')"><span class="action-symbol">↘</span><b>导入便签</b><small>.stickies v2、Markdown、TXT</small></button>
            <button type="button" @click="showToast('导出前将提示明文文件风险')"><span class="action-symbol">↗</span><b>导出便签</b><small>兼容文件为明文格式</small></button>
            <button type="button" @click="showToast('完整备份将使用独立密码加密')"><span class="action-symbol">◇</span><b>创建完整备份</b><small>加密的 .notybackup 文件</small></button>
            <button type="button" @click="showToast('诊断包不会包含便签内容')"><span class="action-symbol">···</span><b>生成诊断包</b><small>默认移除内容与个人路径</small></button>
          </section>
          <section class="danger-zone"><div><b>删除所有本地数据</b><span>删除数据库、密钥、备份、日志与启动项。此操作不可撤销。</span></div><button type="button" @click="showToast('需要二次确认后才能删除')">删除数据…</button></section>
        </div>

        <div v-else class="settings-page">
          <section class="update-hero">
            <div class="app-icon"><span></span><span></span><span></span></div>
            <div><p>NOTY DESKTOP</p><h2>当前已是最新版本</h2><span>版本 {{ app.info?.version ?? '0.1.0' }} · Windows x64</span></div>
            <div class="update-check"><i></i>已是最新</div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>自动检查更新</b><span>每天检查一次，不携带便签或设备内容</span></div><input v-model="settings.automaticUpdates" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row"><div class="setting-copy"><b>立即检查</b><span>更新不会在你输入时强制重启应用</span></div><button class="secondary-button" type="button" @click="showToast('正在检查更新…')">检查更新</button></div>
            <div class="setting-row"><div class="setting-copy"><b>发布说明</b><span>查看当前版本的改进和已知问题</span></div><button class="text-button" type="button" @click="showToast('发布说明将在浏览器中打开')">查看发布说明 ↗</button></div>
          </section>
          <div class="notice"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg><p><b>更新包经过签名验证</b><span>Noty 只安装同一发布者签名且版本递增的有效更新包。</span></p></div>
        </div>
      </div>
    </section>

    <Transition name="toast"><div v-if="toast" class="app-toast" role="status"><span>✓</span>{{ toast }}</div></Transition>
  </main>
</template>
