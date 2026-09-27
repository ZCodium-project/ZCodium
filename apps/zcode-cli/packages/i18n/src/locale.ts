import type { SupportedLocale, UiLocale } from "@zcode/contracts";

export const DEFAULT_LOCALE: SupportedLocale = "en-US";
export const SUPPORTED_LOCALES = [
  "en-US",
  "zh-CN",
  "fa-IR",
] as const satisfies readonly SupportedLocale[];
const LOCALE_ENV_KEYS = ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"] as const;
const LANGUAGE_LIST_SEPARATOR = ":";
const LOCALE_ENCODING_SEPARATOR = ".";
const LOCALE_MODIFIER_SEPARATOR = "@";
const NON_LANGUAGE_LOCALES = new Set(["c", "posix"]);

export interface LocaleDetectionInput {
  env?: Record<string, string | undefined>;
  intlLocale?: string | null;
}

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return value === "en-US" || value === "zh-CN" || value === "fa-IR";
}

export function isUiLocale(value: string | undefined): value is UiLocale {
  return value === "auto" || isSupportedLocale(value);
}

export function resolveLocale(
  requested: UiLocale | string | undefined,
  detected?: string | null,
): SupportedLocale {
  const candidate = requested === "auto" ? detected : requested;
  return normalizeLocale(candidate) ?? DEFAULT_LOCALE;
}

export function detectLocale(input: LocaleDetectionInput = {}): SupportedLocale | undefined {
  for (const candidate of localeCandidates(input)) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return undefined;
}

function normalizeLocale(value: string | null | undefined): SupportedLocale | undefined {
  if (!value) return undefined;
  const tag = stripLocaleDecorators(value.trim()).replaceAll("_", "-");
  if (!tag || NON_LANGUAGE_LOCALES.has(tag.toLowerCase())) return undefined;
  if (isSupportedLocale(tag)) return tag;
  const lower = tag.toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) return "en-US";
  if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";
  if (lower === "fa" || lower.startsWith("fa-")) return "fa-IR";
  return undefined;
}

function* localeCandidates(input: LocaleDetectionInput): Iterable<string> {
  if (input.env) {
    for (const key of LOCALE_ENV_KEYS) {
      const value = input.env[key];
      if (!value) continue;
      yield* splitLocaleEnvValue(key, value);
    }
  }

  if (input.intlLocale) {
    yield input.intlLocale;
  }
}

function splitLocaleEnvValue(key: (typeof LOCALE_ENV_KEYS)[number], value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (key === "LANGUAGE") {
    return trimmed
      .split(LANGUAGE_LIST_SEPARATOR)
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0);
  }
  return [trimmed];
}

function stripLocaleDecorators(value: string): string {
  const withoutEncoding = value.split(LOCALE_ENCODING_SEPARATOR, 1)[0] ?? "";
  return withoutEncoding.split(LOCALE_MODIFIER_SEPARATOR, 1)[0] ?? "";
}
