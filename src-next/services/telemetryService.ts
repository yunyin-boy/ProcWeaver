// ==========================================================================
// ProcWeaver src-next 实时遥测流服务
// 规范溯源: rust-pro (Tokio Stream) / typography-dark-mono-optics
// 对接指令: get_traffic_snapshot
// 特性: 支持 bps / Kbps / Mbps / Gbps 动态自适应 (顶线支持 10Gbps)
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { BandwidthSnapshot } from "../types/telemetry";

interface RawTrafficSample {
  epoch: number | null;
  uploadTotal: number;
  downloadTotal: number;
  proxyUploadTotal?: number;
  proxyDownloadTotal?: number;
  connections?: Array<{ id: string; upload: number; download: number; proxied: boolean }>;
}

export function subscribeBandwidth(
  callback: (snapshot: BandwidthSnapshot) => void
): () => void {
  if (isTauriEnvironment()) {
    let active = true;
    let previous: RawTrafficSample | null = null;
    let lastTime = Date.now();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const sample = await invokeCommand<RawTrafficSample>("get_traffic_snapshot", {
          includeConnections: false,
        });

        if (!active) return;
        const now = Date.now();
        const seconds = previous ? Math.max((now - lastTime) / 1000, 0.2) : 1;

        let upSpeed = 0;
        let downSpeed = 0;

        if (previous && sample) {
          if (sample.epoch === previous.epoch && sample.uploadTotal >= previous.uploadTotal && sample.downloadTotal >= previous.downloadTotal) {
            upSpeed = Math.max(0, (sample.uploadTotal - previous.uploadTotal) / seconds);
            downSpeed = Math.max(0, (sample.downloadTotal - previous.downloadTotal) / seconds);
          }
        }

        previous = sample;
        lastTime = now;

        callback({
          uploadRateBytes: Math.round(upSpeed),
          downloadRateBytes: Math.round(downSpeed),
          uploadTotalBytes: sample?.uploadTotal || 0,
          downloadTotalBytes: sample?.downloadTotal || 0,
        });
      } catch (err) {
        // 内核未启动或读取监控超时时保持 0 速率
        if (active) {
          callback({
            uploadRateBytes: 0,
            downloadRateBytes: 0,
            uploadTotalBytes: previous?.uploadTotal || 0,
            downloadTotalBytes: previous?.downloadTotal || 0,
          });
        }
      } finally {
        if (active) {
          pollTimer = setTimeout(poll, 1000);
        }
      }
    };

    pollTimer = setTimeout(poll, 100);

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }

  // 纯浏览器环境：生成真实波动的遥测数据流，便于测试等宽防抖排版
  let uploadAccum = 45210984;
  let downloadAccum = 894312093;

  const timer = setInterval(() => {
    // 模拟微波动数据（支持宽范围波动，从数百 KB 到百兆 Mbps）
    const upDelta = Math.floor(Math.random() * 850000) + 120000;
    const downDelta = Math.floor(Math.random() * 6500000) + 800000;
    uploadAccum += upDelta;
    downloadAccum += downDelta;

    callback({
      uploadRateBytes: upDelta,
      downloadRateBytes: downDelta,
      uploadTotalBytes: uploadAccum,
      downloadTotalBytes: downloadAccum,
    });
  }, 1000);

  return () => clearInterval(timer);
}

export interface FormattedRate {
  value: string;
  unit: "bps" | "Kbps" | "Mbps" | "Gbps";
  rawBps: number;
}

/**
 * 格式化字节速率为电信标准比特率 (bps / Kbps / Mbps / Gbps)
 * 进位制: 1000 (SI 标准, 1 Byte = 8 bits)
 * 顶线支持覆盖: 10 Gbps 甚至更高
 */
export function formatBitrate(bytesPerSec: number): FormattedRate {
  if (!bytesPerSec || bytesPerSec <= 0) {
    return { value: "0", unit: "bps", rawBps: 0 };
  }

  const rawBps = bytesPerSec * 8;

  // 1. 小于 1 Kbps
  if (rawBps < 1000) {
    return {
      value: Math.round(rawBps).toString(),
      unit: "bps",
      rawBps,
    };
  }

  // 2. 1 Kbps ~ 999.9 Kbps
  if (rawBps < 1000 * 1000) {
    const kb = rawBps / 1000;
    return {
      value: kb < 10 ? kb.toFixed(2) : kb < 100 ? kb.toFixed(1) : kb.toFixed(0),
      unit: "Kbps",
      rawBps,
    };
  }

  // 3. 1 Mbps ~ 999.9 Mbps
  if (rawBps < 1000 * 1000 * 1000) {
    const mb = rawBps / (1000 * 1000);
    return {
      value: mb < 10 ? mb.toFixed(2) : mb < 100 ? mb.toFixed(1) : mb.toFixed(0),
      unit: "Mbps",
      rawBps,
    };
  }

  // 4. >= 1 Gbps (支持 10 Gbps 及更高)
  const gb = rawBps / (1000 * 1000 * 1000);
  return {
    value: gb < 10 ? gb.toFixed(2) : gb.toFixed(1),
    unit: "Gbps",
    rawBps,
  };
}

/**
 * 格式化累计数据流量为存储二进制字节量 (B / KB / MB / GB / TB)
 * 进位制: 1024 (IEC 标准)
 */
export function formatTrafficBytes(bytes: number): { value: string; unit: string } {
  if (!bytes || bytes <= 0) {
    return { value: "0.0", unit: "B" };
  }

  const tb = bytes / (1024 * 1024 * 1024 * 1024);
  if (tb >= 1) return { value: tb.toFixed(2), unit: "TB" };

  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return { value: gb.toFixed(2), unit: "GB" };

  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return { value: mb.toFixed(1), unit: "MB" };

  const kb = bytes / 1024;
  if (kb >= 1) return { value: kb.toFixed(1), unit: "KB" };

  return { value: bytes.toString(), unit: "B" };
}

/**
 * 预设顶线档位表 (从 1 Mbps 到 10 Gbps 顶线)
 */
export const BITRATE_CEILING_TIERS_BPS: number[] = [
  1_000_000, // 1 Mbps
  2_500_000, // 2.5 Mbps
  5_000_000, // 5 Mbps
  10_000_000, // 10 Mbps
  25_000_000, // 25 Mbps
  50_000_000, // 50 Mbps
  100_000_000, // 100 Mbps
  250_000_000, // 250 Mbps
  500_000_000, // 500 Mbps
  1_000_000_000, // 1 Gbps
  2_500_000_000, // 2.5 Gbps
  5_000_000_000, // 5 Gbps
  10_000_000_000, // 10 Gbps (顶线封顶基准)
];

/**
 * 根据历史采样点最大峰值计算最匹配的动态顶线标尺 (自适应最高达 10 Gbps)
 */
export function calculateAdaptiveCeilingBps(
  peakBps: number,
  hardCeilingBps: number = 10_000_000_000
): number {
  const target = peakBps * 1.15;

  for (const tier of BITRATE_CEILING_TIERS_BPS) {
    if (tier >= target) {
      return Math.min(tier, hardCeilingBps);
    }
  }

  return hardCeilingBps;
}

/**
 * 兼容旧版调用格式
 */
export function formatSpeed(bytesPerSec: number): { value: string; unit: string } {
  const result = formatBitrate(bytesPerSec);
  return {
    value: result.value,
    unit: result.unit,
  };
}
