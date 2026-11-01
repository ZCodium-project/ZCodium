import type { FileOpenAppsContract } from "./contract.js";

export async function exampleFileOpenApps(service: FileOpenAppsContract, localPath: string) {
  const target = { path: localPath, pathKind: "file" as const };
  const apps = await service.getFileApplications(target);
  const chosen = apps.find((app) => app.isDefault);
  if (chosen) return service.openFileWithApplication(chosen.id, target);
  return { success: false, error: "application_not_available" };
}
