import { z } from "zod";
import { ZCODE_VERSION } from "../version.js";

declare const __ZCODE_MIN_COMPATIBLE_VERSION__: string;

export const ZCODE_MIN_COMPATIBLE_VERSION =
  typeof __ZCODE_MIN_COMPATIBLE_VERSION__ !== "undefined"
    ? __ZCODE_MIN_COMPATIBLE_VERSION__
    : ZCODE_VERSION;

/**
 * 远端服务支持设备卡停止 / 重启合同（`zcode stop --wait` 等，RDLC-01）的首个版本，桌面端据此做版本门禁。
 * 取首个包含本合同的正式版 3.17.0。不提升最低兼容版本。
 *
 * Bug 原因：曾先后取 3.16.2（根版本占位）和 3.16.3（假设下一次发版包含本合同）。实际 v3.16.3 从 release 分支发布、
 * 不含本合同，两次都等于已发布、不支持本合同的版本：旧 CLI 把 `stop --wait` 当成 ack 型 stop、把 `restart` 当成只换 Core，
 * 桌面端收不到最终状态而报失败，但远端已执行停止或换 Core。
 * 只看版本号区分不开开发中与已发布的同号版本，因此取实际首发版本；根版本升到 3.17.0 前开发构建也会显示禁用。
 */
export const SOURCE_SERVER_LIFECYCLE_CONTROL_MIN_VERSION = "3.17.0";

export const compatibilityManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    productVersion: z.string().trim().min(1),
    minCompatibleVersion: z.string().trim().min(1),
  })
  .strict();

export type CompatibilityManifest = z.infer<typeof compatibilityManifestSchema>;

export function createCompatibilityManifest(
  productVersion = ZCODE_VERSION,
  minCompatibleVersion = ZCODE_MIN_COMPATIBLE_VERSION,
): CompatibilityManifest {
  return compatibilityManifestSchema.parse({
    schemaVersion: 1,
    productVersion,
    minCompatibleVersion,
  });
}

export const ZCODE_COMPATIBILITY_MANIFEST = Object.freeze(createCompatibilityManifest());

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match) throw new Error(`Invalid compatibility version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

export function compareCompatibilityVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    const comparison = compareIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export interface SourceServerCompatibilityResult {
  compatible: boolean;
  updateAvailable: boolean;
  newerEndpoint: "controller" | "server" | "equal";
  upgradeTarget?: "controller" | "server";
  newerVersion: string;
  olderVersion: string;
  requiredMinimumVersion: string;
}

export function evaluateSourceServerCompatibility(
  controller: CompatibilityManifest,
  server: CompatibilityManifest,
): SourceServerCompatibilityResult {
  const comparison = compareCompatibilityVersions(controller.productVersion, server.productVersion);
  const newerEndpoint = comparison > 0 ? "controller" : comparison < 0 ? "server" : "equal";
  const newer = comparison >= 0 ? controller : server;
  const older = comparison >= 0 ? server : controller;
  const compatible =
    compareCompatibilityVersions(older.productVersion, newer.minCompatibleVersion) >= 0;
  return {
    compatible,
    updateAvailable: comparison !== 0,
    newerEndpoint,
    ...(!compatible
      ? { upgradeTarget: comparison >= 0 ? ("server" as const) : ("controller" as const) }
      : {}),
    newerVersion: newer.productVersion,
    olderVersion: older.productVersion,
    requiredMinimumVersion: newer.minCompatibleVersion,
  };
}
