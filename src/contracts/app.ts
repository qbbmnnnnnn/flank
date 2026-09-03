export interface AppInfo {
  name: string;
  version: string;
  databaseReady: boolean;
}

export interface AppError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
