import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mac keyboards send Backspace for the key labelled "delete"; treat both as Delete. */
export function isDeleteKey(key: string) {
  return key === 'Delete' || key === 'Backspace';
}
