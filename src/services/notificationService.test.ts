import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissNotification, notification, receiveNotification } from "./notificationService";

describe("main window notifications", () => {
  afterEach(() => { dismissNotification(); vi.useRealTimers(); });

  it("replaces messages and restarts the dismissal timer", () => {
    vi.useFakeTimers();
    receiveNotification("已归档", "success");
    vi.advanceTimersByTime(3000);
    receiveNotification("删除失败", "error");
    vi.advanceTimersByTime(1000);
    expect(notification.value?.message).toBe("删除失败");
    expect(notification.value?.kind).toBe("error");
    vi.advanceTimersByTime(3000);
    expect(notification.value).toBeNull();
  });

  it("supports immediate dismissal", () => {
    receiveNotification("设置已保存");
    dismissNotification();
    expect(notification.value).toBeNull();
  });

  it("uses the info tone when no kind is given", () => {
    receiveNotification("请在桌面应用中导入本地图片");
    expect(notification.value?.kind).toBe("info");
  });

  it("gives every message a new id so the countdown restarts", () => {
    receiveNotification("已归档");
    const first = notification.value?.id;
    receiveNotification("已归档");
    expect(notification.value?.id).not.toBe(first);
  });
});
