// RC Beam Design
export {
  rectBeamMomentCapacity,
  rectBeamBarLayout,
  concreteShearCapacity,
  stirrupShearCapacity,
  checkStirrupRequirement,
  concreteBeta,
  concreteElasticModulus,
  psiToMpa,
  rectBeamToSectionProperties,
} from "./rc";
export type { SectionPropertiesOptions } from "./rc";

// FEA — frame analysis
export {
  analyzeFrame,
  beam3dLocalStiffness,
  beam3dLocalStiffnessRightHanded,
  memberAxes,
  memberDemandEnvelope,
} from "./fea";
export type {
  AnalyzeFrameOptions,
  FrameId,
  FrameNode,
  DofRestraint,
  Restraint,
  MemberEndRelease,
  Member,
  NodalLoad,
  LoadDirection,
  UniformMemberLoad,
  PointMemberLoad,
  MemberLoad,
  FrameModel,
  NodalDisplacement,
  NodalReaction,
  MemberEndForce,
  MemberEndForces,
  MemberStation,
  StationComponent,
  ExtremeValue,
  MemberDiagram,
  FrameResult,
  MemberDemandEnvelope,
  DemandEnvelopeOptions,
} from "./fea";

// Strengthening
export {
  calculateSteelJacketedBeamMomentCapacity,
  plateInterfaceShearFlow,
  boltShearCapacity,
  plateInterfaceBoltRequirement,
  sidePlateShearCapacityByWebYielding,
  sidePlateShearCapacityByTensionTie,
  compareSidePlateShearCapacity,
} from "./strengthening";

// Core (types, constants, errors)
export type {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  RectShearSection,
  StirrupShearSection,
  ShearReinforcementCheckInput,
  RebarGroupInput,
  RectBeamBarLayoutInput,
  SteelJacketedProps,
  SectionState,
  PlateShearFlowInput,
  BoltProps,
  PlateInterfaceBoltInput,
  SidePlateConfiguration,
  SidePlateAnchorage,
  SidePlateShearProps,
  SectionProperties,
  Warnings,
  calculationResult,
  unit,
} from "./core";

export {
  isSinglyReinforced,
  hasTopPlate,
  hasBottomPlate,
  hasSidePlate,
  FLEXURAL_STRENGTH_REDUCTION_FACTOR,
  CONCRETE_ULTIMATE_STRAIN,
  SHEAR_STRENGTH_REDUCTION_FACTOR,
  ANCHOR_SHEAR_STRENGTH_REDUCTION_FACTOR,
  MAX_PLATE_BOLT_SPACING,
  PLATE_SHEAR_YIELD_COEFFICIENT,
  SIDE_PLATE_EFFECTIVE_STRAIN_LIMIT,
  SIDE_PLATE_REDUCTION_FACTOR_PSI,
  CONCRETE_POISSON_RATIO,
  BEAM_INERTIA_MODIFIER,
  COLUMN_INERTIA_MODIFIER,
  VERTICAL_MEMBER_TOLERANCE,
  SINGULARITY_TOLERANCE,
  EQUILIBRIUM_TOLERANCE,
  RCDesignError,
  Errors,
  FrameAnalysisError,
  FrameErrors,
} from "./core";

// Utilities
export {
  solveQuadratic,
  roundToDecimalPlaces,
  mergeWarnings,
  zeros,
  identity,
  transpose,
  matMul,
  matVec,
  choleskySolve,
  solveLinearSystem,
} from "./utils";
export type { Matrix } from "./utils";
