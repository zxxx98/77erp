import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function browserPosition(request, permissions = [], base = '') {
  const response = await request.post(`${base}/api/positions`, { data: { name: `Browser ${randomUUID()}`, description: '', permissions } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}
