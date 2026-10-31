/** Bound a stalled module request so Suspense cannot leave the window loading forever. */
export function loadView<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("界面模块加载超时，请重新加载界面")), 15000);
    void Promise.resolve()
      .then(load)
      .then(
        (view) => {
          clearTimeout(timer);
          resolve(view);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}
