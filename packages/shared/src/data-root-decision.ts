/**
 * 数据根初始化决策协议（桌面决策窗口 / 设置页再次导入）。
 *
 * 决策发生在主窗口与 Host 之前：renderer 只做展示与用户选择，所有文件操作和
 * 状态判定都在 main 进程的初始化器中完成（唯一所有者）。
 */
import type { Locale } from "./protocol.js";

export const DataRootDecisionChannels = {
  /** Renderer → Main：拉取决策状态（状态、候选、磁盘预检）。 */
  GetState: "zcodium:data-root-decision:get-state",
  /** Renderer → Main：提交选择（migrate | fresh | quit）。 */
  Decide: "zcodium:data-root-decision:decide",
  /** Main → Renderer：迁移进度。 */
  Progress: "zcodium:data-root-decision:progress",
  /** Main → Renderer：状态更新（sizeBytes/磁盘预检完成后推送）。 */
  StateChanged: "zcodium:data-root-decision:state-changed",
} as const;

export const DataRootImportChannels = {
  /** Renderer → Main：设置页拉取可再次导入的旧数据候选。 */
  GetCandidates: "zcodium:data-root-import:get-candidates",
  /** Renderer → Main：执行再次导入（备份现有新根后全量复制）。 */
  Execute: "zcodium:data-root-import:execute",
} as const;

export type DataRootDecisionStatusKind = "absent-with-legacy" | "unowned" | "corrupt";

export interface DataRootDecisionStatus {
  kind: DataRootDecisionStatusKind;
  /**
   * unowned: manifest-missing | product-mismatch；
   * corrupt: manifest-unreadable | schema-unsupported。
   */
  reason?: string;
  /** 发送 pending 的 base 目录。 */
  baseDir: string;
  /** unowned/corrupt 时的冲突目录 {base}/.zcodium；absent 时为 undefined。 */
  conflictingRoot?: string;
}

export interface DataRootDecisionCandidate {
  baseDir: string;
  legacyRoot: string;
  /** null 表示后台统计尚未完成。 */
  sizeBytes: number | null;
  modifiedAt: string | null;
  /** 当前启动 base 的候选（迁移目的地），其余为旧 setting.json 发现的自定义 base。 */
  isPrimaryBase: boolean;
}

export interface DataRootDecisionState {
  /**
   * startup：启动决策（迁移/全新/退出）；
   * import：设置页再次导入（导入/取消）。
   */
  mode: "startup" | "import";
  status: DataRootDecisionStatus;
  candidates: DataRootDecisionCandidate[];
  /** 候选所在卷的空闲空间（字节）；统计失败为 null。 */
  diskFreeBytes: number | null;
  /** 迁移所需空间（预检值）。 */
  requiredBytes: number | null;
  /** main 进程维护的界面语言；决策窗口不得另读系统语言或 localStorage。 */
  locale: Locale;
}

export type DataRootDecisionAction = "migrate" | "fresh" | "quit";

export type DataRootDecisionResult = { ok: true; action: DataRootDecisionAction } | { ok: false; error: string };

export type DataRootDecisionProgressPhase = "preparing" | "copying" | "finalizing";

export interface DataRootDecisionProgress {
  phase: DataRootDecisionProgressPhase;
  copiedBytes: number;
  totalBytes: number | null;
  /** 当前复制的 base（多候选时展示用）。 */
  currentBaseDir?: string;
}

export interface DataRootImportCandidate {
  baseDir: string;
  legacyRoot: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export type DataRootImportExecuteResult = { ok: true } | { ok: false; error: string };

/** 决策窗口 preload 暴露的 API（window.zcodiumDataRootDecision）。 */
export interface DataRootDecisionBridge {
  getState(): Promise<DataRootDecisionState>;
  decide(action: DataRootDecisionAction): Promise<DataRootDecisionResult>;
  onProgress(listener: (progress: DataRootDecisionProgress) => void): () => void;
  onStateChanged(listener: (state: DataRootDecisionState) => void): () => void;
}

/** 主窗口设置页再次导入 API（window.zcode.dataRootImport）。 */
export interface DataRootImportBridge {
  getCandidates(): Promise<DataRootImportCandidate[]>;
  execute(baseDirs: string[]): Promise<DataRootImportExecuteResult>;
}
