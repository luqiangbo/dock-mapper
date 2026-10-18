/** A read may update a retained page only in the activation that started it. */
export function createPageReadGuard() {
  let revision = 0;
  let active = true;
  return {
    begin: () => ++revision,
    invalidate: () => {
      revision += 1;
    },
    setActive: (next: boolean) => {
      if (active !== next) {
        active = next;
        revision += 1;
      }
    },
    isCurrent: (request: number) => active && request === revision,
  };
}
