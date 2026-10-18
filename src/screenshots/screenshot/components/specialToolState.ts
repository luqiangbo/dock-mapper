interface Element {
  id?: string;
  isDeleted?: boolean;
  locked?: boolean;
  groupIds?: readonly string[];
  customData?: Record<string, unknown>;
}
export function nextNumber(elements: readonly Element[]) {
  return (
    1 +
    Math.max(
      0,
      ...elements
        .filter((element) => !element.isDeleted)
        .map((element) => Number(element.customData?.dockmapperNumber) || 0),
    )
  );
}
export function numberGroupsToErase(elements: readonly Element[]): Set<string> {
  const groups = new Set(
    elements
      .filter((element) => element.isDeleted && element.customData?.dockmapperTool === "number")
      .flatMap((element) => element.groupIds ?? []),
  );
  return new Set(
    elements
      .filter(
        (element) =>
          element.id &&
          !element.locked &&
          !element.isDeleted &&
          element.customData?.dockmapperTool === "number" &&
          element.groupIds?.some((id) => groups.has(id)),
      )
      .map((element) => element.id!),
  );
}
