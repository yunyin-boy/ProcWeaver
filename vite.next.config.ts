import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// 针对虚拟机共享盘/网络映射驱动器 (如 Z: 挂载点) 强制启用轮询监听，彻底解决底层 libuv 对网络共享文件的 EISDIR 误报
process.env.CHOKIDAR_USEPOLLING = "true";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  // 将工程根目录显式指定为 src-next，index.html 原生作为根视窗，彻底消除路径截断与中间件重定向冲突
  root: path.resolve(__dirname, "src-next"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [
    react(),
    // 纠正 VMware 共享驱动器 (Z: 盘) 在处理包含 "Shared Folders" 的 UNC 映射时偶发的路径截断 BUG
    {
      name: "vmware-shared-folders-fix",
      enforce: "pre",
      resolveId(source) {
        if (typeof source === "string" && source.includes(" Folders/")) {
          return source.replace(/([a-zA-Z]:)\s+Folders\//g, "$1/");
        }
        return null;
      },
      load(id) {
        if (typeof id === "string" && id.includes(" Folders/")) {
          const fixed = id.replace(/([a-zA-Z]:)\s+Folders\//g, "$1/");
          if (fs.existsSync(fixed)) {
            return fs.readFileSync(fixed, "utf-8");
          }
        }
        return null;
      },
    },
  ],
  clearScreen: false,
  resolve: {
    // 关键配置: 保留符号链接/映射盘符原貌，禁止 Node 将 Z: 递归展开为 \\vmware-host\Shared Folders UNC 路径
    preserveSymlinks: true,
    alias: {
      "@next": path.resolve(__dirname, "src-next"),
    },
  },
  server: {
    port: 1425,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1426,
        }
      : undefined,
    fs: {
      strict: false,
    },
    watch: {
      usePolling: true,
      interval: 200,
      ignored: ["**/src-tauri/**", "**/dist/**", "**/dist-next/**"],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-next"),
    emptyOutDir: true,
  },
});
