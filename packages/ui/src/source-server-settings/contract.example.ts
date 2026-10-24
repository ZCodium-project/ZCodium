import type { SourceServerSettingsNavigation, SourceServerUpdateAction } from "./contract.js";

/** Root 交入原 owner 的方法，不在设置页再构造 connection manager。 */
export function sourceServerSettingsNavigationExample(owner: SourceServerSettingsNavigation) {
  return { ...owner } satisfies SourceServerSettingsNavigation;
}

export function guardedSourceUpdateExample(action: SourceServerUpdateAction) {
  return action;
}
