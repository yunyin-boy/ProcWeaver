import { routingApi } from "../api/routingOverrides";
import { getBundleInstances, saveBundleInstances } from "./bundleStorage";
import { createBundleController } from "../utils/bundleController";
import { externalProxyApi } from "../api/externalProxy";
import { syncBundleDnsGuard } from "./bundleDnsGuard";

export const bundleController = createBundleController(routingApi, { load: getBundleInstances, save: saveBundleInstances }, externalProxyApi);

// 清理旧版业务自动创建的系统护航；手动护航与业务生命周期独立。
bundleController.subscribe(() => {
  const snap = bundleController.getSnapshot();
  const hasActiveBundle = snap.instances.some(i => i.enabled && i.slotBindings.main && i.backend !== "external")
    && snap.view?.config.bundlesEnabled !== false;
  const isRunning = Boolean(snap.view?.running);
  void syncBundleDnsGuard(hasActiveBundle, isRunning);
});
