<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { RouterView, useRouter } from "vue-router";

const router = useRouter();
let unlisten: (() => void) | undefined;

onMounted(async () => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { listen } = await import("@tauri-apps/api/event");
  unlisten = await listen<string>("main:navigate", (event) => {
    if (event.payload === "/" || event.payload === "/settings") void router.push(event.payload);
  });
});

onUnmounted(() => unlisten?.());
</script>

<template>
  <RouterView />
</template>
