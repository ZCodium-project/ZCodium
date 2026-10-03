/**
 * MCP 用户目录模块 - 类型和常量定义
 */

import type { CliMcpSource, McpFileFormat } from "@zcode/shared";

/**
 * MCP 配置键名类型
 * - mcpServers: 通用 JSON 目录格式（.agents/mcp.json）
 * - mcp.servers: zcode CLI config.json 格式
 */
export type McpConfigKeyName = "mcpServers" | "mcp.servers";

export interface McpSourceDescriptor {
  source: CliMcpSource;
  configDirSegments: string[];
  fileName: string;
  format: McpFileFormat;
  configKeyName: McpConfigKeyName;
}

export const MCP_SOURCE_DESCRIPTORS: McpSourceDescriptor[] = [
  {
    source: "zcodeagentmcp",
    configDirSegments: [".zcodium", "cli"],
    fileName: "config.json",
    format: "json",
    configKeyName: "mcp.servers",
  },
];

export function getSourceDescriptor(source: CliMcpSource): McpSourceDescriptor {
  const descriptor = MCP_SOURCE_DESCRIPTORS.find((item) => item.source === source);
  if (!descriptor) {
    throw new Error(`Unsupported MCP source: ${source}`);
  }
  return descriptor;
}
