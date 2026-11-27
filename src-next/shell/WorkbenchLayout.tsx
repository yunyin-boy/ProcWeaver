import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { WindowChrome } from "./WindowChrome";

interface WorkbenchLayoutProps<Tab extends string> {
  navigation: readonly (readonly { id: Tab; label: string; icon: LucideIcon }[])[];
  currentTab: Tab;
  onSelectTab: (tab: Tab) => void;
  chrome: Omit<ComponentProps<typeof WindowChrome>, "sidebarToggle">;
  sidebarStorageKey: string;
  railControls?: (collapsed: boolean) => ReactNode;
  statusBar?: ReactNode;
  children: ReactNode;
}

export function WorkbenchLayout<Tab extends string>({
  navigation, currentTab, onSelectTab, chrome, sidebarStorageKey, railControls, statusBar, children,
}: WorkbenchLayoutProps<Tab>) {
  const workbenchRef = useRef<HTMLDivElement>(null);
  const navigationId = useId();
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(sidebarStorageKey);
      if (saved === "true" || saved === "false") return saved === "true";
    } catch {}
    return null;
  });
  const [narrowWorkbench, setNarrowWorkbench] = useState(false);
  useEffect(() => {
    if (sidebarPreference !== null || !workbenchRef.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrowWorkbench(entry.contentRect.width <= 760));
    observer.observe(workbenchRef.current);
    return () => observer.disconnect();
  }, [sidebarPreference]);

  const isMini = chrome.formFactor === "mini";
  const collapsed = sidebarPreference ?? (chrome.formFactor === "compact" || narrowWorkbench);
  const SidebarIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const sidebarToggleLabel = collapsed ? "展开侧栏" : "收起侧栏";
  const pageLabel = isMini ? "桌面挂件" : navigation.flat().find(({ id }) => id === currentTab)?.label;

  return (
    <div
      ref={workbenchRef}
      className="workbench-window"
      data-mini={isMini || undefined}
      data-sidebar={isMini ? undefined : collapsed ? "collapsed" : "expanded"}
    >
      <WindowChrome
        {...chrome}
        sidebarToggle={!isMini && (
          <button
            type="button"
            className="workbench-title-button workbench-rail-toggle"
            aria-label={sidebarToggleLabel}
            aria-expanded={!collapsed}
            aria-controls={navigationId}
            title={sidebarToggleLabel}
            onClick={() => {
              setSidebarPreference(!collapsed);
              try {
                localStorage.setItem(sidebarStorageKey, String(!collapsed));
              } catch {}
            }}
          >
            <SidebarIcon size={16} aria-hidden="true" />
          </button>
        )}
      />

      <div className="workbench-body">
        {!isMini && (
          <aside className="workbench-rail" data-collapsed={collapsed || undefined}>
            <nav id={navigationId} className="workbench-nav" aria-label="工作台导航">
              {navigation.map((group, index) => (
                <div key={group[0].id} className={index ? "workbench-nav workbench-nav-group" : "workbench-nav"}>
                  {group.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className="workbench-nav-button"
                      aria-label={label}
                      aria-current={currentTab === id ? "page" : undefined}
                      title={collapsed ? undefined : label}
                      onClick={() => onSelectTab(id)}
                    >
                      <Icon size={16} className="shrink-0" aria-hidden="true" />
                      <span className={collapsed ? "workbench-rail-tooltip" : "truncate"} aria-hidden="true">{label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            {railControls?.(collapsed)}
          </aside>
        )}

        <main className="workbench-main" data-page={isMini ? undefined : currentTab} aria-label={pageLabel}>
          <div className="workbench-main-inner">{children}</div>
        </main>
      </div>
      {!isMini && statusBar}
    </div>
  );
}
