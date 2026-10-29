import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges class names: clsx for conditional classes, tailwind-merge so a later Tailwind class wins
 * over a conflicting earlier one.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
