export interface AppInfo {
  name: string;
  version: string;
  databaseReady: boolean;
}

export interface AppSettings {
  language: string;
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  closeBehavior: "background" | "quit";
  dockEnabled: boolean;
  dockVisibleCount: number;
  dockSide: "left" | "right";
  verticalPosition: number;
  dockSize: "small" | "medium" | "large";
  hoverAnimation: boolean;
  actionDelay: number;
  fullscreenBehavior: "hide" | "show";
  displayPreference: "cursor" | "active" | "primary";
  font: string;
  fontSize: number;
  textDirection: "automatic" | "ltr" | "rtl";
  markdown: boolean;
  defaultColor: string;
  automaticUpdates: boolean;
}

export interface AppError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
