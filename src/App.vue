<script setup lang="ts">
import { t } from './services/i18n';
import { onMounted, onUnmounted } from "vue";
import { RouterView, useRouter, useRoute } from "vue-router";
import { AlertTriangle, Check, Info, X } from "lucide-vue-next";
import { NOTIFICATION_DURATION_MS, notification, receiveNotification, dismissNotification } from "./services/notificationService";
import { listenForUpdateAnnouncements, requestManualUpdateCheck } from "./services/updateService";

const router = useRouter();
const route = useRoute();
let unlisten: (() => void) | undefined;
let unlistenNotification: (() => void) | undefined;
let unlistenUpdate: (() => void) | undefined;
let unlistenUpdateRequest: (() => void) | undefined;

onMounted(async () => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // Every Tauri webview mounts App.vue. Only the main window may react to
  // navigation requests, otherwise a tray action can replace the Dock route.
  if (getCurrentWindow().label !== "main") return;
  const { listen } = await import("@tauri-apps/api/event");
  unlistenNotification = await listen<{ message: string; kind?: string }>("main:notification", (event) =>
    receiveNotification(event.payload.message, event.payload.kind === "success" || event.payload.kind === "error" ? event.payload.kind : "info"));
  unlisten = await listen<string>("main:navigate", (event) => {
    if (event.payload === "/") void router.push(event.payload);
  });
  // Keep the request pending while the lazily loaded Settings view mounts.
  unlistenUpdateRequest = await listen("update:check-requested", () => {
    requestManualUpdateCheck();
    void router.push("/");
  });
  // The Rust background task only announces; downloading and installing stay manual.
  unlistenUpdate = await listenForUpdateAnnouncements((version) => {
    receiveNotification(`${t('发现新版本 {version}', { version })} · ${t('可在设置中更新')}`, "info");
  });
});

onUnmounted(() => {
  unlisten?.();
  unlistenNotification?.();
  unlistenUpdate?.();
  unlistenUpdateRequest?.();
  dismissNotification();
});
</script>

<template>
  <RouterView />
  <Transition name="toast">
    <div
      v-if="notification && !route.path.startsWith('/dock')"
      class="main-notification"
      :class="notification.kind"
      :style="{ '--toast-duration': `${NOTIFICATION_DURATION_MS}ms` }"
      role="status"
      aria-live="polite"
    >
      <span class="notification-icon" aria-hidden="true">
        <Check v-if="notification.kind === 'success'" />
        <AlertTriangle v-else-if="notification.kind === 'error'" />
        <Info v-else />
      </span>
      <p>{{ notification.message }}</p>
      <button type="button" :aria-label="t('关闭提示')" @click="dismissNotification"><X aria-hidden="true" /></button>
      <i :key="notification.id" class="notification-timer" aria-hidden="true"></i>
    </div>
  </Transition>
</template>

<style scoped>
/* Tone tokens: surface / border / ink / icon badge / countdown accent, per theme. */
.main-notification {
  --toast-surface: #fff; --toast-border: #e2e8f0; --toast-ink: #1f2b3d;
  --toast-icon-bg: #eef2f7; --toast-icon: #526176; --toast-accent: #93a7bf;
  position: fixed; z-index: 1000; top: 36px; left: 50%; transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 48px)); padding: 11px 11px 11px 13px;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px;
  overflow: hidden; border: 1px solid var(--toast-border); border-radius: 14px;
  color: var(--toast-ink); background: var(--toast-surface);
  box-shadow: 0 18px 42px -20px var(--toast-shadow, rgba(16, 33, 59, .3)), 0 2px 6px rgba(16, 33, 59, .05);
  font-size: 13px; line-height: 1.45; overflow-wrap: anywhere;
}
.main-notification.success { --toast-surface: #f6fdf9; --toast-border: #c8e8d5; --toast-icon-bg: #dbf5e6; --toast-icon: #17854c; --toast-accent: #46bf7c; --toast-shadow: rgba(23, 133, 76, .26); }
.main-notification.error { --toast-surface: #fff8f9; --toast-border: #f3ccd4; --toast-icon-bg: #ffe3e9; --toast-icon: #c6354e; --toast-accent: #ea5f76; --toast-shadow: rgba(198, 53, 78, .26); }
.main-notification.info { --toast-surface: #f8fbff; --toast-border: #d2e2f6; --toast-icon-bg: #e1eefc; --toast-icon: #1b62c6; --toast-accent: #5a9aef; --toast-shadow: rgba(27, 98, 198, .26); }

:root[data-theme="dark"] .main-notification {
  --toast-surface: #1b2431; --toast-border: #34425b; --toast-ink: #e5edf9;
  --toast-icon-bg: #25324a; --toast-icon: #9db8dc; --toast-accent: #62799a;
}
:root[data-theme="dark"] .main-notification.success { --toast-surface: #12261c; --toast-border: #2b5840; --toast-icon-bg: #1b4230; --toast-icon: #6fe3a5; --toast-accent: #38a86d; }
:root[data-theme="dark"] .main-notification.error { --toast-surface: #2a161c; --toast-border: #6b2f3d; --toast-icon-bg: #4a1f2a; --toast-icon: #ff90a3; --toast-accent: #e05570; }
:root[data-theme="dark"] .main-notification.info { --toast-surface: #14202f; --toast-border: #2f4a70; --toast-icon-bg: #1d3350; --toast-icon: #7fb6ff; --toast-accent: #4b8ee0; }

.notification-icon { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 9px; color: var(--toast-icon); background: var(--toast-icon-bg); }
.notification-icon svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
.main-notification p { margin: 0; min-width: 0; }
.main-notification button { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 9px; color: inherit; background: transparent; opacity: .5; cursor: pointer; transition: opacity .16s ease, background .16s ease; }
.main-notification button:hover { opacity: 1; background: var(--toast-icon-bg); }
.main-notification button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
/* Countdown bar mirrors NOTIFICATION_DURATION_MS and restarts with every message. */
.notification-timer { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--toast-accent); opacity: .8; transform-origin: left; animation: notification-countdown var(--toast-duration, 4s) linear forwards; }
@keyframes notification-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }

.toast-enter-active { transition: opacity .22s ease, transform .32s cubic-bezier(.2, .8, .2, 1); }
.toast-leave-active { transition: opacity .16s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -14px); }
</style>
