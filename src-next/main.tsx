// ==========================================================================
// ProcWeaver src-next 应用主入口
// ==========================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { readWindowOpacity } from "./utils/windowOpacity";
import "./styles/globals.css";
import "./styles/workbench.css";

document.documentElement.style.setProperty("--window-opacity", (readWindowOpacity() / 100).toFixed(2));

// 启动前恢复窗口的毛玻璃景深。
try {
  const savedBlur = localStorage.getItem("procweaver_window_blur");
  if (savedBlur) {
    document.documentElement.style.setProperty("--window-blur", `${savedBlur}px`);
  }
} catch {
  // 忽略安全沙箱本地存储访问限制
}

// --------------------------------------------------------------------------
// 桌面快捷键和右键菜单处理，显式标记的文本控件保留原生编辑菜单。
// --------------------------------------------------------------------------
window.addEventListener(
  "contextmenu",
  (e) => {
    if (e.target instanceof Element && e.target.closest("[data-native-context-menu]")) return;
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
