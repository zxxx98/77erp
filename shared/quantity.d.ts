export const QUANTITY_SCALE: number;
export const MAX_QUANTITY: number;
export function validQuantity(value: unknown, positive?: boolean, decimals?: number): boolean;
export function quantityUnits(value: number): number;
export function addQuantity(left: number, right: number): number;
export function parseQuantity(value: string | number, positive?: boolean): number;
export function materialQuantity(value: number, product?: { unit_round_up?: number | boolean }): number;
export function validStoredQuantity(value: unknown, positive?: boolean): boolean;
