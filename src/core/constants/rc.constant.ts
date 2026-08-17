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

// Default elastic modulus of structural steel plate, used when the plate props omit Es
export const DEFAULT_PLATE_ELASTIC_MODULUS = 200000; // MPa

// AISC 360 G2.1 / von Mises: shear yield stress of a steel web = 0.6 * Fy
export const PLATE_SHEAR_YIELD_COEFFICIENT = 0.6;

// AISC 360 G2.1(a): a web of slenderness h/tw <= 2.24*sqrt(E/Fy) reaches shear
// yielding before shear buckling
export const PLATE_SHEAR_SLENDERNESS_COEFFICIENT = 2.24; // * sqrt(Es / fy)

// ACI 440.2R-17, 11.4: effective strain in bonded shear reinforcement is capped
// to preserve aggregate interlock in the concrete. Subsection unverified — see the
// TODO in strengthening/rc-beam-side-plate-shear.ts.
export const SIDE_PLATE_EFFECTIVE_STRAIN_LIMIT = 0.004;

// ACI 440.2R-17, 11.4: additional reduction factor psi_f for two-sided bonded
// shear strengthening (not fully wrapped). Subsection unverified — see the TODO in
// strengthening/rc-beam-side-plate-shear.ts.
export const SIDE_PLATE_REDUCTION_FACTOR_PSI = 0.85;

// Both faces of the web plated, unless the caller says otherwise
export const DEFAULT_SIDE_PLATE_SIDES = 2;

// Vertical strips, unless the caller gives an inclination
export const DEFAULT_SIDE_PLATE_ANGLE = 90; // degrees from the beam axis

// Practical detailing limit on bolt pitch along a bonded strengthening plate,
// so the plate is restrained against local buckling / peeling between fasteners
export const MAX_PLATE_BOLT_SPACING = 300; // mm
