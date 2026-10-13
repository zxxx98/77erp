export async function chooseOption(control, value) {
  await control.click();
  await control.page().locator(".dropdown-menu").locator(`[data-value="${value}"]`).click();
}
