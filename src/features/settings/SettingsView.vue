<script setup lang="ts">
import { t } from '../../services/i18n';
import { showNotification as showToast } from "../../services/notificationService";
import { dockLayout } from "../dock/layout";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { savedSettings, settingsLoaded, settingsPending, settingsError, initializeSettings, saveSettingsPatch, flushSettings } from "../../services/settingsService";
import {
  ArrowLeft,
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
const settingsRoot = ref<HTMLElement | null>(null);
const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

function handleSettingsKey(event: KeyboardEvent) {
  if (!props.embedded) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    void closeSettings();
  }
  if (event.key !== "Tab") return;
  const controls = [...(settingsRoot.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length && !el.closest('fieldset:disabled'));
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

const recordingShortcut = ref<string | null>(null);


const settings = reactive<AppSettings>({ ...savedSettings.value });
const recommendedDockCount = ref(7);
const desktop = isTauri();
let syncing = false;
let previous = { ...settings };

function syncSavedSettings() {
  syncing = true;
  Object.assign(settings, savedSettings.value);
  previous = { ...settings };
  syncing = false;
}
let savedToastTimer: ReturnType<typeof setTimeout> | undefined;
watch(savedSettings, () => { if (!settingsPending.value) syncSavedSettings(); }, { deep: true });
watch(settingsPending, (count, previous) => {
  if (!count) syncSavedSettings();
  clearTimeout(savedToastTimer);
  if (count || !previous) return;
  savedToastTimer = setTimeout(() => {
    if (!settingsPending.value && !settingsError.value) showToast(t('设置已保存'));
  }, 500);
});

const dockCountWarning = computed(() => settings.dockVisibleCount > recommendedDockCount.value);

function clampDockCount() {
  settings.dockVisibleCount = Math.min(12, Math.max(5, Math.round(Number(settings.dockVisibleCount) || 5)));
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
    recommendedDockCount.value = dockLayout(12, 12, logicalHeight).count;
  } catch {
    const logicalHeight = window.screen.availHeight || 1080;
    recommendedDockCount.value = dockLayout(12, 12, logicalHeight).count;
  }
}

async function loadSettings() {
  await initializeSettings();
  syncSavedSettings();
  if (settingsError.value) showToast(t(settingsError.value));
}

watch(settings, () => {
  if (syncing || !settingsLoaded.value) return;
  const patch = Object.fromEntries(Object.entries(settings).filter(([key, value]) => value !== previous[key as keyof AppSettings])) as Partial<AppSettings>;
  previous = { ...settings };
  if (!Object.keys(patch).length) return;
  void saveSettingsPatch(patch).catch(() => showToast(t('设置保存失败，已恢复为已保存的设置')));
}, { deep: true, flush: "sync" });

const shortcuts = ref<Shortcut[]>([
  { id: "dock", label: "显示 / 隐藏 Dock", description: "在当前屏幕边缘召出便签栏", keys: ["Ctrl", "Alt", "N"] },
  { id: "new", label: "新建便签", description: "创建便签并直接进入编辑", keys: ["Ctrl", "Alt", "⇧", "N"] },
  { id: "capture", label: "Quick Capture", description: "在当前应用上方快速记录", keys: ["Ctrl", "Alt", "Space"] },
  { id: "all", label: "All Notes", description: "打开全部便签资料库", keys: ["Ctrl", "Alt", "L"] },
  { id: "archive", label: "Archive", description: "打开已归档便签", keys: ["Ctrl", "Alt", "A"] },
]);

const sections = [
  { id: "general", label: "通用", title: "通用设置", eyebrow: "GENERAL", subtitle: "定制 FLANK 的显示方式与启动行为。", caption: "外观与启动", icon: Settings2 },
  // { id: "shortcuts", label: "快捷键", title: "快捷键", eyebrow: "SHORTCUTS", subtitle: "管理在任意应用中生效的全局操作。", caption: "全局操作", icon: Keyboard },
  { id: "dock", label: "便签栏", title: "便签栏", eyebrow: "DOCK", subtitle: "调整便签栏的位置、数量与交互方式。", caption: "位置与行为", icon: PanelRight },
  { id: "notes", label: "便签", title: "便签", eyebrow: "NOTES", subtitle: "设置便签的编辑体验与默认外观。", caption: "编辑与外观", icon: StickyNote },
  // { id: "privacy", label: "数据与隐私", title: "数据与隐私", eyebrow: "PRIVACY", subtitle: "管理本地数据、导入、导出与备份。", caption: "本地存储", icon: ShieldCheck },
  { id: "updates", label: "更新", title: "更新", eyebrow: "UPDATES", subtitle: "查看版本信息与更新偏好。", caption: "版本与发布", icon: RefreshCw },
] satisfies Array<{ id: SectionId; label: string; title: string; eyebrow: string; subtitle: string; caption: string; icon: unknown }>;

const activeMeta = computed(() => sections.find((section) => section.id === activeSection.value)!);

const colors = [
  { id: "lemon", name: "Lemon" },
  { id: "peach", name: "Peach" },
  { id: "rose", name: "Rose" },
  { id: "lilac", name: "Lilac" },
  { id: "sky", name: "Sky" },
  { id: "mint", name: "Mint" },
];



async function closeSettings() {
  await flushSettings();
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
    showToast(visible ? t('便签栏已显示') : t('便签栏已隐藏'));
  } catch {
    showToast(t('浏览器预览中可通过 /#/dock 查看便签栏'));
  }
}

function startShortcutRecording(id: string) {
  recordingShortcut.value = recordingShortcut.value === id ? null : id;
  if (recordingShortcut.value) showToast(t('请按下新的快捷键组合'));
}

function resetShortcuts() {
  shortcuts.value = [
    { id: "dock", label: "显示 / 隐藏 Dock", description: "在当前屏幕边缘召出便签栏", keys: ["Ctrl", "Alt", "N"] },
    { id: "new", label: "新建便签", description: "创建便签并直接进入编辑", keys: ["Ctrl", "Alt", "⇧", "N"] },
    { id: "capture", label: "Quick Capture", description: "在当前应用上方快速记录", keys: ["Ctrl", "Alt", "Space"] },
    { id: "all", label: "All Notes", description: "打开全部便签资料库", keys: ["Ctrl", "Alt", "L"] },
    { id: "archive", label: "Archive", description: "打开已归档便签", keys: ["Ctrl", "Alt", "A"] },
  ];
  showToast(t('已恢复 Windows 默认快捷键'));
}

onMounted(async () => {
  await Promise.all([app.initialize(), loadSettings(), updateDockRecommendation()]);
  await nextTick();
  if (props.embedded) settingsRoot.value?.querySelector<HTMLElement>('.settings-modal-close')?.focus();
});
onUnmounted(() => {
  clearTimeout(savedToastTimer);
  if (props.embedded && returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <main ref="settingsRoot" class="settings-app" :class="{ embedded }" :role="embedded ? 'dialog' : undefined" :aria-modal="embedded ? true : undefined" aria-labelledby="settings-heading" @keydown="handleSettingsKey">
    <button v-if="embedded" class="settings-modal-close" type="button" :aria-label="t('关闭设置')" @click="closeSettings"><X /></button>
    <aside class="sidebar" :aria-label="t('设置分类')">
      <!-- <div class="brand settings-brand">
        <img src="/noty-logo.png" alt="" />
        <div><strong>NOTY</strong><small>灵感停靠站</small></div>
      </div> -->

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
          <span><b>{{ t(section.label) }}</b><small>{{ t(section.caption) }}</small></span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="library-link" @click="closeSettings">
          <ArrowLeft aria-hidden="true" />
          <span>{{ t('返回便签库') }}</span><kbd>Ctrl Alt L</kbd>
        </button>
        <div class="runtime-state" :class="{ ready: app.ready, error: app.error }">
          <span class="runtime-dot"></span>
          <span v-if="app.loading">{{ t('正在连接本地数据…') }}</span>
          <span v-else-if="app.error">{{ t('界面预览模式') }}</span>
          <span v-else>{{ t('本地数据已就绪') }}</span>
        </div>
      </div>
    </aside>

    <section class="settings-main">
      <header class="content-header">
        <div>
          <p>{{ activeMeta.eyebrow }}</p>
          <h1 id="settings-heading">{{ t(activeMeta.title) }}</h1>
          <span class="content-subtitle">{{ t(activeMeta.subtitle) }}</span>
        </div>
        <button class="dock-launch" type="button" @click="openDockWindow">
          <span class="dock-launch-icon" aria-hidden="true"><i></i><i></i><i></i></span>
          {{ t('显示便签栏') }}
          <kbd>Ctrl Alt N</kbd>
        </button>
      </header>

      <fieldset class="settings-fields" :disabled="!settingsLoaded">
      <div class="content-scroll">
        <div v-if="activeSection === 'general'" class="settings-page general-page">
          <section class="settings-group appearance-group">
            <div class="group-heading"><div><h2>{{ t('外观与语言') }}</h2><p>{{ t('界面语言与整体颜色模式') }}</p></div></div>
            <div class="setting-row">
              <div class="setting-copy"><b>{{ t('界面语言') }}</b><span>{{ t('更改后应用到所有窗口') }}</span></div>
              <select v-model="settings.language" :aria-label="t('界面语言')"><option value="zh-CN">简体中文</option><option value="en-US">English</option></select>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>{{ t('颜色主题') }}</b></div>
              <div class="segmented" role="group" :aria-label="t('颜色主题')"><button v-for="theme in (['system', 'light', 'dark'] as const)" :key="theme" :class="{ selected: settings.theme === theme }" :aria-pressed="settings.theme === theme" type="button" @click="settings.theme = theme">{{ theme === 'system' ? t('跟随系统') : theme === 'light' ? t('浅色') : t('深色') }}</button></div>
            </div>
          </section>

          <section class="settings-group startup-group">
            <div class="group-heading"><div><h2>{{ t('启动与关闭') }}</h2><p>{{ t('控制 FLANK 在系统中的运行方式。') }}</p></div></div>
            <label class="setting-row clickable">
              <div class="setting-copy"><b>{{ t('登录时启动 FLANK') }}</b><span>{{ desktop ? t('启动后保持在后台，不主动打开窗口') : t('请在桌面应用中设置登录启动') }}</span></div>
              <input v-model="settings.launchAtLogin" :disabled="!desktop" class="switch-input" type="checkbox"><span class="switch" aria-hidden="true"></span>
            </label>
            <div class="setting-row">
              <div class="setting-copy"><b>{{ t('关闭主窗口时') }}</b></div>
              <select v-model="settings.closeBehavior" :aria-label="t('关闭主窗口时')"><option value="background">{{ t('后台运行') }}</option><option value="quit">{{ t('退出 FLANK') }}</option></select>
            </div>
          </section>


        </div>

        <!-- <div v-else-if="activeSection === 'shortcuts'" class="settings-page">
          <div class="page-intro"><p>{{ t('快捷键在任意应用中生效。点击组合键后，直接按下新的按键组合。') }}</p><button class="text-button" type="button" @click="resetShortcuts">{{ t('恢复默认值') }}</button></div>
          <section class="settings-group shortcuts-card">
            <div v-for="shortcut in shortcuts" :key="shortcut.id" class="shortcut-row">
              <div class="setting-copy"><b>{{ t(shortcut.label) }}</b><span>{{ t(shortcut.description) }}</span></div>
              <button class="key-recorder" :class="{ recording: recordingShortcut === shortcut.id }" type="button" @click="startShortcutRecording(shortcut.id)">
                <template v-if="recordingShortcut === shortcut.id"><span class="recording-dot"></span>{{ t('请按快捷键') }}</template>
                <template v-else><kbd v-for="key in shortcut.keys" :key="key">{{ key }}</kbd></template>
              </button>
            </div>
          </section>
          <div class="notice"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><p><b>{{ t('冲突会被即时拦截') }}</b><span>{{ t('若系统或其他应用已占用组合键，Flank 会保留原快捷键并说明原因。') }}</span></p></div>
        </div> -->

        <div v-else-if="activeSection === 'dock'" class="settings-page dock-page">
          <section class="dock-preview-card">
            <div class="preview-copy"><span>{{ t('实时预览') }}</span><h2>{{ t('让便签栏待在') }}<br>{{ t('最顺手的位置。') }}</h2><p>{{ t('它会贴附在屏幕边缘，悬停时安静展开。') }}</p></div>
            <div class="mini-screen" :class="`side-${settings.dockSide}`">
              <div class="mini-wallpaper"></div><div class="mini-dock"><i style="--paper:var(--note-lemon)">{{ t('今') }}</i><i style="--paper:var(--note-peach)">{{ t('待') }}</i><i style="--paper:var(--note-mint)">{{ t('读') }}</i><span>＋</span></div>
            </div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>{{ t('启用 Dock') }}</b><span>{{ t('关闭后仍可通过系统托盘、菜单栏或主窗口重新启用') }}</span></div><input v-model="settings.dockEnabled" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row align-start">
              <div class="setting-copy"><b>{{ t('每次展示数量') }}</b><span>{{ t('默认最多显示 5 个完整便签；不足上限时随数量增高，超出后滚动') }}<br>{{ t('当前屏幕最多容纳') }} {{ recommendedDockCount }} {{ t('个') }}<br><em v-if="dockCountWarning" class="setting-warning">{{ t('设置已保留，实际数量会按屏幕安全空间调整') }}</em></span></div>
              <div class="dock-count-control"><div class="segmented"><button v-for="count in [5, 7, 9, 12]" :key="count" :class="{ selected: settings.dockVisibleCount === count }" type="button" @click="settings.dockVisibleCount = count">{{ count }}</button></div><label>{{ t('自定义') }} <input v-model.number="settings.dockVisibleCount" type="number" min="5" max="12" step="1" @change="clampDockCount"></label></div>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><b>{{ t('屏幕边缘') }}</b><span>{{ t('固定在所选屏幕边缘的居中位置') }}</span></div>
              <div class="segmented"><button :class="{ selected: settings.dockSide === 'left' }" type="button" @click="settings.dockSide = 'left'">{{ t('左侧') }}</button><button :class="{ selected: settings.dockSide === 'right' }" type="button" @click="settings.dockSide = 'right'">{{ t('右侧') }}</button></div>
            </div>
            <!-- <div class="setting-row">
              <div class="setting-copy"><b>{{ t('垂直位置') }}</b><span>{{ t('始终居中，随便签栏高度自动调整') }}</span></div>
            </div> -->
            <div class="setting-row">
              <div class="setting-copy"><b>{{ t('便签栏大小') }}</b><span>{{ t('不会改变便签正文的字体大小') }}</span></div>
              <select v-model="settings.dockSize"><option value="small">{{ t('紧凑') }}</option><option value="medium">{{ t('标准') }}</option><option value="large">{{ t('宽松') }}</option></select>
            </div>
          </section>
          <!-- <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>{{ t('悬停动画') }}</b><span>{{ t('按指针距离放大当前便签和相邻便签') }}</span></div><input v-model="settings.hoverAnimation" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('快捷操作延迟') }}</b><span>{{ t('持续悬停后显示归档与删除') }}</span></div><select v-model="settings.actionDelay"><option :value="0.6">{{ t('0.6 秒') }}</option><option :value="1">{{ t('1 秒') }}</option><option :value="1.5">{{ t('1.5 秒') }}</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('全屏应用') }}</b><span>{{ t('播放视频、演示或游戏时的行为') }}</span></div><select v-model="settings.fullscreenBehavior"><option value="hide">{{ t('自动隐藏') }}</option><option value="show">{{ t('保持可见') }}</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('召出时显示器') }}</b><span>{{ t('多显示器环境中的优先规则') }}</span></div><select v-model="settings.displayPreference"><option value="cursor">{{ t('鼠标所在屏幕') }}</option><option value="active">{{ t('活动窗口所在屏幕') }}</option><option value="primary">{{ t('主显示器') }}</option></select></div>
          </section> -->
        </div>

        <div v-else-if="activeSection === 'notes'" class="settings-page">
          <section class="settings-group">
            <div class="group-heading"><div><h2>{{ t('编辑体验') }}</h2><p>{{ t('设置所有新建和已有便签的阅读体验。') }}</p></div></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('字体') }}</b><span>{{ t('正文和 Markdown 预览使用的字体') }}</span></div><select v-model="settings.font"><option value="system">{{ t('系统默认') }}</option><option value="serif">{{ t('衬线字体') }}</option><option value="mono">{{ t('等宽字体') }}</option></select></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('正文字号') }}</b><span>{{ settings.fontSize }} px</span></div><input v-model="settings.fontSize" class="range short" type="range" min="13" max="22"></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('默认文字方向') }}</b><span>{{ t('支持 Arabic / Hebrew 基础 RTL') }}</span></div><select v-model="settings.textDirection"><option value="automatic">{{ t('自动检测') }}</option><option value="ltr">{{ t('从左到右') }}</option><option value="rtl">{{ t('从右到左') }}</option></select></div>
            <label class="setting-row clickable"><div class="setting-copy"><b>{{ t('启用 Markdown') }}</b><span>{{ t('支持标题、粗体、列表、任务与行内代码') }}</span></div><input v-model="settings.markdown" class="switch-input" type="checkbox"><span class="switch"></span></label>
          </section>
          <section class="settings-group color-settings">
            <div class="group-heading"><div><h2>{{ t('新便签颜色') }}</h2><p>{{ t('新建时可继续在编辑器中选择颜色。') }}</p></div></div>
            <label class="color-option"><input v-model="settings.defaultColor" value="random" type="radio"><span class="color-random"><i v-for="color in colors" :key="color.id" :style="{ background: `var(--note-${color.id})` }"></i></span><div><b>{{ t('每次随机选择') }}</b><small>{{ t('在 6 种 Flank 颜色中随机选取') }}</small></div><em>{{ t('推荐') }}</em></label>
            <div class="color-grid"><label v-for="color in colors" :key="color.id" :class="{ selected: settings.defaultColor === color.id }"><input v-model="settings.defaultColor" :value="color.id" type="radio"><span :style="{ '--note-color': `var(--note-${color.id})` }"></span><b>{{ color.name }}</b></label></div>
          </section>
        </div>

        <!-- <div v-else-if="activeSection === 'privacy'" class="settings-page">
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
        </div> -->

        <div v-else class="settings-page">
          <section class="update-hero">
            <div class="app-icon"><span></span><span></span><span></span></div>
            <div><p>FLANK DESKTOP</p><h2>{{ t('当前已是最新版本') }}</h2><span>{{ t('版本') }} {{ app.info?.version ?? '0.1.0' }} · Windows x64</span></div>
            <div class="update-check"><i></i>{{ t('已是最新') }}</div>
          </section>
          <section class="settings-group">
            <label class="setting-row clickable"><div class="setting-copy"><b>{{ t('自动检查更新') }}</b><span>{{ t('每天检查一次，不携带便签或设备内容') }}</span></div><input v-model="settings.automaticUpdates" class="switch-input" type="checkbox"><span class="switch"></span></label>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('立即检查') }}</b><span>{{ t('更新不会在你输入时强制重启应用') }}</span></div><button class="secondary-button" type="button" @click="showToast(t('正在检查更新…'))">{{ t('检查更新') }}</button></div>
            <div class="setting-row"><div class="setting-copy"><b>{{ t('发布说明') }}</b><span>{{ t('查看当前版本的改进和已知问题') }}</span></div><button class="text-button" type="button" @click="showToast(t('发布说明将在浏览器中打开'))">{{ t('查看发布说明 ↗') }}</button></div>
          </section>
          <div class="notice"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg><p><b>{{ t('更新包经过签名验证') }}</b><span>{{ t('Flank 只安装同一发布者签名且版本递增的有效更新包。') }}</span></p></div>
        </div>
      </div>
      </fieldset>
    </section>


  </main>
</template>
