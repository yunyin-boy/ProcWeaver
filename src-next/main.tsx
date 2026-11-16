// ==========================================================================
// ProcWeaver src-next 应用主入口
// ==========================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

// 启动前即时恢复物理透明度与毛玻璃景深 (Zero-FOUC，确保黑曜石安全底垫)
try {
  const savedOpacity = localStorage.getItem("procweaver_window_opacity");
  if (savedOpacity) {
    const val = parseFloat(savedOpacity);
    const safeVal = isNaN(val) || val < 0.85 ? "0.95" : savedOpacity;
    document.documentElement.style.setProperty("--window-opacity", safeVal);
  } else {
    document.documentElement.style.setProperty("--window-opacity", "0.95");
  }
  const savedBlur = localStorage.getItem("procweaver_window_blur");
  if (savedBlur) {
    document.documentElement.style.setProperty("--window-blur", `${savedBlur}px`);
  }
} catch {
  // 忽略安全沙箱本地存储访问限制
}

// --------------------------------------------------------------------------
// 全局桌面环境安全加固: 彻底屏蔽 WebView2 原生右键上下文菜单与危险快捷键
// --------------------------------------------------------------------------
window.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  { capture: true }
);

window.addEventListener(
  "keydown",
  (e) => {
    // 屏蔽网页默认刷新 (F5, Ctrl+R, Command+R)
    if (
      e.key === "F5" ||
      ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"))
    ) {
      e.preventDefault();
      return;
    }
    // 屏蔽网页原生打印与保存 (Ctrl+P, Ctrl+S)
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "p" || e.key === "P" || e.key === "s" || e.key === "S")
    ) {
      e.preventDefault();
      return;
    }
  },
  { capture: true }
);

// 彻底拦截原生系统白框弹窗，防止任何第三方库或漏网调用产生白底 tauri.localhost 提示框
if (typeof window !== "undefined") {
  window.alert = (msg?: any) => {
    console.warn("[ProcWeaver Security] 原生 window.alert 已被桌面应用安全屏蔽:", msg);
  };
  window.confirm = (msg?: any) => {
    console.warn("[ProcWeaver Security] 原生 window.confirm 已被桌面应用安全屏蔽:", msg);
    return false;
  };
}

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
