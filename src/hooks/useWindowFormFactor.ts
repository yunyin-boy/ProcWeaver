import { useState, useEffect, useCallback } from "react";
import { isTauri } from "../api";

export type FormFactor = "mini" | "compact" | "standard" | "studio";

export interface FormFactorDimensions {
  width: number;
  height: number;
}

export const FORM_FACTOR_SIZES: Record<FormFactor, FormFactorDimensions> = {
  mini: { width: 380, height: 580 },
  compact: { width: 1024, height: 680 },
  standard: { width: 1160, height: 740 },
  studio: { width: 1280, height: 820 },
};

export function useWindowFormFactor() {
  const [formFactor, setFormFactorState] = useState<FormFactor>(() => {
    try {
      const saved = localStorage.getItem("procweaver_form_factor") as FormFactor;
      if (saved && saved in FORM_FACTOR_SIZES) return saved;
    } catch {}
    return "standard";
  });

  const [isPinnedTop, setIsPinnedTop] = useState<boolean>(() => {
    try {
      return localStorage.getItem("procweaver_pin_top") === "true";
    } catch {
      return false;
    }
  });

  const applyWindowSize = useCallback(async (factor: FormFactor) => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      const current = getCurrentWindow();
      const isMax = await current.isMaximized();
      if (isMax) {
        await current.unmaximize();
      }
      const targetSize = FORM_FACTOR_SIZES[factor];
      await current.setSize(new LogicalSize(targetSize.width, targetSize.height));
    } catch (err) {
      console.warn("调整窗口尺寸失败:", err);
    }
  }, []);

  const setFormFactor = useCallback(
    async (factor: FormFactor, shouldResizeWindow = true) => {
      setFormFactorState(factor);
      try {
        localStorage.setItem("procweaver_form_factor", factor);
      } catch {}
      if (shouldResizeWindow) {
        await applyWindowSize(factor);
      }
    },
    [applyWindowSize]
  );

  const togglePinTop = useCallback(async (explicitVal?: boolean) => {
    setIsPinnedTop((prev) => {
      const next = explicitVal !== undefined ? explicitVal : !prev;
      try {
        localStorage.setItem("procweaver_pin_top", String(next));
      } catch {}
      if (isTauri()) {
        import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().setAlwaysOnTop(next))
          .catch((err) => console.warn("设置窗口置顶失败:", err));
      }
      return next;
    });
  }, []);

  // 监听窗口大小变化（例如用户手动拖拽调整时），同步计算最契合的形态
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w <= 450) {
        setFormFactorState((prev) => (prev !== "mini" ? "mini" : prev));
      } else if (w < 1100) {
        setFormFactorState((prev) => (prev !== "compact" && prev !== "mini" ? "compact" : prev));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    formFactor,
    setFormFactor,
    isPinnedTop,
    togglePinTop,
    dimensions: FORM_FACTOR_SIZES[formFactor],
  };
}
