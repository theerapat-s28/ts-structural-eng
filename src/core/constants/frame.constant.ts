/** Poisson's ratio of concrete, for G = E / (2(1 + ν)). */
export const CONCRETE_POISSON_RATIO = 0.2;

/** ACI 318-19 Table 6.6.3.1.1(a): effective I of beams for elastic analysis at factored load. */
export const BEAM_INERTIA_MODIFIER = 0.35;

/** ACI 318-19 Table 6.6.3.1.1(a): effective I of columns for elastic analysis at factored load. */
export const COLUMN_INERTIA_MODIFIER = 0.7;

/** Unit weight of reinforced concrete in kN/m³ — common design practice, not an ACI 318-19 value. */
export const CONCRETE_UNIT_WEIGHT = 24;

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
 * Penalty factor γ of the shell membrane's drilling rotation, as a multiple of the shear modulus
 * G: the term ½·γ·t·∫(θ − ω)² dA, integrated at the element centre, ties each element's rotation
 * about the shell normal θ to the in-plane rotation of the material ω = ½(v,x − u,y). γ = G
 * follows Ibrahimbegovic, Taylor & Wilson (1990); with the one-point rule the results change by
 * well under 1 % for γ between 0.01 G and 100 G.
 */
export const DRILLING_PENALTY_RATIO = 1;

/**
 * Largest warping of a shell element accepted, as the distance of its corners from their mean
 * plane relative to √A (A = projected area). Warped elements are built flat on the mean plane
 * and linked rigidly to their corners, which is accurate for mild warping (the MacNeal–Harder
 * twisted beam, 0.024, is within 0.5 %); beyond this the element is rejected (326).
 */
export const SHELL_WARPING_LIMIT = 0.1;
