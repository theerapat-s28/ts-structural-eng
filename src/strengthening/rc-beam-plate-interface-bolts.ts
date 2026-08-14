import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "@app-utils/math";
import * as RCConstants from "@app-core/constants/rc.constant";

import { concreteElasticModulus } from "@app-rc/general";

import {
  RectBeamSection,
  RectDoublyBeamSection,
  isSinglyReinforced,
} from "@app-core/types/rc-beam.type";

import {
  SteelJacketedProps,
  SectionState,
  BoltProps,
  PlateShearFlowInput,
  PlateInterfaceBoltInput,
  hasTopPlate,
  hasBottomPlate,
} from "@app-core/types/plate-jacketing.type";

import { Warnings } from "@app-core/types/output-message.type";

/**
 * One transformed-section component: area, centroid depth from the datum, and
 * self-inertia about its own centroid. All areas are already transformed to
 * equivalent concrete.
 */
type TransformedPart = {
  A: number; // mm^2, transformed area
  y: number; // mm, centroid depth from the datum
  I: number; // mm^4, self inertia about own centroid
};

/**
 * Geometry of the jacketed section, measured from the datum at the top face of
 * the top plate (or the concrete top face when there is no top plate).
 *
 * This differs from `calculateSteelJacketedBeamMomentCapacity`, which measures
 * from the extreme concrete compression fibre so that its equivalent rectangular
 * stress block covers concrete only. The elastic transformed section here places
 * the concrete explicitly at `yConcreteTop`, so it needs no such restriction.
 * Both are internally consistent; depths are only comparable within one of them.
 */
type JacketedGeometry = {
  tTop: number; // mm, top plate thickness (0 when absent)
  tBottom: number; // mm, bottom plate thickness (0 when absent)
  ATop: number; // mm^2, gross top plate area
  ABottom: number; // mm^2, gross bottom plate area
  yTop: number; // mm, top plate centroid
  yBottom: number; // mm, bottom plate centroid
  yConcreteTop: number; // mm, concrete top face
  yConcreteBottom: number; // mm, concrete bottom face
  yTensionSteel: number; // mm, tension rebar centroid
  yCompSteel: number | null; // mm, compression rebar centroid (null when singly reinforced)
  As_: number; // mm^2, compression rebar area (0 when singly reinforced)
};

const resolveGeometry = (
  section: RectBeamSection,
  plates: SteelJacketedProps,
): JacketedGeometry => {
  const tTop = hasTopPlate(plates) ? (plates.topSteelThickness as number) : 0;
  const tBottom = hasBottomPlate(plates) ? (plates.bottomSteelThickness as number) : 0;

  const ATop = hasTopPlate(plates) ? (plates.topSteelWidth as number) * tTop : 0;
  const ABottom = hasBottomPlate(plates) ? (plates.bottomSteelWidth as number) * tBottom : 0;

  const singly = isSinglyReinforced(section);
  const doubly = section as RectDoublyBeamSection;

  return {
    tTop,
    tBottom,
    ATop,
    ABottom,
    yTop: tTop / 2,
    yBottom: tTop + section.h + tBottom / 2,
    yConcreteTop: tTop,
    yConcreteBottom: tTop + section.h,
    yTensionSteel: tTop + section.d,
    yCompSteel: singly ? null : tTop + doubly.d_,
    As_: singly ? 0 : doubly.As_,
  };
};

const validateGeometry = (section: RectBeamSection, geo: JacketedGeometry): void => {
  if (
    section.b <= 0 ||
    section.h <= 0 ||
    section.d <= 0 ||
    section.d >= section.h ||
    section.As <= 0
  ) {
    throw new RCDesignError(Errors.PLATE_OUTSIDE_SECTION);
  }
  if (geo.yCompSteel !== null && geo.yCompSteel >= geo.yTensionSteel) {
    throw new RCDesignError(Errors.PLATE_OUTSIDE_SECTION);
  }
};

/**
 * Solves the cracked-section neutral axis depth (from the datum) by setting the
 * first moment of the transformed areas about the neutral axis to zero.
 *
 * @param compSteelInCompression - Whether the compression rebar is assumed to sit
 *   above the neutral axis, which decides between the (n-1) and n modular ratios
 */
const solveCrackedNeutralAxis = (
  section: RectBeamSection,
  geo: JacketedGeometry,
  ns: number,
  np: number,
  compSteelInCompression: boolean,
): number | null => {
  const { b } = section;
  const AsTr = ns * section.As;
  const ATopTr = np * geo.ATop;
  const ABottomTr = np * geo.ABottom;
  // Compression rebar displaces concrete that is already counted in the block,
  // so it is transformed with (n - 1); below the neutral axis it acts in tension
  // and takes the full n.
  const AsCompTr = compSteelInCompression ? (ns - 1) * geo.As_ : ns * geo.As_;

  const a = b / 2;
  const bq = -b * geo.yConcreteTop + ATopTr + AsCompTr + AsTr + ABottomTr;
  const c =
    (b * geo.yConcreteTop * geo.yConcreteTop) / 2 -
    ATopTr * geo.yTop -
    AsCompTr * (geo.yCompSteel ?? 0) -
    AsTr * geo.yTensionSteel -
    ABottomTr * geo.yBottom;

  const roots = MyMath.solveQuadratic(a, bq, c);
  const valid = roots.filter((root) => root > geo.yConcreteTop && root < geo.yConcreteBottom);

  return valid.length > 0 ? Math.max(...valid) : null;
};

/**
 * Builds the transformed-section parts and the neutral axis depth for the
 * requested section state.
 */
const buildTransformedSection = (
  section: RectBeamSection,
  geo: JacketedGeometry,
  ns: number,
  np: number,
  sectionState: SectionState,
  warnings: Warnings,
): { ybar: number; Itr: number } => {
  const parts: TransformedPart[] = [];

  if (geo.ATop > 0) {
    parts.push({
      A: np * geo.ATop,
      y: geo.yTop,
      I: (np * (geo.ATop / geo.tTop) * geo.tTop ** 3) / 12,
    });
  }
  if (geo.ABottom > 0) {
    parts.push({
      A: np * geo.ABottom,
      y: geo.yBottom,
      I: (np * (geo.ABottom / geo.tBottom) * geo.tBottom ** 3) / 12,
    });
  }

  let ybar: number;

  if (sectionState === "uncracked") {
    parts.push({
      A: section.b * section.h,
      y: geo.yConcreteTop + section.h / 2,
      I: (section.b * section.h ** 3) / 12,
    });
    parts.push({ A: (ns - 1) * section.As, y: geo.yTensionSteel, I: 0 });
    if (geo.As_ > 0 && geo.yCompSteel !== null) {
      parts.push({ A: (ns - 1) * geo.As_, y: geo.yCompSteel, I: 0 });
    }

    const sumA = parts.reduce((acc, part) => acc + part.A, 0);
    ybar = parts.reduce((acc, part) => acc + part.A * part.y, 0) / sumA;
  } else {
    let compSteelInCompression = true;
    let na = solveCrackedNeutralAxis(section, geo, ns, np, true);

    if (na !== null && geo.yCompSteel !== null && geo.yCompSteel > na) {
      // The assumed compression rebar is actually below the neutral axis; re-solve
      // with it on the tension side.
      compSteelInCompression = false;
      na = solveCrackedNeutralAxis(section, geo, ns, np, false);
      warnings.push({
        reference: "ACI318-19, 22.2.2.1",
        message:
          "Compression reinforcement lies below the cracked neutral axis; it was transformed as tension steel.",
      });
    }

    if (na === null) {
      throw new RCDesignError(Errors.CRACKED_NA_NOT_FOUND);
    }
    ybar = na;

    const c = ybar - geo.yConcreteTop; // depth of the concrete compression zone
    parts.push({
      A: section.b * c,
      y: geo.yConcreteTop + c / 2,
      I: (section.b * c ** 3) / 12,
    });
    parts.push({ A: ns * section.As, y: geo.yTensionSteel, I: 0 });
    if (geo.As_ > 0 && geo.yCompSteel !== null) {
      parts.push({
        A: compSteelInCompression ? (ns - 1) * geo.As_ : ns * geo.As_,
        y: geo.yCompSteel,
        I: 0,
      });
    }
  }

  const Itr = parts.reduce((acc, part) => acc + part.I + part.A * (part.y - ybar) ** 2, 0);

  return { ybar, Itr };
};

/**
 * Calculates the horizontal shear flow that must be transferred across each
 * concrete-to-plate interface of a steel plate jacketed beam, q = V·Q/I, using an
 * elastic transformed section.
 *
 * `Q` at an interface is the first moment of the area beyond that cut — the plate
 * itself — while `ybar` and `Itr` come from one solve that includes every plate
 * present, so adding a top plate also changes the bottom interface shear flow.
 *
 * @param input - Section, plate properties, factored shear V (kN), and section state
 * @returns Object containing per-interface `top`/`bottom` shear flow (`null` when the
 *   plate is absent), `calculationDetails`, `unit`, and `warnings`
 * @throws {RCDesignError} If V is not positive or no plate is present (201), the
 *   geometry is inconsistent (203), or no cracked neutral axis exists (204)
 */
export const plateInterfaceShearFlow = (input: PlateShearFlowInput) => {
  const warnings: Warnings = [];
  const { section, plates, V } = input;
  const sectionState: SectionState = input.sectionState ?? "cracked";

  if (V <= 0 || (!hasTopPlate(plates) && !hasBottomPlate(plates))) {
    throw new RCDesignError(Errors.NON_POSITIVE_SHEAR_FLOW);
  }

  const geo = resolveGeometry(section, plates);
  validateGeometry(section, geo);

  const Ec = concreteElasticModulus(section.fc_);
  const ns = section.Es / Ec;
  const np = plates.Es / Ec;

  const { ybar, Itr } = buildTransformedSection(section, geo, ns, np, sectionState, warnings);

  const VinN = V * 1000;

  const interfaceAt = (A: number, y: number) => {
    const Q = np * A * Math.abs(y - ybar);
    return {
      q: MyMath.roundToDecimalPlaces((VinN * Q) / Itr, 2),
      Q: MyMath.roundToDecimalPlaces(Q, 0),
      leverArm: MyMath.roundToDecimalPlaces(Math.abs(y - ybar), 2),
    };
  };

  if (geo.ATop > 0 && geo.yTop > ybar) {
    warnings.push({
      reference: "ACI318-19, 22.2.2.1",
      message:
        "Top plate centroid lies below the neutral axis; the plate is in tension, so the assumed compression-face behaviour does not apply.",
    });
  }

  return {
    top: geo.ATop > 0 ? interfaceAt(geo.ATop, geo.yTop) : null,
    bottom: geo.ABottom > 0 ? interfaceAt(geo.ABottom, geo.yBottom) : null,
    calculationDetails: {
      Ec: MyMath.roundToDecimalPlaces(Ec, 2),
      ns: MyMath.roundToDecimalPlaces(ns, 3),
      np: MyMath.roundToDecimalPlaces(np, 3),
      ybar: MyMath.roundToDecimalPlaces(ybar, 2),
      Itr: MyMath.roundToDecimalPlaces(Itr, 0),
      sectionState,
    },
    unit: "N/mm",
    warnings,
  };
};

/**
 * Calculates the design shear strength of a single anchor bolt from the steel
 * strength per ACI 318-19 17.7.1.2b, Vsa = 0.6 Ase,V futa, with φ = 0.65 from
 * Table 17.5.3 and the futa cap of 17.6.1.2.
 *
 * Concrete breakout (17.7.2) and pryout (17.7.3) depend on edge distances, anchor
 * spacing and embedment depth, and are NOT evaluated here — a warning always says so.
 * Supply `phiVboltOverride` to use a manufacturer or ESR value instead.
 *
 * @param bolt - Anchor properties (Ase, futa, optional fya, diameter, shearPlanes, override)
 * @returns Object containing `phiVbolt` (kN), `calculationDetails`, `unit`, and `warnings`
 * @throws {RCDesignError} If the resolved capacity is not positive (202)
 */
export const boltShearCapacity = (bolt: BoltProps) => {
  const warnings: Warnings = [];
  const shearPlanes = bolt.shearPlanes ?? 1;

  warnings.push({
    reference: "ACI318-19, 17.7.2",
    message:
      "Only anchor steel strength in shear is evaluated; concrete breakout and pryout must be checked separately.",
  });

  if (bolt.phiVboltOverride !== undefined) {
    if (bolt.phiVboltOverride <= 0) {
      throw new RCDesignError(Errors.INVALID_BOLT_CAPACITY);
    }
    return {
      phiVbolt: MyMath.roundToDecimalPlaces(bolt.phiVboltOverride, 2),
      calculationDetails: { source: "override", shearPlanes },
      unit: "kN",
      warnings,
    };
  }

  if (bolt.Ase <= 0 || bolt.futa <= 0 || shearPlanes <= 0) {
    throw new RCDesignError(Errors.INVALID_BOLT_CAPACITY);
  }

  const cap = Math.min(
    bolt.fya !== undefined ? RCConstants.ANCHOR_FUTA_FYA_FACTOR * bolt.fya : Infinity,
    RCConstants.MAX_ANCHOR_FUTA,
  );
  const futaEffective = Math.min(bolt.futa, cap);

  if (futaEffective < bolt.futa) {
    warnings.push({
      reference: "ACI318-19, 17.6.1.2",
      message: `futa (${bolt.futa} MPa) exceeds the limit of min(1.9*fya, ${RCConstants.MAX_ANCHOR_FUTA} MPa); capped at ${MyMath.roundToDecimalPlaces(futaEffective, 2)} MPa.`,
    });
  }

  const Vsa = RCConstants.ANCHOR_STEEL_SHEAR_COEFFICIENT * bolt.Ase * futaEffective * shearPlanes; // N

  return {
    phiVbolt: MyMath.roundToDecimalPlaces(
      RCConstants.ANCHOR_SHEAR_STRENGTH_REDUCTION_FACTOR * Vsa * 0.001,
      2,
    ),
    calculationDetails: {
      source: "ACI318-19, 17.7.1.2b",
      Vsa: MyMath.roundToDecimalPlaces(Vsa * 0.001, 2),
      futaEffective: MyMath.roundToDecimalPlaces(futaEffective, 2),
      shearPlanes,
    },
    unit: "kN",
    warnings,
  };
};

type InterfaceDemand = {
  q: number;
  Q: number;
  leverArm: number;
};

const designInterface = (
  demand: InterfaceDemand,
  plateArea: number,
  plateFy: number,
  phiVboltKN: number,
  boltsPerRow: number,
  transferLength: number,
  label: "top" | "bottom",
  warnings: Warnings,
) => {
  const phiVboltN = phiVboltKN * 1000;

  // Spacing that keeps the bolt row capacity at or above the shear flow demand
  const spacingFromShearFlow = (boltsPerRow * phiVboltN) / demand.q; // mm
  let requiredSpacing = spacingFromShearFlow;

  if (requiredSpacing > RCConstants.MAX_PLATE_BOLT_SPACING) {
    requiredSpacing = RCConstants.MAX_PLATE_BOLT_SPACING;
    warnings.push({
      message: `${label} plate: shear flow allows a pitch of ${MyMath.roundToDecimalPlaces(spacingFromShearFlow, 1)} mm, capped at the detailing limit of ${RCConstants.MAX_PLATE_BOLT_SPACING} mm.`,
    });
  }

  const rows = Math.ceil(transferLength / requiredSpacing) + 1;
  const boltCountFromShearFlow = rows * boltsPerRow;

  // The plate must also develop its own yield force over the transfer length
  const plateForce = plateArea * plateFy; // N
  const boltCountFromPlateForce = Math.ceil(plateForce / phiVboltN);

  const governedBy = boltCountFromPlateForce > boltCountFromShearFlow ? "plateForce" : "shearFlow";
  const boltCount = Math.max(boltCountFromShearFlow, boltCountFromPlateForce);

  return {
    q: demand.q,
    Q: demand.Q,
    leverArm: demand.leverArm,
    requiredSpacing: MyMath.roundToDecimalPlaces(requiredSpacing, 1),
    boltCount,
    governedBy,
    calculationDetails: {
      spacingFromShearFlow: MyMath.roundToDecimalPlaces(spacingFromShearFlow, 1),
      rows,
      boltCountFromShearFlow,
      boltCountFromPlateForce,
      plateForce: MyMath.roundToDecimalPlaces(plateForce * 0.001, 2),
    },
  };
};

/**
 * Determines the bolts required to transfer horizontal shear across each
 * concrete-to-plate interface of a steel plate jacketed beam.
 *
 * For each plate present, the required bolt pitch follows from the interface shear
 * flow (s = n·φVbolt / q) and the bolt count is taken as the larger of that pitch
 * over the transfer length and the count needed to develop the full plate yield
 * force (Ap·fy / φVbolt). `governedBy` reports which one controls.
 *
 * @param input - Section, plates, V (kN), bolt properties, bolts per row, and transfer length (mm)
 * @returns Object containing per-interface `top`/`bottom` results (`null` when the plate
 *   is absent), `calculationDetails`, `unit`, and `warnings`
 * @throws {RCDesignError} If V is not positive or no plate is present (201), the bolt
 *   capacity is invalid (202), the geometry is inconsistent (203), or no cracked
 *   neutral axis exists (204)
 */
export const plateInterfaceBoltRequirement = (input: PlateInterfaceBoltInput) => {
  const { plates, bolt, boltsPerRow, transferLength } = input;

  if (boltsPerRow <= 0 || transferLength <= 0) {
    throw new RCDesignError(Errors.PLATE_OUTSIDE_SECTION);
  }

  const flow = plateInterfaceShearFlow(input);
  const boltResult = boltShearCapacity(bolt);
  const warnings: Warnings = [...flow.warnings, ...boltResult.warnings];

  const geo = resolveGeometry(input.section, plates);

  const top =
    flow.top !== null
      ? designInterface(
          flow.top,
          geo.ATop,
          plates.fy,
          boltResult.phiVbolt,
          boltsPerRow,
          transferLength,
          "top",
          warnings,
        )
      : null;

  const bottom =
    flow.bottom !== null
      ? designInterface(
          flow.bottom,
          geo.ABottom,
          plates.fy,
          boltResult.phiVbolt,
          boltsPerRow,
          transferLength,
          "bottom",
          warnings,
        )
      : null;

  if (bolt.diameter !== undefined) {
    const minSpacing = RCConstants.MIN_ANCHOR_SPACING_DIAMETER_FACTOR * bolt.diameter;
    for (const result of [top, bottom]) {
      if (result !== null && result.requiredSpacing < minSpacing) {
        warnings.push({
          reference: "ACI318-19, 17.9.2",
          message: `Required pitch (${result.requiredSpacing} mm) is below the minimum anchor spacing of 4*da (${minSpacing} mm); use a larger bolt or more bolts per row.`,
        });
      }
    }
  }

  return {
    top,
    bottom,
    calculationDetails: {
      ...flow.calculationDetails,
      phiVbolt: boltResult.phiVbolt,
      boltsPerRow,
      transferLength,
    },
    unit: "kN",
    warnings,
  };
};
