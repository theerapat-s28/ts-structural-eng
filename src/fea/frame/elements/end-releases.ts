import type { Member } from "../types/model.type";

/** Release keys in local DOF order at one member end. */
export const RELEASE_KEYS = ["u1", "u2", "u3", "r1", "r2", "r3"] as const;

/**
 * Spring stiffness unit conversion per DOF of one node or member end:
 * kN/mm → N/mm for translations, kN·m/rad → N·mm/rad for rotations.
 */
export const SPRING_UNIT_FACTOR = [1e3, 1e3, 1e3, 1e6, 1e6, 1e6] as const;

/** One released local end DOF of a member and the spring that ties it to its node. */
export interface EndReleaseDof {
  index: number; // local DOF, 0–5 at the start, 6–11 at the end
  spring: number; // N/mm or N·mm/rad; 0 is a full release
}

/**
 * The released local end DOFs of a member, in local DOF order. `true` and `0` are full releases,
 * a positive number is a partial-fixity spring; `false` and omitted DOFs stay rigidly connected.
 * Expects values that passed `validateFrameModel`.
 */
export const memberEndReleases = (releases: Member["releases"]): EndReleaseDof[] =>
  ([releases?.start, releases?.end] as const).flatMap((release, end) =>
    RELEASE_KEYS.flatMap((key, k): EndReleaseDof[] => {
      const value = release?.[key];
      if (value === undefined || value === false) return [];
      const spring = value === true ? 0 : value * SPRING_UNIT_FACTOR[k];
      return [{ index: 6 * end + k, spring }];
    }),
  );
