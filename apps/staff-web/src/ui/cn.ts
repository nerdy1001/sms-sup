import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets the last Tailwind class win when two conflict (for example p-2 and p-4). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
