export function focusScrollDelta(targetTop: number, viewportTop: number, inset: number) {
  return Math.min(0, targetTop - viewportTop - inset);
}
/** Popups can cover the title bar; their focus must not move the underlying page. */
export function revealWorkspaceFocus(content: HTMLElement, target: HTMLElement) {
  if (
    !content.contains(target) ||
    target.closest(
      '[role="dialog"], [role="listbox"], .ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-cascader-dropdown, .ant-tree-select-dropdown, .ant-color-picker, .ant-popover, .ant-tooltip',
    )
  )
    return;
  const inset = Number.parseFloat(getComputedStyle(content).scrollPaddingTop) || 72;
  const delta = focusScrollDelta(
    target.getBoundingClientRect().top,
    content.getBoundingClientRect().top,
    inset,
  );
  if (delta < 0) content.scrollBy({ top: delta, behavior: "instant" });
}
