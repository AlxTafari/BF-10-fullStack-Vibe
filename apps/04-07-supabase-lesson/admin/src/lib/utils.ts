import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склейка классов Tailwind: поздние перебивают ранние (нужна shadcn-компонентам). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
