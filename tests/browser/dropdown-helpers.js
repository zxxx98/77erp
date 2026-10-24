export async function chooseOption(control, value) {
  await control.click();
  const listId = await control.getAttribute('aria-controls');
  await control.page().locator(`[id="${listId}"]`).locator(`[role="option"][data-value="${value}"]`).click();
}

// Ant Select displays its value beside the search input rather than in its value.
export function selectedControl(control) {
  return control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]');
}
