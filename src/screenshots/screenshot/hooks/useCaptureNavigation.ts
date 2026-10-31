import { useEffect, useRef } from "react";
import { historyApi } from "../../../api/commands";
import type { CaptureExperience } from "../components/captureExperience";
import type { Selection } from "./useCaptureLifecycle";

export function useCaptureNavigation(options: {
  enabled: boolean;
  generation: number;
  screen: string;
  experience: CaptureExperience;
  scaleX: number;
  scaleY: number;
  enter: (rect: Selection) => void;
  loadImage: (image: HTMLImageElement) => void;
  onError: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const regionHistory = useRef<import("../components/captureExperience").CaptureRegion[] | null>(
    null,
  );
  const regionIndex = useRef(-1),
    imageIndex = useRef(-1);
  useEffect(() => {
    let disposed = false,
      reading = false;
    regionIndex.current = imageIndex.current = -1;
    regionHistory.current = null;
    const keydown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (
        !current.enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,[contenteditable="true"],[role="dialog"],[role="menu"]',
          ))
      )
        return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const regions =
          regionHistory.current ??
          current.experience.regions.filter((item) => item.screen === current.screen);
        regionHistory.current = regions;
        if (!regions.length) {
          current.onError("此屏幕尚无历史区域，请先框选一次。");
          return;
        }
        regionIndex.current =
          regionIndex.current < 0
            ? event.shiftKey
              ? regions.length - 1
              : 0
            : (regionIndex.current + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
        const stored = regions[regionIndex.current];
        const region = stored.physical
          ? {
              ...stored,
              x: stored.x / current.scaleX,
              y: stored.y / current.scaleY,
              width: stored.width / current.scaleX,
              height: stored.height / current.scaleY,
            }
          : stored;
        const width = Math.min(region.width, window.innerWidth - Math.max(0, region.x));
        const height = Math.min(region.height, window.innerHeight - Math.max(0, region.y));
        if (width < 8 || height < 8) {
          current.onError("历史区域已不在当前屏幕内，请重新框选。");
          return;
        }
        current.enter({
          ...region,
          x: Math.max(0, region.x),
          y: Math.max(0, region.y),
          width,
          height,
        });
      } else if (event.key === "<" || event.key === ">") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (reading) return;
        reading = true;
        void (async () => {
          const records = await historyApi.list();
          if (disposed) return;
          if (!records.length) throw new Error("尚无截图历史，请先完成一次截图。");
          imageIndex.current =
            imageIndex.current < 0
              ? event.key === "<"
                ? 0
                : records.length - 1
              : (imageIndex.current + (event.key === "<" ? 1 : -1) + records.length) %
                records.length;
          const data = await historyApi.image(records[imageIndex.current].id);
          if (disposed) return;
          const url = URL.createObjectURL(new Blob([data], { type: "image/png" }));
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            if (
              !disposed &&
              latest.current.enabled &&
              latest.current.generation === options.generation
            )
              latest.current.loadImage(image);
          } finally {
            URL.revokeObjectURL(url);
          }
        })()
          .catch((error) => {
            if (!disposed) current.onError(`历史截图读取失败：${String(error)}`);
          })
          .finally(() => {
            reading = false;
          });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", keydown, true);
    };
  }, [options.generation]);
}
