// Shell elements and strip forces.

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

/**
 * A shell element counts as lying in a strip's plane when each of its corners is within this
 * fraction of the element's longest side from that plane (1 mm on a 1 m element). The strip
 * then integrates its forces; elements off the plane, such as walls, are ignored.
 */
export const STRIP_PLANE_TOLERANCE = 1e-3;

/** Divisions of each strip segment when the strip gives no `maxSpacing`: 21 stations. */
export const STRIP_DEFAULT_DIVISIONS = 20;
