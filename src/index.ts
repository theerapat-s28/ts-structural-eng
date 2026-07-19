// RC Beam Design
export {
  rectBeamMomentCapacity,
  rectBeamBarLayout,
  concreteBeta,
  concreteElasticModulus,
  psiToMpa,
} from "./rc";

// Strengthening
export { calculateSteelJacketedBeamMomentCapacity } from "./strengthening";

// Core (types, constants, errors)
export type {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  RebarGroupInput,
  RectBeamBarLayoutInput,
  SteelJacketedProps,
  Warnings,
  calculationResult,
  unit,
} from "./core";

export {
  isSinglyReinforced,
  FLEXURAL_STRENGTH_REDUCTION_FACTOR,
  CONCRETE_ULTIMATE_STRAIN,
  RCDesignError,
  Errors,
} from "./core";

// Utilities
export { solveQuadratic, roundToDecimalPlaces, mergeWarnings } from "./utils";
