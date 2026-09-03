<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const message = ref("");
let hideTimer: number | undefined;
let unlisten: (() => void) | undefined;

onMounted(async () => {
  document.documentElement.classList.add("dock-toast-document");
  document.body.classList.add("dock-toast-document");
  try {
    const [{ listen }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    const toastWindow = getCurrentWindow();
    unlisten = await listen<string>("dock-toast", ({ payload }) => {
      window.clearTimeout(hideTimer);
      message.value = payload;
      hideTimer = window.setTimeout(async () => {
        message.value = "";
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        await toastWindow.hide();
      }, 1800);
    });
  } catch {
    // The browser preview does not create a native toast window.
  }
});

onUnmounted(() => {
  document.documentElement.classList.remove("dock-toast-document");
  document.body.classList.remove("dock-toast-document");
  window.clearTimeout(hideTimer);
  unlisten?.();
});
</script>

<template>
  <main class="screen-toast-shell" aria-live="polite">
    <Transition name="screen-toast">
      <div v-if="message" class="screen-toast">{{ message }}</div>
    </Transition>
  </main>
</template>

<style scoped>
.screen-toast-shell{width:100vw;height:100vh;display:grid;place-items:center;overflow:hidden;pointer-events:none;user-select:none;-webkit-user-select:none}
.screen-toast{max-width:300px;padding:9px 15px;border:1px solid rgba(255,255,255,.13);border-radius:10px;color:#fff;background:rgba(28,26,32,.88);font-size:11px;white-space:nowrap}
.screen-toast-enter-active,.screen-toast-leave-active{transition:opacity .16s ease,transform .18s ease}
.screen-toast-enter-from,.screen-toast-leave-to{opacity:0;transform:translateY(7px)}
</style>
