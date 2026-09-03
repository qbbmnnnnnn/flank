import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { AppInfo } from "../../contracts/app";
import { appService } from "../../services/appService";

export const useAppStore = defineStore("app", () => {
  const info = ref<AppInfo | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const ready = computed(() => info.value?.databaseReady === true);

  async function initialize() {
    loading.value = true;
    error.value = null;

    try {
      info.value = await appService.getInfo();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  return { info, loading, error, ready, initialize };
});
