import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "settings",
      component: () => import("../../features/settings/SettingsView.vue"),
    },
    {
      path: "/dock",
      name: "dock",
      component: () => import("../../features/dock/DockView.vue"),
    },
  ],
});
