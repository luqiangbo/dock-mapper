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
