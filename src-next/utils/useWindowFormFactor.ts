// ==========================================================================
// ProcWeaver src-next 窗口多形态尺寸调度与自适应 Hook
// 规范溯源: tauri-desktop-layout-typography (Windows Snap 3-2-1 动态折叠模型)
// 四档形态: mini(380x580) / compact(1024x680) / standard(1160x740) / full(铺满全屏)
// ==========================================================================

import { useState, useEffect, useCallback } from "react";
import { invokeCommand, isTauriEnvironment } from "../services/client";

export type FormFactor = "mini" | "compact" | "standard" | "full";

export interface FormFactorDimensions {
  width: number | string;
  height: number | string;
}

export const FORM_FACTOR_SIZES: Record<FormFactor, FormFactorDimensions> = {
  mini: { width: 380, height: 580 },
  compact: { width: 1024, height: 680 },
  standard: { width: 1160, height: 740 },
  full: { width: "100%", height: "100%" },
};

const STORAGE_KEY_FORM_FACTOR = "procweaver_next_form_factor";
const STORAGE_KEY_PIN_TOP = "procweaver_next_pin_top";

export function useWindowFormFactor() {
  const isTauri = isTauriEnvironment();

  const [formFactor, setFormFactorState] = useState<FormFactor>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_FORM_FACTOR) as FormFactor;
      if (saved && saved in FORM_FACTOR_SIZES) return saved;
    } catch {}
    // 原生桌面端根据初始窗口尺寸计算，浏览器调试默认呈现 standard 标准视口
    if (typeof window !== "undefined" && isTauri) {
      const w = window.innerWidth;
      if (w <= 450) return "mini";
      if (w < 1100) return "compact";
    }
    return "standard";
  });

  const [isPinnedTop, setIsPinnedTop] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_PIN_TOP) === "true";
    } catch {
      return false;
    }
  });

  // 物理调整 Tauri 原生桌面窗口尺寸（由 Rust 后端执行双坐标记忆与几何尺寸恢复）
  const applyWindowSize = useCallback(
    async (factor: FormFactor) => {
      if (!isTauri) return;
      try {
        await invokeCommand("window_set_form_factor", { factor });
      } catch (err) {
        console.warn("[useWindowFormFactor] window_set_form_factor 原生调用失败:", err);
        // 兜底降级至前端直接调整
        try {
          const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
          const current = getCurrentWindow();
          const targetSize = FORM_FACTOR_SIZES[factor];
          if (typeof targetSize.width === "number" && typeof targetSize.height === "number") {
            await current.setSize(new LogicalSize(targetSize.width, targetSize.height));
          }
        } catch {}
      }
    },
    [isTauri]
  );

  // 切换视口形态
  const setFormFactor = useCallback(
    async (factor: FormFactor, shouldResizeWindow = true) => {
      setFormFactorState(factor);
      try {
        localStorage.setItem(STORAGE_KEY_FORM_FACTOR, factor);
      } catch {}
      if (shouldResizeWindow && isTauri) {
        await applyWindowSize(factor);
      }
    },
    [applyWindowSize, isTauri]
  );

  // 切换窗口置顶（常用于 Mini 挂件模式常驻桌面，由 Rust 原生调度与持久化）
  const togglePinTop = useCallback(async (explicitVal?: boolean) => {
    setIsPinnedTop((prev) => {
      const next = explicitVal !== undefined ? explicitVal : !prev;
      try {
        localStorage.setItem(STORAGE_KEY_PIN_TOP, String(next));
      } catch {}
      if (isTauriEnvironment()) {
        invokeCommand("window_set_always_on_top", { alwaysOnTop: next }).catch((err) => {
          console.warn("[useWindowFormFactor] window_set_always_on_top 原生调用失败:", err);
          import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().setAlwaysOnTop(next))
            .catch(() => {});
        });
      }
      return next;
    });
  }, []);

  // 监听原生窗口 resize 事件：仅在 Tauri 原生桌面环境下由真实窗口拖拽驱动
  useEffect(() => {
    if (!isTauri) return; // 网页端浏览器绝不被外部全屏 resize 强制覆盖！

    const handleResize = () => {
      const w = window.innerWidth;
      if (w <= 450) {
        setFormFactorState((prev) => (prev !== "mini" ? "mini" : prev));
      } else if (w < 1100) {
        setFormFactorState((prev) => (prev !== "compact" && prev !== "mini" ? "compact" : prev));
      } else if (w >= 1260) {
        setFormFactorState((prev) => (prev === "compact" || prev === "mini" ? "standard" : prev));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isTauri]);

  return {
    formFactor,
    setFormFactor,
    isPinnedTop,
    togglePinTop,
    dimensions: FORM_FACTOR_SIZES[formFactor],
  };
}

