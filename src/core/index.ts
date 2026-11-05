// Types
export type {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  RectShearSection,
  StirrupShearSection,
  ShearReinforcementCheckInput,
  RebarGroupInput,
  RectBeamBarLayoutInput,
} from "./types/rc-beam.type";
export { isSinglyReinforced } from "./types/rc-beam.type";
export type {
  SteelJacketedProps,
  SectionState,
  PlateShearFlowInput,
  BoltProps,
  PlateInterfaceBoltInput,
  SidePlateConfiguration,
  SidePlateAnchorage,
  SidePlateShearProps,
} from "./types/plate-jacketing.type";
export { hasTopPlate, hasBottomPlate, hasSidePlate } from "./types/plate-jacketing.type";
export type { SectionProperties } from "./types/section-properties.type";
export type { Warnings, calculationResult } from "./types/output-message.type";
export type { unit } from "./types/unit.type";

// Constants
export {
  FLEXURAL_STRENGTH_REDUCTION_FACTOR,
  CONCRETE_ULTIMATE_STRAIN,
  SHEAR_STRENGTH_REDUCTION_FACTOR,
  ANCHOR_SHEAR_STRENGTH_REDUCTION_FACTOR,
  MAX_PLATE_BOLT_SPACING,
  PLATE_SHEAR_YIELD_COEFFICIENT,
  SIDE_PLATE_EFFECTIVE_STRAIN_LIMIT,
  SIDE_PLATE_REDUCTION_FACTOR_PSI,
  CONCRETE_POISSON_RATIO,
  CONCRETE_UNIT_WEIGHT,
  BEAM_INERTIA_MODIFIER,
  COLUMN_INERTIA_MODIFIER,
} from "./constants/rc.constant";

export {
  VERTICAL_MEMBER_TOLERANCE,
  SINGULARITY_TOLERANCE,
  EQUILIBRIUM_TOLERANCE,
  AREA_GEOMETRY_TOLERANCE,
} from "./constants/fea.constant";
export { NODE_NEAR_MEMBER_RATIO, NODE_NEAR_MEMBER_MAX_DISTANCE } from "./constants/frame.constant";
export {
  SHELL_WARPING_LIMIT,
  STRIP_PLANE_TOLERANCE,
  STRIP_DEFAULT_DIVISIONS,
} from "./constants/shell.constant";

// Errors
export { RCDesignError, Errors } from "./errors/rc-design.error";
export { FeaError, FeaErrors } from "./errors/fea.error";
export type { FeaErrorDetails, FeaModelIssue } from "./errors/fea.error";
// Deprecated names, removed in 4.0.0
export { FrameAnalysisError, FrameErrors } from "./errors/fea.error";
export type { FrameErrorDetails, FrameModelIssue } from "./errors/fea.error";
