import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "library",
      component: () => import("../../features/library/LibraryView.vue"),
    },
    {
      path: "/dock",
      name: "dock",
      component: () => import("../../features/dock/DockView.vue"),
    },
    {
      path: "/dock-panel",
      name: "dock-panel",
      component: () => import("../../features/dock/DockPanelView.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});
