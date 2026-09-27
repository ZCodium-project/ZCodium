// Config Port - Scoped configuration with change notification

import type { CollaborationMode } from "../interfaces/session.port.js";
import type { McpServerConfig } from "../interfaces/mcp.port.js";
import type { HooksRuntimeConfig, HooksRuntimeConfigPatch } from "../hooks/index.js";
import type { PluginConfig, PluginOptionValues } from "../plugins/index.js";

// ============================================================
// Config Key Types
// ============================================================

export const ConfigKey = {
  ModelStreamIdleTimeout: "modelStream.idleTimeoutMs",

  // Permission
  PermissionMode: "permission.mode",
  PermissionAllowedTools: "permission.allowedTools",
  PermissionDisallowedTools: "permission.disallowedTools",
  PermissionAutoApproveHighRisk: "permission.autoApproveHighRisk",
  PermissionAllowMediumRiskInAuto: "permission.allowMediumRiskInAuto",

  // Storage
  StorageDir: "storage.dir",
  StorageSessionDbPath: "storage.sessionDbPath",

  // Network
  HttpProxy: "network.httpProxy",
  NoProxy: "network.noProxy",
  CaCertFile: "network.caCertFile",
  HttpTimeout: "network.timeout",

  // Features
  FeatureCompact: "features.compact",
  FeatureRewind: "features.rewind",
  FeatureSubagent: "features.subagent",
  FeatureMemory: "features.memory",
  FeatureSkill: "features.skill",
  FeatureMcp: "features.mcp",

  // Memory
  MemoryUse: "memory.use",

  // MCP
  McpServers: "mcp.servers",

  // Plugins
  PluginsEnabled: "plugins.enabled",
  PluginsDirs: "plugins.dirs",
  PluginsEnabledPlugins: "plugins.enabledPlugins",
  PluginsExtraKnownMarketplaces: "plugins.extraKnownMarketplaces",
  PluginsOptions: "plugins.options",
  PluginsSuppressedBuiltins: "plugins.suppressedBuiltins",

  // Skills
  SkillsEnabled: "skills.enabled",
  SkillsIncludeInstructions: "skills.includeInstructions",
  SkillsMetadataBudget: "skills.metadataBudget",
  SkillsRoots: "skills.roots",

  // Skill / Command 可用性覆盖（按 SKILL.md / 命令 .md 的绝对路径过滤）
  SkillOverrides: "skill",
  CommandOverrides: "command",

  // Logging
  LogLevel: "logging.level",
  LogFormat: "logging.format",

  // Tool Concurrency
  ToolConcurrencyMax: "toolConcurrency.maxConcurrency",

  // Model anomaly guards
  ModelAnomalyGuard: "modelAnomalyGuard",

  // Hooks
  Hooks: "hooks",

  // UI
  UiLocale: "ui.locale",
  UiTheme: "ui.theme",
} as const;

export type ConfigKey = (typeof ConfigKey)[keyof typeof ConfigKey];

// ============================================================
// Config Value Types
// ============================================================

export type ConfigValue<K extends ConfigKey> = K extends "modelStream.idleTimeoutMs"
  ? number
  : K extends "permission.mode"
    ? CollaborationMode
    : K extends "permission.allowedTools" | "permission.disallowedTools"
      ? string[]
      : K extends "permission.autoApproveHighRisk" | "permission.allowMediumRiskInAuto"
        ? boolean
        : K extends
              | "storage.dir"
              | "storage.sessionDbPath"
              | "network.httpProxy"
              | "network.noProxy"
              | "network.caCertFile"
          ? string | undefined
          : K extends "network.timeout"
            ? number
            : K extends
                  | "features.compact"
                  | "features.rewind"
                  | "features.subagent"
                  | "features.memory"
                  | "features.skill"
                  | "features.mcp"
                  | "skills.enabled"
                  | "skills.includeInstructions"
              ? boolean
              : K extends "memory.use"
                ? boolean
                : K extends "skills.metadataBudget"
                  ? number
                  : K extends "skills.roots"
                    ? string[]
                    : K extends "skill" | "command"
                      ? Record<string, SkillCommandOverride>
                      : K extends "mcp.servers"
                        ? Record<string, McpServerConfig>
                        : K extends "plugins.enabled"
                          ? boolean
                          : K extends "plugins.dirs"
                            ? string[]
                            : K extends "plugins.enabledPlugins"
                              ? Record<string, boolean>
                              : K extends "plugins.extraKnownMarketplaces"
                                ? PluginConfig["extraKnownMarketplaces"]
                                : K extends "plugins.options"
                                  ? Record<string, PluginOptionValues>
                                  : K extends "plugins.suppressedBuiltins"
                                    ? string[]
                                    : K extends "logging.level"
                                      ? "debug" | "info" | "warn" | "error"
                                      : K extends "logging.format"
                                        ? "text" | "json"
                                        : K extends "toolConcurrency.maxConcurrency"
                                          ? number
                                          : K extends "modelAnomalyGuard"
                                            ? ModelAnomalyGuardConfig
                                            : K extends "hooks"
                                              ? HooksRuntimeConfig
                                              : K extends "ui.locale"
                                                ? UiLocale
                                                : K extends "ui.theme"
                                                  ? UiThemePreference
                                                  : unknown;

// ============================================================
// Config Scope
// ============================================================

export const ConfigScope = {
  System: "system",
  User: "user",
  Project: "project",
  Session: "session",
  Env: "env",
  Cli: "cli",
} as const;

export type ConfigScope = (typeof ConfigScope)[keyof typeof ConfigScope];

export const ConfigScopePriority: Record<ConfigScope, number> = {
  [ConfigScope.System]: 0,
  [ConfigScope.User]: 10,
  [ConfigScope.Project]: 20,
  [ConfigScope.Session]: 30,
  [ConfigScope.Env]: 40,
  [ConfigScope.Cli]: 50,
};

// ============================================================
// Config Source
// ============================================================

export interface ConfigSource {
  scope: ConfigScope;
  key: ConfigKey;
  value: unknown;
  path?: string; // For file-based configs, the file path
}

// ============================================================
// Skill / Command 可用性覆盖
// ============================================================

// 按绝对路径覆盖单个 skill / 命令是否可用。未列出的条目默认可用，
// 只有显式 enable:false 才会在发现阶段被过滤掉。
export interface SkillCommandOverride {
  enable?: boolean;
}

// ============================================================
// Runtime Config
// ============================================================

export interface RuntimeConfig {
  modelStream: ModelStreamConfig;
  permission: {
    mode: CollaborationMode;
    allowedTools: string[];
    disallowedTools: string[];
    autoApproveHighRisk: boolean;
    allowMediumRiskInAuto: boolean;
  };
  storage: {
    dir: string;
    sessionDbPath: string;
  };
  network: {
    httpProxy?: string;
    noProxy?: string;
    caCertFile?: string;
    timeout: number;
  };
  features: {
    compact: boolean;
    rewind: boolean;
    subagent: boolean;
    memory: boolean;
    skill: boolean;
    mcp: boolean;
  };
  memory: {
    use: boolean;
  };
  mcp: {
    servers: Record<string, McpServerConfig>;
  };
  plugins: PluginConfig;
  skills: {
    enabled: boolean;
    includeInstructions: boolean;
    metadataBudget: number;
    roots: string[];
    [skillPath: string]: boolean | number | string[] | { enable?: boolean };
  };
  // key 为 SKILL.md 绝对路径，value.enable=false 表示禁用该 skill
  skillOverrides: Record<string, SkillCommandOverride>;
  // key 为命令 .md 绝对路径，value.enable=false 表示禁用该命令
  commandOverrides: Record<string, SkillCommandOverride>;
  logging: {
    level: "debug" | "info" | "warn" | "error";
    format: "text" | "json";
  };
  toolConcurrency: ToolConcurrencyConfig;
  modelAnomalyGuard: ModelAnomalyGuardConfig;
  hooks: HooksRuntimeConfig;
  ui: {
    locale: UiLocale;
    theme: UiThemePreference;
  };
}

export interface RuntimeConfigPatch {
  modelStream?: Partial<ModelStreamConfig>;
  permission?: Partial<RuntimeConfig["permission"]>;
  storage?: Partial<RuntimeConfig["storage"]>;
  network?: Partial<RuntimeConfig["network"]>;
  features?: Partial<RuntimeConfig["features"]>;
  memory?: Partial<RuntimeConfig["memory"]>;
  mcp?: Partial<RuntimeConfig["mcp"]>;
  plugins?: Partial<RuntimeConfig["plugins"]>;
  skills?: Partial<RuntimeConfig["skills"]>;
  skillOverrides?: RuntimeConfig["skillOverrides"];
  commandOverrides?: RuntimeConfig["commandOverrides"];
  logging?: Partial<RuntimeConfig["logging"]>;
  toolConcurrency?: Partial<RuntimeConfig["toolConcurrency"]>;
  modelAnomalyGuard?: Partial<RuntimeConfig["modelAnomalyGuard"]>;
  hooks?: HooksRuntimeConfigPatch;
  ui?: Partial<RuntimeConfig["ui"]>;
}

export type SupportedLocale = "en-US" | "zh-CN" | "fa-IR";
export type UiLocale = SupportedLocale | "auto";
export type UiThemeMode = "dark" | "light";
export type UiThemePreference = UiThemeMode | "auto";

export const DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS = 600_000;

export interface ModelStreamConfig {
  idleTimeoutMs: number;
}

export const DefaultRuntimeConfig: RuntimeConfig = {
  modelStream: {
    idleTimeoutMs: DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS,
  },
  permission: {
    mode: "build",
    allowedTools: [],
    disallowedTools: [],
    autoApproveHighRisk: false,
    allowMediumRiskInAuto: false,
  },
  storage: {
    dir: "~/.zcode",
    sessionDbPath: "~/.zcode/cli/db/db.sqlite",
  },
  network: {
    timeout: 180000,
  },
  features: {
    compact: true,
    rewind: true,
    subagent: true,
    memory: true,
    skill: true,
    mcp: true,
  },
  memory: {
    use: true,
  },
  mcp: {
    servers: {},
  },
  plugins: {
    dirs: [],
    enabled: true,
    enabledPlugins: {},
    extraKnownMarketplaces: {},
    options: {},
    suppressedBuiltins: [],
  },
  skills: {
    enabled: true,
    includeInstructions: true,
    metadataBudget: 20_000,
    roots: [],
  },
  skillOverrides: {},
  commandOverrides: {},
  logging: {
    level: "info",
    format: "text",
  },
  toolConcurrency: {
    maxConcurrency: 10,
  },
  modelAnomalyGuard: {
    maxBudgetWarningsPerTurn: 3,
    repeatedToolCallWarningThreshold: 3,
  },
  hooks: {
    enabled: false,
    events: {},
    maxOutputBytes: 32768,
    timeoutMs: 60000,
  },
  ui: {
    locale: "en-US",
    theme: "auto",
  },
};

// ============================================================
// Tool Concurrency Config
// ============================================================

export interface ToolConcurrencyConfig {
  maxConcurrency: number;
}

export interface ModelAnomalyGuardConfig {
  toolCallWarningThreshold?: number;
  repeatedToolCallWarningThreshold: number;
  maxBudgetWarningsPerTurn: number;
}

// ============================================================
// Config Port Interface
// ============================================================

export interface Unsubscribe {
  (): void;
}

export interface ConfigObserver {
  subscribe<K extends ConfigKey>(
    key: K,
    handler: (value: ConfigValue<K>, prev: ConfigValue<K>) => void,
  ): Unsubscribe;
  subscribeAll(handler: (key: ConfigKey, value: unknown, prev: unknown) => void): Unsubscribe;
}

export interface ConfigPort {
  // Get configuration value
  get<K extends ConfigKey>(key: K): ConfigValue<K>;
  getAll(): RuntimeConfig;

  // Check if key exists
  has(key: ConfigKey): boolean;

  // Set configuration value (runtime only, not persisted by default)
  set<K extends ConfigKey>(key: K, value: ConfigValue<K>): void;

  // Get observer for scoped subscriptions
  observe(): ConfigObserver;

  // Get all sources for a key (for debugging/audit)
  getSources(key: ConfigKey): ConfigSource[];

  // Merge additional config (e.g., from file/env)
  merge(config: RuntimeConfigPatch, scope: ConfigScope): void;
}
