import { invoke } from "@tauri-apps/api/core";
import type { AppUpdateInfo } from "../types";
export const processUpdateApi = {
  check: () => invoke<AppUpdateInfo>("check_process_update"),
  download: () => invoke<string>("download_process_update"),
  openFolder: (path?: string) => invoke<void>("open_process_update_folder", { path }),
};
