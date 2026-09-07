import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { router } from "./app/router";
import "./styles/main.css";
import "./styles/library.css";
import "./styles/appearance.css";
import { initializeSettings, flushSettings, disposeSettings } from "./services/settingsService";
import { installAppearance } from "./services/appearanceService";
import { installNoteColors } from "./services/noteColorService";
import { isTauri, invoke } from "@tauri-apps/api/core";

// Apply transparency before Vue/router mounting so native Dock surfaces never
// render the application's default page background during their first frame.
if (window.location.hash.startsWith("#/dock")) {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");
}

async function bootstrap() {
  // Read authoritative persisted settings before mounting any application window.
  await initializeSettings();
  const stopAppearance = installAppearance();
  const stopNoteColors = installNoteColors();
  let stopClose: (() => void) | undefined;
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label === "main") {
      let closing = false;
      stopClose = await listen("main:close-requested", async () => {
        if (closing) return;
        closing = true;
        try {
          if (await flushSettings()) await invoke("close_main_window");
        } finally { closing = false; }
      });
    }
  }
  createApp(App).use(createPinia()).use(router).mount("#app");
  await router.isReady();
  if (isTauri()) await invoke("frontend_ready");
  if (import.meta.hot) import.meta.hot.dispose(() => { stopClose?.(); stopAppearance(); stopNoteColors(); disposeSettings(); });
}
void bootstrap();
