import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { App as AntApp, ConfigProvider } from "antd";
import { createPageReadGuard } from "../hooks/pageReadGuard";

const PageActivity = createContext(true);
export function usePageActive() {
  return useContext(PageActivity);
}

export function PageScope({ active, children }: { active: boolean; children: ReactNode }) {
  const parentActive = usePageActive();
  const host = useRef<HTMLDivElement>(null);
  return (
    <PageActivity.Provider value={parentActive && active}>
      <div ref={host} style={{ position: "relative", minWidth: 0 }}>
        <ConfigProvider getPopupContainer={() => host.current ?? document.body}>
          {children}
        </ConfigProvider>
      </div>
    </PageActivity.Provider>
  );
}

export function usePageReadGuard() {
  const active = usePageActive();
  const guard = useRef(createPageReadGuard()).current;
  useLayoutEffect(() => {
    guard.setActive(active);
    return () => guard.setActive(false);
  }, [active, guard]);
  return guard;
}

/** Refresh on entry, never overwrite an unsaved draft or restart after every render. */
export function usePageRefresh(load: () => void | Promise<void>, blocked = false) {
  const active = usePageActive();
  const latest = useRef({ load, blocked });
  latest.current = { load, blocked };
  useEffect(() => {
    if (active && !latest.current.blocked) void latest.current.load();
  }, [active]);
}

/** Confirmations belong to their page; notifications and started work remain global. */
export function usePageModal() {
  const { modal } = AntApp.useApp();
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const dialogs = useRef<Array<{ destroy: () => void }>>([]);
  useLayoutEffect(
    () => () => {
      dialogs.current.forEach((dialog) => dialog.destroy());
      dialogs.current = [];
    },
    [active],
  );
  return {
    confirm: (options: Parameters<typeof modal.confirm>[0]) => {
      if (!activeRef.current) return;
      const dialog = modal.confirm(options);
      dialogs.current.push(dialog);
      return dialog;
    },
  };
}
