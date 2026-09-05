import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissNotification, notification, receiveNotification } from "./notificationService";

describe("main window notifications", () => {
  afterEach(() => { dismissNotification(); vi.useRealTimers(); });

  it("replaces messages and restarts the dismissal timer", () => {
    vi.useFakeTimers();
    receiveNotification("已归档");
    vi.advanceTimersByTime(3000);
    receiveNotification("删除失败");
    vi.advanceTimersByTime(1000);
    expect(notification.value).toBe("删除失败");
    vi.advanceTimersByTime(3000);
    expect(notification.value).toBe("");
  });

  it("supports immediate dismissal", () => {
    receiveNotification("设置已保存");
    dismissNotification();
    expect(notification.value).toBe("");
  });
});
