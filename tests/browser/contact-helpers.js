import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Seed business data before loading the page; UI flows must select an existing contact.
export async function ensureContact(request, name, { base = '', role = 'supplier' } = {}) {
  const response = await request.get(`${base}/api/contacts`);
  expect(response.ok()).toBe(true);
  const existing = (await response.json()).find(contact => contact.name === name && contact.role === role);
  if (existing) return existing;
  const created = await request.post(`${base}/api/contacts`, {
    data: { request_id: randomUUID(), name, role, active: 1, person: '', phone: '', address: '', note: '' },
  });
  expect(created.ok()).toBe(true);
  return created.json();
}

export async function chooseContact(page, name, label = '供应商') {
  const control = page.getByRole('combobox', { name: label, exact: true });
  await control.click();
  await page.getByRole('listbox', { name: label, exact: true }).getByText(name, { exact: true }).click();
  await expect(control).toHaveValue(name);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
}
