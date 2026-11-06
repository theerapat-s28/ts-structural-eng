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

/**
 * A shell area counts as vertical (a wall, for piers and spandrels) when the vertical
 * component of its unit normal is at most this value (about 0.06°).
 */
export const WALL_VERTICAL_TOLERANCE = 1e-3;

/**
 * Relative tolerance for pier and spandrel cuts: a node lies on a cut when its distance from
 * the cut plane is at most this times the extent of the pier or spandrel along the cut normal.
 */
export const WALL_CUT_TOLERANCE = 1e-6;
