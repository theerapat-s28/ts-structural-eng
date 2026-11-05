// Tolerances shared by the whole FEA model: members, shells and the solver.

/** A member is vertical when the horizontal projection of its unit axis is below this value. */
export const VERTICAL_MEMBER_TOLERANCE = 1e-6;

/** Smallest pivot, relative to its own diagonal term, accepted when factorising a stiffness matrix. */
export const SINGULARITY_TOLERANCE = 1e-9;

/** Relative global-equilibrium residual above which a warning is added. */
export const EQUILIBRIUM_TOLERANCE = 1e-6;

/**
 * Relative tolerance for null-area geometry (planarity, corners in line, parallel or square
 * edges, nodes lying on an edge): distances are compared with this times the longest edge.
 */
export const AREA_GEOMETRY_TOLERANCE = 1e-6;
