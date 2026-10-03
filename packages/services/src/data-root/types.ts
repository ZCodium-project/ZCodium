/**
 * 数据根状态与初始化结果类型。
 *
 * 状态机（详见 docs/specs/zcodium-data-root.md）：
 * normal → 复用；absent → 有旧根则桌面决策、否则直接初始化；
 * unowned / corrupt → 决策或非交互备份让路，绝不静默复用。
 */
import type { DataRootManifest, DataRootManifestCreatedBy } from "@zcode/shared";

export type DataRootStatus =
  | { kind: "normal"; manifest: DataRootManifest }
  | { kind: "absent" }
  | { kind: "unowned"; reason: "manifest-missing" | "product-mismatch"; rootDir: string }
  | { kind: "corrupt"; reason: "manifest-unreadable" | "schema-unsupported"; rootDir: string };

/** 非交互入口（CLI / server / 远端）的处置策略。 */
export type DataRootNonInteractiveAction = "fresh" | "migrate" | "fail";

export interface DataRootInitOptions {
  /** 目标 base；缺省使用 getDataBaseDir()。 */
  baseDir?: string;
  createdBy: DataRootManifestCreatedBy;
  appVersion: string;
  /**
   * true = 桌面交互模式：absent 且有旧根、或 unowned/corrupt 时返回 pending，
   * 由决策窗口处置；false = 非交互模式：按 action 直接处置。
   */
  interactive: boolean;
  /** 非交互策略；缺省 fresh（备份让路 + 全新初始化）。 */
  action?: DataRootNonInteractiveAction;
}

export type DataRootInitResult =
  | {
      state: "ready";
      baseDir: string;
      status: Extract<DataRootStatus, { kind: "normal" }>;
    }
  | {
      state: "initialized";
      baseDir: string;
      initializedBy: "fresh" | "migration";
      /** unowned/corrupt 备份让路的落点（如有）。 */
      forfeitedRoot?: string;
    }
  | {
      state: "pending";
      baseDir: string;
      status: Extract<DataRootStatus, { kind: "absent" | "unowned" | "corrupt" }>;
    };

export interface LegacyDataRootCandidate {
  baseDir: string;
  /** {baseDir}/.zcode */
  legacyRoot: string;
  /** 当前启动 base（迁移目的地）；其余为旧 setting.json 发现的自定义 base。 */
  isPrimaryBase: boolean;
}

export interface LegacyDataRootCandidateStats {
  sizeBytes: number;
  modifiedAt: string | null;
  itemCount: number;
}

export interface DataRootMigrationProgress {
  phase: "preparing" | "copying" | "finalizing";
  copiedBytes: number;
  totalBytes: number | null;
  currentBaseDir?: string;
}

export type DataRootMigrationResult =
  | { ok: true; migratedBases: string[]; manifestPaths: string[] }
  | { ok: false; error: string; cancelled: boolean };
