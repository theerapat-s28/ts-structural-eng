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
} from "./rc";

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
  RCDesignError,
  Errors,
} from "./core";

// Utilities
export { solveQuadratic, roundToDecimalPlaces, mergeWarnings } from "./utils";
