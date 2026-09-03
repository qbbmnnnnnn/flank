<script setup lang="ts">
import { onMounted } from "vue";

import { useAppStore } from "../../app/stores/app";

const app = useAppStore();

onMounted(() => app.initialize());
</script>

<template>
  <main class="shell">
    <section class="card" aria-labelledby="app-title">
      <div class="mark" aria-hidden="true">F</div>
      <p class="eyebrow">LOCAL-FIRST NOTES</p>
      <h1 id="app-title">Flank</h1>
      <p class="lede">Tauri 2 + Vue 3 + TypeScript + SQLx</p>

      <div class="status" :class="{ ready: app.ready, failed: app.error }">
        <span class="status-dot" />
        <span v-if="app.loading">正在初始化本地数据库…</span>
        <span v-else-if="app.error">初始化失败：{{ app.error }}</span>
        <span v-else-if="app.ready">
          SQLite 已就绪 · {{ app.info?.name }} {{ app.info?.version }}
        </span>
        <span v-else>等待 Tauri 运行时</span>
      </div>

      <p class="hint">使用 <code>pnpm tauri:dev</code> 启动桌面开发环境。</p>
    </section>
  </main>
</template>
