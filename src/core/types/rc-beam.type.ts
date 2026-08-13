export type RectBeamSection = RectSinglyBeamSection | RectDoublyBeamSection;

export interface RectSinglyBeamSection {
  Es: number;
  fc_: number;
  fy: number;
  As: number;
  b: number;
  h: number;
  d: number;
}

export interface RectDoublyBeamSection extends RectSinglyBeamSection {
  As_: number; // As_ is required for doubly reinforced sections
  d_: number; // d_ is required for doubly reinforced sections
}

export interface RectShearSection {
  fc_: number; // MPa, concrete compressive strength
  bw: number; // mm, web width
  d: number; // mm, effective depth (tension steel centroid to extreme compression fiber)
  lambda?: number; // concrete density modification factor (default: 1.0, normal weight)
}

export interface StirrupShearSection extends RectShearSection {
  Av: number; // mm^2, area of shear reinforcement within spacing s (both legs)
  fyt: number; // MPa, yield strength of stirrups
  s: number; // mm, stirrup spacing
}

export interface ShearReinforcementCheckInput extends RectShearSection {
  Vu: number; // kN, factored shear force at the section
  fyt: number; // MPa, yield strength of stirrups
  Av?: number; // mm^2, provided area of shear reinforcement within spacing s (both legs)
  s?: number; // mm, provided stirrup spacing
}

export interface RebarGroupInput {
  count: number;
  diameter: number; // mm
}

export interface RectBeamBarLayoutInput {
  b: number; // mm, section width
  h: number; // mm, section height
  topBars: RebarGroupInput;
  bottomBars: RebarGroupInput;
  cover?: number; // mm, clear cover to stirrup (default: ACI 318-19 Table 20.6.1.3.1)
  stirrupDiameter?: number; // mm
  maxAggregateSize?: number; // mm, nominal max aggregate size
}

export function isSinglyReinforced(section: RectBeamSection): section is RectSinglyBeamSection {
  return !("As_" in section) || !("d_" in section) || section.As_ <= 0 || section.d_ <= 0;
}
