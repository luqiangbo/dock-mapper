/** These failures require a fresh module runtime, not another render of cached imports. */
export function isModuleResourceError(error: string) {
  return /factory is undefined|ChunkLoadError|Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    error,
  );
}
