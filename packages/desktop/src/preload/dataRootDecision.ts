/**
 * 数据根决策窗口的 preload。
 *
 * 只暴露决策需要的四个能力，不复用主窗口那个庞大的 preload —— 决策发生在 Host 启动前，
 * 攻击面越小越好，且窗口没有 zcode / services 依赖。
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  DataRootDecisionChannels,
  type DataRootDecisionAction,
  type DataRootDecisionBridge,
  type DataRootDecisionProgress,
  type DataRootDecisionState,
} from "@zcode/shared";

const bridge: DataRootDecisionBridge = {
  getState: () => ipcRenderer.invoke(DataRootDecisionChannels.GetState),
  decide: (action: DataRootDecisionAction) =>
    ipcRenderer.invoke(DataRootDecisionChannels.Decide, action),
  onProgress: (listener) => {
    const wrapped = (_event: unknown, payload: DataRootDecisionProgress) => listener(payload);
    ipcRenderer.on(DataRootDecisionChannels.Progress, wrapped);
    return () => ipcRenderer.removeListener(DataRootDecisionChannels.Progress, wrapped);
  },
  onStateChanged: (listener) => {
    const wrapped = (_event: unknown, payload: DataRootDecisionState) => listener(payload);
    ipcRenderer.on(DataRootDecisionChannels.StateChanged, wrapped);
    return () => ipcRenderer.removeListener(DataRootDecisionChannels.StateChanged, wrapped);
  },
};

contextBridge.exposeInMainWorld("zcodiumDataRootDecision", bridge);
