import { useEffect, useSyncExternalStore } from "react";
import { requestRepository } from "../api/bundleRepositories";
import { loadRepository, repositoryStorage, REPOSITORY_STORAGE_KEY } from "../services/bundleRepositories";
import { createRepositoryController } from "../utils/bundleRepositoryController";
import type { BundleRepository } from "../types/bundleRepository";

let controller: ReturnType<typeof createRepositoryController> | undefined;
export function useBundleRepositories(active: boolean, kind?: BundleRepository["kind"]) {
  controller ||= createRepositoryController(repositoryStorage(localStorage), (repo, signal, githubProxy) => loadRepository(repo, requestRepository, signal, githubProxy));
  const current = controller;
  const state = useSyncExternalStore(current.subscribe, current.getSnapshot);
  useEffect(() => { if (active) void current.refresh(undefined, true, kind); }, [active, current, kind, state.repositories]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === null || event.key === REPOSITORY_STORAGE_KEY) current.reload(); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [current]);
  return { state, actions: current };
}
