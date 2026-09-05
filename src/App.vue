<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { RouterView, useRouter, useRoute } from "vue-router";
import { notification, receiveNotification, dismissNotification } from "./services/notificationService";

const router = useRouter();
const route = useRoute();
let unlisten: (() => void) | undefined;
let unlistenNotification: (() => void) | undefined;

onMounted(async () => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // Every Tauri webview mounts App.vue. Only the main window may react to
  // navigation requests, otherwise a tray action can replace the Dock route.
  if (getCurrentWindow().label !== "main") return;
  const { listen } = await import("@tauri-apps/api/event");
  unlistenNotification = await listen<string>("main:notification", (event) => receiveNotification(event.payload));
  unlisten = await listen<string>("main:navigate", (event) => {
    if (event.payload === "/" || event.payload === "/settings") void router.push(event.payload);
  });
});

onUnmounted(() => {
  unlisten?.();
  unlistenNotification?.();
  dismissNotification();
});
</script>

<template>
  <RouterView />
  <div v-if="notification && !route.path.startsWith('/dock')" class="main-notification" role="status" aria-live="polite">
    <span>{{ notification }}</span>
    <button type="button" aria-label="关闭提示" @click="dismissNotification">×</button>
  </div>
</template>

<style scoped>
.main-notification{position:fixed;z-index:1000;top:42px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 40px);display:flex;align-items:center;gap:16px;padding:12px 16px;border:1px solid #ddd;border-radius:12px;background:#29262f;color:#fff;box-shadow:0 8px 28px #0003;font-size:13px;overflow-wrap:anywhere}
.main-notification button{flex-shrink:0;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer}
</style>
