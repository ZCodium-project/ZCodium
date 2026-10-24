/** 设备/连接的只读展示事实；连接、入口与恢复仍由现有 Host 和 Root owner 持有。 */
export type { ISourceServerManagementService } from "@zcode/services";
export interface ProjectDevicePresentation {
  readonly id: string;
  readonly label: string;
  readonly status: "online" | "connecting" | "offline" | "pending" | "failed";
}
