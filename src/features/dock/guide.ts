import { savedSettings } from "../../services/settingsService";

/** Built-in help, not persisted user content. */
export function guideCopy() {
  return savedSettings.value.language === "en-US" ? {
    title: "Quick guide",
    body: "## Welcome to FLANK\n\nKeep useful notes at your screen edge, ready whenever you need them.\n\n- Click a note to preview; click again to edit\n- Hover for about 1 second to reveal archive and delete\n- Click ＋ below to create a note\n- Dock stays centered on the screen edge; switch sides in Settings\n- Markdown and task lists are supported\n\nThis guide disappears when you create your first note.",
  } : {
    title: "使用指南",
    body: "## 欢迎使用 FLANK\n\n把常用内容放在屏幕边缘，需要时随手打开。\n\n- 单击便签：预览，再次单击进入编辑\n- 悬停约 1 秒：显示归档和删除操作\n- 点击下方 ＋：新建便签\n- Dock 栏固定在屏幕边缘居中，位置可在设置中切换\n- 支持 Markdown 与任务清单\n\n创建第一张便签后，本指南会自动隐藏。",
  };
}
