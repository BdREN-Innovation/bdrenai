/** Sort order fields: a whole number, blank meaning 0. */
export const ORDER_ERROR = 'Enter a whole number.';

export const isOrder = (value: string) => /^-?\d+$/.test(value.trim() || '0');

export const parseOrder = (value: string) => Number(value.trim() || '0');
