// ==========================================================================
// ProcWeaver src-next 通用首选项模型
// 映射自后端 GeneralSettings (src-tauri/src/commands/settings.rs)
// ==========================================================================

export interface GeneralSettings {
  mixedPort: number;
  controllerPort: number;
  enableControllerPort: boolean;
  allowLan: boolean;
  tunMode: boolean;
  autoStart: boolean;
  unifiedDelay: boolean;
  tcpConcurrent: boolean;
  geoLowMemory: boolean;
  minimizeOnClose: boolean;
  closeAction: "ask" | "minimize" | "exit";
  silentStart: boolean;
  autoRun: boolean;
  autoStartProcessRouting: boolean;
  onlyProxyTraffic: boolean;
  trafficMode: "app_proxy" | "user_mode" | "tun" | "windivert_v1";
  routingPriority: "domain_first" | "process_first" | "direct_first";
  speedTestUrl: string;
  speedTestConcurrency: number;
  healthProbeConcurrency: number;
  ipv6: boolean;
  findProcessMode: "auto" | "strict" | "off" | string;
  autoCloseConnections: boolean;
  appendSystemDns: boolean;
  logCapture: boolean;
  tabAnimation: boolean;
  trayMenuStyle: "modern" | "classic";
  autoDnsGuardWithBundle: boolean;
  shimMode: "disabled" | "path" | "ifeo";
  runMode: string;
  // 附加给前端排除白名单视图的联动缓存
  bypassList: string[];
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  mixedPort: 7890,
  controllerPort: 9090,
  enableControllerPort: true,
  allowLan: false,
  tunMode: false,
  autoStart: false,
  unifiedDelay: true,
  tcpConcurrent: false,
  geoLowMemory: true,
  minimizeOnClose: true,
  closeAction: "ask",
  silentStart: false,
  autoRun: true,
  autoStartProcessRouting: false,
  onlyProxyTraffic: true,
  trafficMode: "app_proxy",
  routingPriority: "domain_first",
  speedTestUrl: "https://cp.cloudflare.com/generate_204",
  speedTestConcurrency: 10,
  healthProbeConcurrency: 4,
  ipv6: false,
  findProcessMode: "strict",
  autoCloseConnections: true,
  appendSystemDns: false,
  logCapture: true,
  tabAnimation: true,
  trayMenuStyle: "modern",
  autoDnsGuardWithBundle: true,
  shimMode: "disabled",
  runMode: "rule",
  bypassList: ["*.cn", "10.0.0.0/8", "192.168.0.0/16", "localhost"],
};
