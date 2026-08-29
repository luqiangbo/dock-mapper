import { useCallback, type MutableRefObject } from "react";
import { runImageAction } from "../utils/imageActions";

interface CommittedImageActionOptions {
  pendingAction: MutableRefObject<number>;
  exportPng: () => Promise<Uint8Array>;
  beginCommit: () => void;
  restoreEditing: () => void;
  setBusy: (value: boolean) => void;
  fail: (message: string, phase: "selecting" | "editing") => void;
}

export function useCommittedImageAction({
  pendingAction,
  exportPng,
  beginCommit,
  restoreEditing,
  setBusy,
  fail,
}: CommittedImageActionOptions) {
  const persistHistory = useCallback(async (resultPng: Uint8Array): Promise<void> => {
    let resultImageId: string | null = null;
    try {
      resultImageId = await window.api.uploadImage(resultPng);
      await window.api.createScreenshotHistory(resultImageId);
      resultImageId = null;
    } catch (historyError) {
      if (resultImageId) await window.api.releaseImage(resultImageId).catch(() => undefined);
      console.error("保存截图历史失败", historyError);
    }
  }, []);

  return useCallback(
    (consumeImage: (imageId: string) => Promise<unknown>, fallbackError: string) => {
      const action = ++pendingAction.current;
      return runImageAction({
        exportPng: async () => {
          const png = await exportPng();
          if (action !== pendingAction.current) throw new Error("截图操作已取消");
          return png;
        },
        uploadImage: window.api.uploadImage,
        consumeImage: async (imageId) => {
          if (action !== pendingAction.current) {
            await window.api.releaseImage(imageId);
            return false;
          }
          beginCommit();
          const result = await consumeImage(imageId);
          if (result === false && action === pendingAction.current) restoreEditing();
          return result;
        },
        releaseImage: window.api.releaseImage,
        onCommitted: persistHistory,
        setBusy: (value) => {
          if (action === pendingAction.current) setBusy(value);
        },
        onError: (message) => {
          if (action === pendingAction.current) fail(message, "editing");
        },
        fallbackError,
      });
    },
    [beginCommit, exportPng, fail, pendingAction, persistHistory, restoreEditing, setBusy],
  );
}
