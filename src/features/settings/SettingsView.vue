<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  ArrowLeft,
  Command,
  Keyboard,
  PanelRight,
  RefreshCw,
  Settings2,
  ShieldCheck,
  StickyNote,
  X,
} from "lucide-vue-next";
import { useRouter } from "vue-router";

import { useAppStore } from "../../app/stores/app";
import type { AppSettings } from "../../contracts/app";
import { appService } from "../../services/appService";

type SectionId = "general" | "shortcuts" | "dock" | "notes" | "privacy" | "updates";

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ close: [] }>();

type Shortcut = {
  id: string;
  label: string;
  description: string;
  keys: string[];
};

const app = useAppStore();
const router = useRouter();
const activeSection = ref<SectionId>("general");
const toast = ref("");
const recordingShortcut = ref<string | null>(null);
let toastTimer: number | undefined;

const settings = reactive<AppSettings>({
  language: "zh-CN",
  launchAtLogin: true,
  closeBehavior: "background",
  dockEnabled: true,
  dockVisibleCount: 7,
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
const recommendedDockCount = ref(7);
const settingsLoaded = ref(false);
let saveTimer: number | undefined;

const recommendedDockRange = computed(() => {
  const maximum = recommendedDockCount.value;
  return maximum <= 5 ? "5" : `${Math.max(5, maximum - 2)}–${maximum}`;
});
const dockCountWarning = computed(() => settings.dockVisibleCount > recommendedDockCount.value);

function clampDockCount() {
  settings.dockVisibleCount = Math.min(12, Math.max(5, Math.round(Number(settings.dockVisibleCount) || 5)));
}

async function updateCloseBehavior(value: AppSettings["closeBehavior"]) {
  settings.closeBehavior = value;
  if (!settingsLoaded.value) return;
  window.clearTimeout(saveTimer);
  try {
    Object.assign(settings, await appService.saveSettings({ ...settings }));
  } catch {
    showToast("关闭行为保存失败，请重试");
  }
}

async function updateDockRecommendation() {
  try {
    const [{ currentMonitor, monitorFromPoint }, { getAllWebviewWindows }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/webviewWindow"),
    ]);
    const dock = (await getAllWebviewWindows()).find((item) => item.label === "dock");
    let monitor = await currentMonitor();
    if (dock) {
      const [position, size] = await Promise.all([dock.outerPosition(), dock.outerSize()]);
      monitor = await monitorFromPoint(position.x + size.width / 2, position.y + size.height / 2) ?? monitor;
    }
    const logicalHeight = monitor ? monitor.size.height / monitor.scaleFactor : window.screen.availHeight;
    const compact = logicalHeight <= 800;
    const reserved = compact ? 249 : 253;
    const noteHeight = compact ? 104 : 126;
    const step = compact ? 91 : 112;
    recommendedDockCount.value = Math.min(12, Math.max(5, 1 + Math.floor((logicalHeight - reserved - noteHeight) / step)));
  } catch {
    const logicalHeight = window.screen.availHeight || 1080;
    recommendedDockCount.value = logicalHeight <= 800 ? 5 : logicalHeight <= 960 ? 6 : logicalHeight <= 1080 ? 7 : logicalHeight <= 1200 ? 8 : logicalHeight <= 1440 ? 10 : 12;
  }
}

async function loadSettings() {
  try {
    Object.assign(settings, await appService.getSettings());
  } catch {
    // Browser preview keeps the defaults above.
  } finally {
    settingsLoaded.value = true;
  }
}

watch(settings, () => {
  if (!settingsLoaded.value) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      Object.assign(settings, await appService.saveSettings({ ...settings }));
    } catch {
      showToast("设置保存失败，请重试");
    }
  }, 350);
}, { deep: true });

const shortcuts = ref<Shortcut[]>([
  { id: "dock", label: "显示 / 隐藏 Dock", description: "在当前屏幕边缘召出便签栏", keys: ["Ctrl", "Alt", "N"] },
  { id: "new", label: "新建便签", description: "创建便签并直接进入编辑", keys: ["Ctrl", "Alt", "⇧", "N"] },
  { id: "capture", label: "Quick Capture", description: "在当前应用上方快速记录", keys: ["Ctrl", "Alt", "Space"] },
  { id: "all", label: "All Notes", description: "打开全部便签资料库", keys: ["Ctrl", "Alt", "L"] },
  { id: "archive", label: "Archive", description: "打开已归档便签", keys: ["Ctrl", "Alt", "A"] },
]);

const sections = [
  { id: "general", label: "通用", title: "通用设置", eyebrow: "GENERAL", subtitle: "定制 Noty 的显示方式与启动行为。", caption: "外观与启动", icon: Settings2 },
  { id: "shortcuts", label: "快捷键", title: "快捷键", eyebrow: "SHORTCUTS", subtitle: "管理在任意应用中生效的全局操作。", caption: "全局操作", icon: Keyboard },
  { id: "dock", label: "便签栏", title: "便签栏", eyebrow: "DOCK", subtitle: "调整便签栏的位置、数量与交互方式。", caption: "位置与行为", icon: PanelRight },
  { id: "notes", label: "便签", title: "便签", eyebrow: "NOTES", subtitle: "设置便签的编辑体验与默认外观。", caption: "编辑与外观", icon: StickyNote },
  { id: "privacy", label: "数据与隐私", title: "数据与隐私", eyebrow: "PRIVACY", subtitle: "管理本地数据、导入、导出与备份。", caption: "本地存储", icon: ShieldCheck },
  { id: "updates", label: "更新", title: "更新", eyebrow: "UPDATES", subtitle: "查看版本信息与更新偏好。", caption: "版本与发布", icon: RefreshCw },
] satisfies Array<{ id: SectionId; label: string; title: string; eyebrow: string; subtitle: string; caption: string; icon: unknown }>;

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

function closeSettings() {
  if (props.embedded) emit("close");
  else void router.push({ name: "library" });
}

function chooseSection(id: SectionId) {
  activeSection.value = id;
  recordingShortcut.value = null;
}

async function openDockWindow() {
  try {
    const visible = await appService.toggleDockWindow();
    showToast(visible ? "便签栏已显示" : "便签栏已隐藏");
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

onMounted(async () => {
  await Promise.all([app.initialize(), loadSettings(), updateDockRecommendation()]);
});
</script>

<template>
  <main class="settings-app" :class="{ embedded }">
    <button v-if="embedded" class="settings-modal-close" type="button" aria-label="关闭设置" @click="closeSettings"><X /></button>
    <aside class="sidebar" aria-label="设置分类">
      <div class="brand settings-brand">
        <img src="/noty-logo.png" alt="" />
        <div><strong>NOTY</strong><small>灵感停靠站</small></div>
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
          <component :is="section.icon" aria-hidden="true" />
          <span><b>{{ section.label }}</b><small>{{ section.caption }}</small></span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="library-link" @click="closeSettings">
          <ArrowLeft aria-hidden="true" />
          <span>返回便签库</span><kbd>Ctrl Alt L</kbd>
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
          <p>{{ activeMeta.eyebrow }}</p>
          <h1>{{ activeMeta.title }}</h1>
          <span class="content-subtitle">{{ activeMeta.subtitle }}</span>
        </div>
        <button class="dock-launch" type="button" @click="openDockWindow">
          <span class="dock-launch-icon" aria-hidden="true"><i></i><i></i><i></i></span>
          显示便签栏
          <kbd>Ctrl Alt N</kbd>
        </button>
      </header>

      <div class="content-scroll">
        <div v-if="activeSection === 'general'" class="settings-page general-page">
          <section class="settings-group appearance-group">
            <div class="group-heading"><div><h2>外观与语言</h2><p>界面语言与整体颜色模式</p></div></div>
            <div class="setting-row">
              <div class="setting-copy"><b>界面语言</b><span>更改后应用到所有窗口</span></div>
              <select v-model="settings.language" aria-label="界面语言"><option value="zh-CN">简体中文</option><option value="en-US">English</option><option value="ja-JP">日本語</option></select>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>颜色主题</b></div>
              <div class="segmented"><button class="selected" type="button">跟随系统</button><button type="button" disabled>浅色</button><button type="button" disabled>深色</button></div>
            </div>
          </section>

          <section class="settings-group startup-group">
            <div class="group-heading"><div><h2>启动与关闭</h2><p>控制 Noty 在系统中的运行方式。</p></div></div>
            <label class="setting-row clickable">
              <div class="setting-copy"><b>登录时启动 Noty</b><span>启动后保持在后台，不主动打开窗口</span></div>
              <input v-model="settings.launchAtLogin" class="switch-input" type="checkbox"><span class="switch" aria-hidden="true"></span>
            </label>
            <div class="setting-row">
              <div class="setting-copy"><b>关闭主窗口时</b></div>
              <select v-model="settings.closeBehavior" aria-label="关闭主窗口时"><option value="background">最小化至后台</option><option value="quit">退出 Noty</option></select>
            </div>
          </section>

          <section class="quick-access-card">
            <span class="quick-access-icon"><Command aria-hidden="true" /></span>
            <div><b>随时呼出便签栏</b><small>默认快捷键 Ctrl + Alt + N，可在「快捷键」中修改。</small></div>
            <kbd>Ctrl Alt N</kbd>
          </section>
          <p class="settings-version">NOTY 1.0.0　·　LOCAL FIRST</p>
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
          <div class="notice"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><p><b>冲突会被即时拦截</b><span>若系统或其他应用已占用组合键，Flank 会保留原快捷键并说明原因。</span></p></div>
        </div>

        <div v-else-if="activeSection === 'dock'" class="settings-page dock-page">
          <section class="dock-preview-card">
            <div class="preview-copy"><span>实时预览</span><h2>让便签栏待在<br>最顺手的位置。</h2><p>它会贴附在屏幕边缘，悬停时安静展开。</p></div>
            <div class="mini-screen" :class="`side-${settings.dockSide}`">
              <div class="mini-wallpaper"></div><div class="mini-dock"><i style="--paper:#FFE57A">今</i><i style="--paper:#FFB8A7">待</i><i style="--paper:#A9E5D1">读</i><span>＋</span></div>
            </div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>启用 Dock</b><span>关闭后仍可通过系统托盘、菜单栏或主窗口重新启用</span></div><input v-model="settings.dockEnabled" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row align-start">
              <div class="setting-copy"><b>每次展示数量</b><span>当前显示器推荐 {{ recommendedDockCount }} 个 · 舒适范围 {{ recommendedDockRange }} 个<br><em v-if="dockCountWarning" class="setting-warning">设置已保留，实际数量会按屏幕安全空间调整</em></span></div>
              <div class="dock-count-control"><div class="segmented"><button v-for="count in [5, 7, 9, 12]" :key="count" :class="{ selected: settings.dockVisibleCount === count }" type="button" @click="settings.dockVisibleCount = count">{{ count }}</button></div><label>自定义 <input v-model.number="settings.dockVisibleCount" type="number" min="5" max="12" step="1" @change="clampDockCount"></label></div>
            </div>
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
            <label class="color-option"><input v-model="settings.defaultColor" value="random" type="radio"><span class="color-random"><i v-for="color in colors" :key="color.id" :style="{ background: color.hex }"></i></span><div><b>每次随机选择</b><small>在 6 种 Flank 颜色中随机选取</small></div><em>推荐</em></label>
            <div class="color-grid"><label v-for="color in colors" :key="color.id" :class="{ selected: settings.defaultColor === color.id }"><input v-model="settings.defaultColor" :value="color.id" type="radio"><span :style="{ '--note-color': color.hex }"></span><b>{{ color.name }}</b></label></div>
          </section>
        </div>

        <div v-else-if="activeSection === 'privacy'" class="settings-page">
          <div class="privacy-hero"><div class="shield"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg></div><div><span>LOCAL-FIRST</span><h2>你的便签，默认只属于你。</h2><p>正文加密保存在本机。Flank 无账号、无产品遥测，也不会上传你的便签内容。</p></div></div>
          <section class="settings-group">
            <div class="setting-row"><div class="setting-copy path-copy"><b>数据位置</b><span>%APPDATA%\Flank\data</span></div><button class="secondary-button" type="button" @click="showToast('数据目录将在 Tauri 接口接入后打开')">打开文件夹</button></div>
            <div class="privacy-facts"><div><i class="green"></i><p><b>正文</b><span>使用设备密钥加密</span></p></div><div><i class="amber"></i><p><b>标题与元数据</b><span>为检索与排序明文保存</span></p></div><div><i class="blue"></i><p><b>网络</b><span>仅用于可关闭的更新检查</span></p></div></div>
          </section>
          <section class="action-grid">
            <button type="button" @click="showToast('选择要导入的 .stickies、Markdown 或 TXT 文件')"><span class="action-symbol">↘</span><b>导入便签</b><small>.stickies v2、Markdown、TXT</small></button>
            <button type="button" @click="showToast('导出前将提示明文文件风险')"><span class="action-symbol">↗</span><b>导出便签</b><small>兼容文件为明文格式</small></button>
            <button type="button" @click="showToast('完整备份将使用独立密码加密')"><span class="action-symbol">◇</span><b>创建完整备份</b><small>加密的 .flankbackup 文件</small></button>
            <button type="button" @click="showToast('诊断包不会包含便签内容')"><span class="action-symbol">···</span><b>生成诊断包</b><small>默认移除内容与个人路径</small></button>
          </section>
          <section class="danger-zone"><div><b>删除所有本地数据</b><span>删除数据库、密钥、备份、日志与启动项。此操作不可撤销。</span></div><button type="button" @click="showToast('需要二次确认后才能删除')">删除数据…</button></section>
        </div>

        <div v-else class="settings-page">
          <section class="update-hero">
            <div class="app-icon"><span></span><span></span><span></span></div>
            <div><p>FLANK DESKTOP</p><h2>当前已是最新版本</h2><span>版本 {{ app.info?.version ?? '0.1.0' }} · Windows x64</span></div>
            <div class="update-check"><i></i>已是最新</div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>自动检查更新</b><span>每天检查一次，不携带便签或设备内容</span></div><input v-model="settings.automaticUpdates" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row"><div class="setting-copy"><b>立即检查</b><span>更新不会在你输入时强制重启应用</span></div><button class="secondary-button" type="button" @click="showToast('正在检查更新…')">检查更新</button></div>
            <div class="setting-row"><div class="setting-copy"><b>发布说明</b><span>查看当前版本的改进和已知问题</span></div><button class="text-button" type="button" @click="showToast('发布说明将在浏览器中打开')">查看发布说明 ↗</button></div>
          </section>
          <div class="notice"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg><p><b>更新包经过签名验证</b><span>Flank 只安装同一发布者签名且版本递增的有效更新包。</span></p></div>
        </div>
      </div>
    </section>

    <Transition name="toast"><div v-if="toast" class="app-toast" role="status"><span>✓</span>{{ toast }}</div></Transition>
  </main>
</template>
