import { Warnings } from "@app-types/output-message.type";

/**
 * Merges two warning arrays into a single combined array.
 *
 * @param existingWarnings - Warnings already accumulated
 * @param newWarnings - Additional warnings to append
 * @returns Combined warning array
 */
export const mergeWarnings = (existingWarnings: Warnings, newWarnings: Warnings): Warnings => {
  return [...existingWarnings, ...newWarnings];
};
