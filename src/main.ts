import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { router } from "./app/router";
import "./styles/main.css";

// Apply transparency before Vue/router mounting so native Dock surfaces never
// render the application's default page background during their first frame.
if (window.location.hash.startsWith("#/dock")) {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");
}

createApp(App).use(createPinia()).use(router).mount("#app");
