import { invoke } from "@tauri-apps/api/core";
import type { BundleLocalInstance } from "../types/businessBundle";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("此功能需要桌面客户端；浏览器预览无法读取或保存业务包");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "业务包操作失败");
  }
}

export const businessBundlesApi = {
  load: () => call<BundleLocalInstance[] | null>("get_business_bundles"),
  save: (instances: BundleLocalInstance[]) => call<void>("save_business_bundles", { instances }),
};
