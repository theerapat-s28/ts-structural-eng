import { Warnings } from "@app-types/output-message.type";

export const mergeWarnings = (existingWarnings: Warnings, newWarnings: Warnings): Warnings => {
  return [...existingWarnings, ...newWarnings];
}