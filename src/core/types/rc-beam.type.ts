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

export function isSinglyReinforced(
  section: RectBeamSection,
): section is RectSinglyBeamSection {
  return (
    !("As_" in section) ||
    !("d_" in section) ||
    section.As_ <= 0 ||
    section.d_ <= 0
  );
}