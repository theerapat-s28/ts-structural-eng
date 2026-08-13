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
  Warnings,
  calculationResult,
  unit,
} from "./core";

export {
  isSinglyReinforced,
  hasTopPlate,
  hasBottomPlate,
  FLEXURAL_STRENGTH_REDUCTION_FACTOR,
  CONCRETE_ULTIMATE_STRAIN,
  SHEAR_STRENGTH_REDUCTION_FACTOR,
  ANCHOR_SHEAR_STRENGTH_REDUCTION_FACTOR,
  MAX_PLATE_BOLT_SPACING,
  RCDesignError,
  Errors,
} from "./core";

// Utilities
export { solveQuadratic, roundToDecimalPlaces, mergeWarnings } from "./utils";
