import type { KeyMapping, KeyMappingStatus, SupportedKey } from "../types";

export interface MappingData {
  rules: KeyMapping[];
  keys: SupportedKey[];
  status: KeyMappingStatus;
}
export type MappingLoadState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; data: MappingData };
export function createMappingLoader(
  api: {
    mappings: () => Promise<KeyMapping[]>;
    supportedKeys: () => Promise<SupportedKey[]>;
    status: () => Promise<KeyMappingStatus>;
  },
  publish: (state: MappingLoadState) => void,
) {
  let revision = 0;
  return {
    async load() {
      const current = ++revision;
      publish({ phase: "loading" });
      try {
        const [rules, keys, status] = await Promise.all([
          api.mappings(),
          api.supportedKeys(),
          api.status(),
        ]);
        if (current === revision) publish({ phase: "ready", data: { rules, keys, status } });
      } catch (error) {
        if (current === revision) publish({ phase: "error", error: String(error) });
      }
    },
    cancel() {
      revision += 1;
    },
  };
}

export async function saveRuntimeMappings(
  api: {
    sync: (rules: KeyMapping[]) => Promise<void>;
    status: () => Promise<KeyMappingStatus>;
  },
  rules: KeyMapping[],
  onSaved: () => void,
) {
  await api.sync(rules);
  onSaved();
  try {
    return { status: await api.status(), refreshError: null };
  } catch (error) {
    return { status: null, refreshError: String(error) };
  }
}

/** One active request; concurrent callers share one trailing, up-to-date read. */
export function createStatusReader<T>(read: (force: boolean) => Promise<T>) {
  let active: Promise<T> | null = null;
  let trailing: Promise<T> | null = null;
  let forceNext = false;
  const start = (force: boolean): Promise<T> => {
    const result = read(force);
    active = result;
    const clear = () => {
      if (active === result) active = null;
    };
    void result.then(clear, clear);
    return result;
  };
  return (force = false): Promise<T> => {
    if (trailing) {
      forceNext ||= force;
      return trailing;
    }
    if (!active) return start(force);
    forceNext ||= force;
    if (!trailing) {
      const previous = active;
      // The original caller receives its own error; the trailing read still runs.
      const next = () => {
        const requestedForce = forceNext;
        forceNext = false;
        trailing = null;
        return start(requestedForce);
      };
      trailing = previous.then(next, next);
    }
    return trailing;
  };
}
