/** Состояния задачи у kie.ai. */
export type TaskState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

export const TERMINAL_STATES: readonly TaskState[] = ['success', 'fail'];

export interface TaskRecord {
  taskId: string;
  model: string;
  state: TaskState;
  /** Готовые URL. Живут у kie.ai 14 дней — забирать к себе сразу. */
  resultUrls: string[];
  failCode?: string;
  failMessage?: string;
  costTimeMs?: number;
  creditsConsumed?: number;
  progress?: number;
  createdAt?: string;
  completedAt?: string;
}

export interface UploadResult {
  fileName: string;
  filePath: string;
  downloadUrl: string;
}

/** Обёртка ответа kie.ai: HTTP 200 ещё не значит успех — смотри `code`. */
export interface KieEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}
