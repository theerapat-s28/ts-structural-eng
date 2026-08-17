import { RectBeamSection } from "./rc-beam.type";

export interface SteelJacketedProps {
  Es: number;
  fy: number;
  topSteelWidth?: number;
  topSteelThickness?: number;
  bottomSteelWidth?: number;
  bottomSteelThickness?: number;
}

/**
 * A plate counts as present only when both its width and thickness are positive,
 * so a bottom-only jacket may omit the top plate fields or pass them as zero.
 */
export function hasTopPlate(props: SteelJacketedProps): boolean {
  return (props.topSteelWidth ?? 0) > 0 && (props.topSteelThickness ?? 0) > 0;
}

export function hasBottomPlate(props: SteelJacketedProps): boolean {
  return (props.bottomSteelWidth ?? 0) > 0 && (props.bottomSteelThickness ?? 0) > 0;
}

export type SectionState = "cracked" | "uncracked";

export interface PlateShearFlowInput {
  section: RectBeamSection;
  plates: SteelJacketedProps;
  V: number; // kN, factored shear force at the section
  sectionState?: SectionState; // default: "cracked"
}

export interface BoltProps {
  Ase: number; // mm^2, effective cross-sectional area of the anchor in shear
  futa: number; // MPa, specified tensile strength of the anchor steel
  fya?: number; // MPa, specified yield strength (used for the ACI 17.6.1.2 futa cap)
  diameter?: number; // mm, anchor diameter (enables the ACI 17.9.2 min spacing check)
  shearPlanes?: number; // number of shear planes per bolt (default: 1)
  phiVboltOverride?: number; // kN, bypasses the computed steel strength
}

export interface PlateInterfaceBoltInput extends PlateShearFlowInput {
  bolt: BoltProps;
  boltsPerRow: number; // bolts across the plate width at each pitch location
  transferLength: number; // mm, length over which the plate force is transferred
}

/**
 * How the side plates are laid out along the span.
 *
 * `"continuous"` is an unbroken plate over the strengthened length; `"strips"`
 * are discrete plates of width `width` repeating at pitch `spacing`, acting like
 * external stirrups.
 */
export type SidePlateConfiguration = "continuous" | "strips";

/**
 * Bolt group anchoring the side plates to the web.
 *
 * `rowSpacing` is the horizontal pitch of the vertical bolt rows along the span;
 * for a stripped layout it is normally the strip spacing itself. `boltsPerRow`
 * counts the bolts in one vertical row, on one face of the beam.
 */
export interface SidePlateAnchorage {
  bolt: BoltProps;
  boltsPerRow: number; // bolts in one vertical row, one face
  rowSpacing: number; // mm, horizontal pitch of the bolt rows along the span
}

export interface SidePlateShearProps {
  fy: number; // MPa, plate yield strength
  Es?: number; // MPa, plate elastic modulus (default: 200000)
  thickness: number; // tp, mm
  depth: number; // dp, mm, vertical depth of plate engaged in shear
  configuration: SidePlateConfiguration;
  width?: number; // wp, mm, strip width (required for "strips")
  spacing?: number; // s, mm, strip pitch along the span, centreline to centreline (required for "strips")
  angle?: number; // degrees from the beam axis, strips only (default: 90)
  sides?: 1 | 2; // faces plated (default: 2)
  anchorage?: SidePlateAnchorage; // omit to report the unanchored plate capacity
}

/**
 * A side plate counts as present only when both its thickness and engaged depth
 * are positive.
 */
export function hasSidePlate(props: SidePlateShearProps): boolean {
  return props.thickness > 0 && props.depth > 0;
}
