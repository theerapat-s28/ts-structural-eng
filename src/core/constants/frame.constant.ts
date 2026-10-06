/** Poisson's ratio of concrete, for G = E / (2(1 + ν)). */
export const CONCRETE_POISSON_RATIO = 0.2;

/** ACI 318-19 Table 6.6.3.1.1(a): effective I of beams for elastic analysis at factored load. */
export const BEAM_INERTIA_MODIFIER = 0.35;

/** ACI 318-19 Table 6.6.3.1.1(a): effective I of columns for elastic analysis at factored load. */
export const COLUMN_INERTIA_MODIFIER = 0.7;

/** A member is vertical when the horizontal projection of its unit axis is below this value. */
export const VERTICAL_MEMBER_TOLERANCE = 1e-6;

/** Smallest pivot, relative to its own diagonal term, accepted when factorising a stiffness matrix. */
export const SINGULARITY_TOLERANCE = 1e-9;

/** Relative global-equilibrium residual above which a warning is added. */
export const EQUILIBRIUM_TOLERANCE = 1e-6;
