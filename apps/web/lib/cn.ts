import { clsx, type ClassValue } from "clsx";

/** Tiny class-name joiner used across components. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
