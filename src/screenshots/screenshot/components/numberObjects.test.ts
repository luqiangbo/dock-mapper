import { describe, expect, it } from "vitest";
import {
  appendNumberObject,
  clampNumberCenter,
  isNumberObjectInteractive,
  nextAvailableNumber,
  translateNumberObjects,
  type NumberObject,
} from "./numberObjects";

const numberObject = (value: number, canvasX = 10, canvasY = 20): NumberObject => ({
  id: `number-${value}`,
  value,
  canvasX,
  canvasY,
  style: { backgroundColor: "#ef4444", textColor: "#ffffff", size: 32 },
});

describe("screenshot number objects", () => {
  it("uses the smallest available positive number", () => {
    expect(nextAvailableNumber([])).toBe(1);
    expect(nextAvailableNumber([numberObject(1), numberObject(3)])).toBe(2);
    expect(nextAvailableNumber([numberObject(2), numberObject(3)])).toBe(1);
  });

  it("allocates unique values across consecutive functional updates", () => {
    const add = (objects: NumberObject[]): NumberObject[] =>
      appendNumberObject(objects, { ...numberObject(0), id: `number-${objects.length + 1}` });
    const objects = add(add([]));
    expect(objects.map((item) => item.value)).toEqual([1, 2]);
  });

  it("only receives input while the number tool is active", () => {
    expect(isNumberObjectInteractive("number")).toBe(true);
    expect(isNumberObjectInteractive("rect")).toBe(false);
    expect(isNumberObjectInteractive(null)).toBe(false);
  });

  it("keeps the complete marker inside every canvas edge", () => {
    expect(clampNumberCenter(-5, 120, 16, 100, 80)).toEqual({ canvasX: 16, canvasY: 64 });
    expect(clampNumberCenter(95, 2, 16, 100, 80)).toEqual({ canvasX: 84, canvasY: 16 });
  });

  it("translates markers with a recropped selection", () => {
    const translated = translateNumberObjects([numberObject(1)], -4, 7);
    expect(translated[0]).toMatchObject({ canvasX: 6, canvasY: 27 });
  });
});
