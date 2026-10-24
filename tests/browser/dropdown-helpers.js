export async function chooseOption(control, value) {
  await control.click();
  const listId = await control.getAttribute('aria-controls');
  await control.page().locator(`[id="${listId}"]`).locator(`[role="option"][data-value="${value}"]`).click();
}

// Desktop Select and mobile sheet pickers both display a label beside the control.
export function selectedControl(control) {
  return control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ") or contains(concat(" ", normalize-space(@class), " "), " erp-mobile-select ")][1]');
}
