/**
 * ZCodium 用户级数据根目录名（~/.zcodium）。
 *
 * 与官方 ZCode 客户端的 ~/.zcode 命名空间隔离，双方互不读写。
 * 旧值仅供 migrateLegacyZCodeDataRoot 的一次性迁移逻辑使用；
 * 工作区项目级 .zcode 目录（项目内 skills/commands/plugins/config）属于项目
 * 命名空间，不受本常量影响。
 */
export const ZCODE_DATA_ROOT_DIR_NAME = ".zcodium";
export const LEGACY_ZCODE_DATA_ROOT_DIR_NAME = ".zcode";
export const LEGACY_MIGRATION_MARKER_FILE = ".migrated-to-zcodium";
