/**
 * Prismatic member properties for frame analysis, using ETABS-style local axes:
 * local 1 runs along the member, local 2 and 3 are the transverse axes.
 */
export interface SectionProperties {
  E: number; // MPa, Young's modulus
  G: number; // MPa, shear modulus
  A: number; // mm², cross-section area
  I22: number; // mm⁴, second moment about local 2 (bending in the 1–3 plane, U3–R2)
  I33: number; // mm⁴, second moment about local 3 (bending in the 1–2 plane, U2–R3; major axis)
  J: number; // mm⁴, Saint-Venant torsion constant (about local 1)
}
