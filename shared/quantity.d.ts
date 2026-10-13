export const QUANTITY_SCALE: number;
export const MAX_QUANTITY: number;
export function validQuantity(value: unknown, positive?: boolean): boolean;
export function quantityUnits(value: number): number;
export function addQuantity(left: number, right: number): number;
export function parseQuantity(value: string | number, positive?: boolean): number;
