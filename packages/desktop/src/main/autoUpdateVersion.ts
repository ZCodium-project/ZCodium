import semver from "semver";

/** 更新链路比较版本时统一先做 coerce，兼容带前后缀的构建版本号。 */
export function normalizeVersionForCompare(version: string): string | null {
  return semver.valid(semver.coerce(version.trim()));
}

function isLegacyMajorToForkMajorUpgrade(
  candidate: semver.SemVer,
  baseline: semver.SemVer,
): boolean {
  // #50：审计版把版本线从 legacy 3.x 迁到 1.x 后，SemVer 会把 1.0.2 判成低于 3.14.7，
  // legacy 安装的内置更新因此永远看不到迁移包。仅当基线仍是 legacy 3.x 且候选是
  // fork 1.x 时视为升级，不影响 1.x 内部的正常版本比较。
  return semver.major(baseline) >= 3 && semver.major(candidate) === 1;
}

export function isVersionGreaterThan(candidateVersion: string, baselineVersion: string): boolean {
  const candidate = normalizeVersionForCompare(candidateVersion);
  const baseline = normalizeVersionForCompare(baselineVersion);
  if (candidate && baseline) {
    const candidateSemver = semver.parse(candidate);
    const baselineSemver = semver.parse(baseline);
    if (
      candidateSemver &&
      baselineSemver &&
      isLegacyMajorToForkMajorUpgrade(candidateSemver, baselineSemver)
    ) {
      return true;
    }
    return semver.gt(candidate, baseline);
  }

  return candidateVersion.trim() !== baselineVersion.trim();
}
