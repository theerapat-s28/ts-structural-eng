export const FLEXURAL_STRENGTH_REDUCTION_FACTOR = 0.9;
export const CONCRETE_ULTIMATE_STRAIN = 0.003;

// ACI 318-19 Table 20.6.1.3.1: cast-in-place beams, not exposed to weather or in contact with ground
export const DEFAULT_BEAM_COVER = 40; // mm, clear cover to stirrup
export const DEFAULT_STIRRUP_DIAMETER = 10; // mm
export const DEFAULT_MAX_AGGREGATE_SIZE = 20; // mm, nominal max aggregate size

// ACI 318-19 25.2.1: min clear spacing between parallel bars in a layer
export const MIN_BAR_CLEAR_SPACING = 25; // mm
export const AGGREGATE_SPACING_FACTOR = 4 / 3;

// ACI 318-19 25.2.2: min clear distance between layers
export const MIN_LAYER_CLEAR_SPACING = 25; // mm

// ACI 318-19 21.2.1: strength reduction factor for shear
export const SHEAR_STRENGTH_REDUCTION_FACTOR = 0.75;

// ACI 318-19 22.5.5.1, Table 22.5.5.1(a): Vc = 0.17 * lambda * sqrt(fc') * bw * d
export const CONCRETE_SHEAR_VC_COEFFICIENT = 0.17;

// ACI 318-19 22.5.3.1: sqrt(fc') used to compute Vc shall not exceed this limit
// unless minimum shear reinforcement per 9.6.3.3 is provided
export const SQRT_FC_SHEAR_LIMIT = 8.3; // MPa

// ACI 318-19 22.5.1.2: Vs shall not exceed 0.66 * sqrt(fc') * bw * d
export const MAX_VS_COEFFICIENT = 0.66;

// ACI 318-19 9.7.6.2.2: spacing threshold at which the tighter max-spacing limit applies
export const VS_SPACING_THRESHOLD_COEFFICIENT = 0.33; // * sqrt(fc') * bw * d

// ACI 318-19 9.7.6.2.2: max stirrup spacing, Vs <= 0.33 * sqrt(fc') * bw * d
export const MAX_STIRRUP_SPACING_LOW_VS = 600; // mm
export const MAX_STIRRUP_SPACING_LOW_VS_DEPTH_FACTOR = 0.5; // * d

// ACI 318-19 9.7.6.2.2: max stirrup spacing, Vs > 0.33 * sqrt(fc') * bw * d
export const MAX_STIRRUP_SPACING_HIGH_VS = 300; // mm
export const MAX_STIRRUP_SPACING_HIGH_VS_DEPTH_FACTOR = 0.25; // * d

// ACI 318-19 9.6.3.3: Av,min = max(0.062 * sqrt(fc') * bw * s / fyt, 0.35 * bw * s / fyt)
export const MIN_AV_SQRT_FC_COEFFICIENT = 0.062;
export const MIN_AV_ABSOLUTE_COEFFICIENT = 0.35;

// ACI 318-19 Table 17.5.3: strength reduction factor for anchor steel in shear
export const ANCHOR_SHEAR_STRENGTH_REDUCTION_FACTOR = 0.65;

// ACI 318-19 17.7.1.2b: Vsa = 0.6 * Ase,V * futa
export const ANCHOR_STEEL_SHEAR_COEFFICIENT = 0.6;

// ACI 318-19 17.6.1.2: futa shall not exceed min(1.9 * fya, 860 MPa)
export const ANCHOR_FUTA_FYA_FACTOR = 1.9;
export const MAX_ANCHOR_FUTA = 860; // MPa

// ACI 318-19 17.9.2: min center-to-center spacing of cast-in anchors = 4 * da
export const MIN_ANCHOR_SPACING_DIAMETER_FACTOR = 4;

// Practical detailing limit on bolt pitch along a bonded strengthening plate,
// so the plate is restrained against local buckling / peeling between fasteners
export const MAX_PLATE_BOLT_SPACING = 300; // mm
