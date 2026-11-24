import { startCliMemoryDiagnostics } from "./index.js";

export function exampleMemoryDiagnostics(directory: string) {
  const diagnostics = startCliMemoryDiagnostics(() => ({ sessions: 0 }), directory);
  return () => diagnostics.stop();
}
