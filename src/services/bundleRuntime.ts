import { routingApi } from "../api/routingOverrides";
import { getBundleInstances, saveBundleInstances } from "./bundleStorage";
import { createBundleController } from "../utils/bundleController";
import { externalProxyApi } from "../api/externalProxy";
import { syncBundleDnsGuard } from "./bundleDnsGuard";

export const bundleController = createBundleController(routingApi, { load: getBundleInstances, save: saveBundleInstances }, externalProxyApi);

// 订阅业务包状态变化，自动触发与 DNS 护航的智能联动 (A+B 结合)
bundleController.subscribe(() => {
  const snap = bundleController.getSnapshot();
  const hasActiveBundle = snap.instances.some(i => i.enabled && i.slotBindings.main && i.backend !== "external")
    && snap.view?.config.bundlesEnabled !== false;
  const isRunning = Boolean(snap.view?.running);
  void syncBundleDnsGuard(hasActiveBundle, isRunning);
});
