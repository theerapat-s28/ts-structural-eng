import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "@app-utils/math";
import * as RCConstants from "@app-core/constants/rc.constant";

import { concreteShearCapacity, stirrupShearCapacity } from "@app-rc/rc-beam-design";

import { boltShearCapacity } from "./rc-beam-plate-interface-bolts";

import { StirrupShearSection } from "@app-core/types/rc-beam.type";

import {
  SidePlateShearProps,
  SidePlateConfiguration,
  SidePlateAnchorage,
  hasSidePlate,
} from "@app-core/types/plate-jacketing.type";

import { Warnings } from "@app-core/types/output-message.type";

/*
 * ACI 440.2R-17 citation status.
 *
 * Verified against the guide:
 *   - 11.4.2 Spacing — spaced FRP strips "should adhere to the limits prescribed by
 *     ACI 318 for internal steel shear reinforcement", and strip spacing is measured
 *     centreline to centreline. The guide imposes no spacing rule of its own, so the
 *     ACI 318-19 9.7.6.2.2 check in `assembleResult` satisfies both documents.
 *   - 11.4.3 Reinforcement limits — Vs + Vf <= 0.66 sqrt(fc') bw d (SI), Eq. (11.4.3),
 *     the limit `assembleResult` applies as the web crushing headroom.
 *
 * TODO — still unverified, and therefore cited at §11.4 only: the subsections carrying
 * the 0.004 effective strain cap and the psi_f = 0.85 reduction factor.
 */

/**
 * Side plate geometry reduced to the quantities both capacity models need.
 *
 * `coverageRatio` is the fraction of the span length occupied by plate — 1 for a
 * continuous plate, `wp / s` for strips — which is what lets the two
 * configurations share one expression in each model.
 */
type SidePlateGeometry = {
  sides: number;
  tp: number; // mm, plate thickness
  dp: number; // mm, engaged vertical depth
  wp: number | null; // mm, strip width (null when continuous)
  s: number | null; // mm, strip pitch (null when continuous)
  coverageRatio: number;
  angleRad: number;
  Es: number; // MPa
  fy: number; // MPa
  configuration: SidePlateConfiguration;
};

const resolveSidePlateGeometry = (plates: SidePlateShearProps): SidePlateGeometry => {
  const sides = plates.sides ?? RCConstants.DEFAULT_SIDE_PLATE_SIDES;
  const Es = plates.Es ?? RCConstants.DEFAULT_PLATE_ELASTIC_MODULUS;
  const strips = plates.configuration === "strips";

  // A continuous plate is the limiting case of strips with wp = s, so it carries
  // a coverage ratio of 1 and the vertical orientation the model assumes.
  const wp = strips ? (plates.width ?? 0) : null;
  const s = strips ? (plates.spacing ?? 0) : null;
  const angle = strips
    ? (plates.angle ?? RCConstants.DEFAULT_SIDE_PLATE_ANGLE)
    : RCConstants.DEFAULT_SIDE_PLATE_ANGLE;

  return {
    sides,
    tp: plates.thickness,
    dp: plates.depth,
    wp,
    s,
    coverageRatio: strips && s !== null && s > 0 ? (wp as number) / s : 1,
    angleRad: (angle * Math.PI) / 180,
    Es,
    fy: plates.fy,
    configuration: plates.configuration,
  };
};

const validateSidePlateGeometry = (
  section: StirrupShearSection,
  plates: SidePlateShearProps,
  geo: SidePlateGeometry,
): void => {
  if (
    !hasSidePlate(plates) ||
    geo.fy <= 0 ||
    geo.Es <= 0 ||
    (geo.sides !== 1 && geo.sides !== 2) ||
    section.bw <= 0 ||
    section.d <= 0 ||
    geo.dp > section.d
  ) {
    throw new RCDesignError(Errors.SIDE_PLATE_GEOMETRY_INVALID);
  }

  if (geo.configuration === "strips") {
    const wp = geo.wp ?? 0;
    const s = geo.s ?? 0;
    // A strip wider than its pitch is a continuous plate described wrongly, and
    // an inclination outside (0, 90] has no meaning in the tie model.
    if (wp <= 0 || s <= 0 || wp > s || geo.angleRad <= 0 || geo.angleRad > Math.PI / 2) {
      throw new RCDesignError(Errors.SIDE_PLATE_GEOMETRY_INVALID);
    }
  }

  if (plates.anchorage !== undefined) {
    const { boltsPerRow, rowSpacing } = plates.anchorage;
    if (boltsPerRow <= 0 || rowSpacing <= 0) {
      throw new RCDesignError(Errors.SIDE_PLATE_GEOMETRY_INVALID);
    }
  }
};

/**
 * Shear capacity of the section before strengthening: φVc + φVs.
 *
 * A section with no stirrups (`Av <= 0` or `s <= 0`) contributes φVs = 0 rather
 * than dividing by a zero spacing.
 *
 * An existing Vs beyond the ACI 318-19 22.5.1.2 maximum reaches `stirrupShearCapacity`
 * as error 105 ("section too small for shear"). In the strengthening context the
 * useful diagnosis is the more specific one — the web is already at its ceiling, so
 * no added plate force can be developed — so it is re-thrown as 206.
 */
const baselineShearCapacity = (section: StirrupShearSection) => {
  const concrete = concreteShearCapacity(section);

  const hasStirrups = section.Av > 0 && section.s > 0;
  let stirrups: { phiVs: number; calculationDetails: { Vs: number }; warnings: Warnings };

  if (hasStirrups) {
    try {
      stirrups = stirrupShearCapacity(section);
    } catch (error) {
      if (error instanceof RCDesignError && error.code === Errors.SHEAR_STRENGTH_EXCEEDS_MAX.code) {
        throw new RCDesignError(Errors.STRENGTHENED_SHEAR_NO_HEADROOM);
      }
      throw error;
    }
  } else {
    stirrups = { phiVs: 0, calculationDetails: { Vs: 0 }, warnings: [] };
  }

  return {
    phiVn: MyMath.roundToDecimalPlaces(concrete.phiVc + stirrups.phiVs, 2),
    phiVc: concrete.phiVc,
    phiVs: stirrups.phiVs,
    Vc: concrete.calculationDetails.Vc,
    Vs: stirrups.calculationDetails.Vs,
    warnings: [...concrete.warnings, ...stirrups.warnings],
  };
};

/**
 * Design strength the bolt group can drag into the concrete across a 45° crack.
 *
 * The crack's horizontal projection is taken as `dp`, so the rows anchoring the
 * plate beyond it number `floor(dp / rowSpacing)`, at least one — the same
 * `dfv / sf` counting ACI 440.2R uses for bonded shear reinforcement.
 *
 * The returned value already carries the anchor φ of 0.65 from `boltShearCapacity`,
 * so it is compared against the plate's φVp on a design-strength basis.
 */
const anchorageCapacity = (
  anchorage: SidePlateAnchorage,
  geo: SidePlateGeometry,
  warnings: Warnings,
) => {
  const boltResult = boltShearCapacity(anchorage.bolt);
  warnings.push(...boltResult.warnings);

  const exactRows = geo.dp / anchorage.rowSpacing;
  const rows = Math.max(1, Math.floor(exactRows));

  if (exactRows < 1) {
    warnings.push({
      message: `Bolt row spacing (${anchorage.rowSpacing} mm) exceeds the engaged plate depth (${geo.dp} mm); only one row was taken as crossing the assumed 45 degree crack.`,
    });
  }

  // Same minimum anchor spacing `plateInterfaceBoltRequirement` checks, so the two
  // strengthening paths hold bolt layouts to one rule.
  if (anchorage.bolt.diameter !== undefined) {
    const minSpacing = RCConstants.MIN_ANCHOR_SPACING_DIAMETER_FACTOR * anchorage.bolt.diameter;
    if (anchorage.rowSpacing < minSpacing) {
      warnings.push({
        reference: "ACI318-19, 17.9.2",
        message: `Bolt row spacing (${anchorage.rowSpacing} mm) is below the minimum anchor spacing of 4*da (${minSpacing} mm); use a larger pitch, a smaller bolt, or fewer rows.`,
      });
    }
  }

  return {
    phiVanchorage: MyMath.roundToDecimalPlaces(
      geo.sides * rows * anchorage.boltsPerRow * boltResult.phiVbolt,
      2,
    ),
    rows,
    phiVbolt: boltResult.phiVbolt,
    boltsPerRow: anchorage.boltsPerRow,
  };
};

/** Detailing and modelling warnings shared by both capacity models. */
const collectCommonWarnings = (
  section: StirrupShearSection,
  plates: SidePlateShearProps,
  geo: SidePlateGeometry,
  warnings: Warnings,
): void => {
  warnings.push({
    message:
      "ACI 318-19 contains no provisions for steel side plates in shear; this capacity is an engineering model, not a code-sanctioned calculation, and must be confirmed against test data or a specialist review.",
  });

  if (geo.dp < section.d) {
    warnings.push({
      message: `Engaged plate depth dp (${geo.dp} mm) is less than the effective depth d (${section.d} mm); only the plated depth was taken as resisting shear.`,
    });
  }

  // Strip pitch is checked against ACI 318-19 9.7.6.2.2 alone, in `assembleResult`
  // where Vp is known. ACI 440.2R-17 11.4.2 defers to the ACI 318 limits for internal
  // steel shear reinforcement rather than imposing its own, so that one check
  // satisfies both documents. (The `wf + d/4` rule of ACI 440.2R-08 did not survive
  // into the 2017 edition and is deliberately not applied.)

  if (geo.sides === 1) {
    warnings.push({
      message:
        "A plate on one face only loads the section eccentrically; the resulting torsion and out-of-plane twist are not captured by this in-plane shear model and must be assessed separately.",
    });
  }

  if (plates.anchorage === undefined) {
    warnings.push({
      message:
        "No anchorage was supplied, so the reported capacity assumes the plate is fully developed; the bolt group or bond must be checked separately.",
    });
  }
};

/**
 * Applies the ACI 318-19 22.5.1.2 web crushing cap and the anchorage limit, then
 * assembles the `before`/`after` result both models return.
 *
 * The cap `Vs + Vp <= 0.66 sqrt(fc') bw d` — mirrored for bonded shear
 * strengthening by ACI 440.2R-17 11.4.3, Eq. (11.4.3) — is a property of the concrete web, so
 * it limits the plate force the web can host rather than invalidating the design:
 * the plate contribution is truncated to the remaining headroom and a warning
 * says so. Only a section whose existing Vs already exhausts the cap throws,
 * because there no strengthening at all can be developed.
 *
 * @param VpNominal - Plate nominal shear contribution in N, before φ and before
 *   any model-specific reduction factor
 * @param reductionFactor - Model-specific factor applied to the plate term only
 *   (1.0 for web yielding, psi_f for the tension tie)
 */
const assembleResult = <TModelDetails extends Record<string, unknown>>(
  section: StirrupShearSection,
  plates: SidePlateShearProps,
  geo: SidePlateGeometry,
  VpNominal: number,
  reductionFactor: number,
  method: "webYielding" | "tensionTie",
  modelDetails: TModelDetails,
  warnings: Warnings,
) => {
  const before = baselineShearCapacity(section);
  const baseWarnings = [...before.warnings, ...warnings];

  const VpModelKN = VpNominal * reductionFactor * 0.001;
  const maxVsKN =
    RCConstants.MAX_VS_COEFFICIENT * Math.sqrt(section.fc_) * section.bw * section.d * 0.001;
  const headroomKN = maxVsKN - before.Vs;

  if (headroomKN <= 0) {
    throw new RCDesignError(Errors.STRENGTHENED_SHEAR_NO_HEADROOM);
  }

  const VpEffectiveKN = Math.min(VpModelKN, headroomKN);
  const webCrushingGoverns = VpEffectiveKN < VpModelKN;

  if (webCrushingGoverns) {
    baseWarnings.push({
      reference: "ACI318-19, 22.5.1.2",
      message: `Plate contribution of ${MyMath.roundToDecimalPlaces(VpModelKN, 2)} kN truncated to the remaining web capacity of ${MyMath.roundToDecimalPlaces(headroomKN, 2)} kN, so that Vs + Vp stays within 0.66*sqrt(fc')*bw*d (${MyMath.roundToDecimalPlaces(maxVsKN, 2)} kN); a thinner or shallower plate carries the section just as far.`,
    });
  }

  // ACI 318-19 9.7.6.2.2 halves the permitted spacing once the shear reinforcement
  // carries more than 0.33*sqrt(fc')*bw*d. The plate is what usually pushes a section
  // over that threshold, so the limit is keyed off Vs + Vp rather than Vs alone.
  if (geo.configuration === "strips" && geo.s !== null) {
    const sqrtFc = Math.sqrt(section.fc_);
    const vsThresholdKN =
      RCConstants.VS_SPACING_THRESHOLD_COEFFICIENT * sqrtFc * section.bw * section.d * 0.001;
    const highShear = before.Vs + VpEffectiveKN > vsThresholdKN;

    const maxSpacing = highShear
      ? Math.min(
          RCConstants.MAX_STIRRUP_SPACING_HIGH_VS_DEPTH_FACTOR * section.d,
          RCConstants.MAX_STIRRUP_SPACING_HIGH_VS,
        )
      : Math.min(
          RCConstants.MAX_STIRRUP_SPACING_LOW_VS_DEPTH_FACTOR * section.d,
          RCConstants.MAX_STIRRUP_SPACING_LOW_VS,
        );

    if (geo.s > maxSpacing) {
      baseWarnings.push({
        reference: "ACI318-19, 9.7.6.2.2",
        message: `Strip pitch (${geo.s} mm) exceeds the maximum shear reinforcement spacing of ${MyMath.roundToDecimalPlaces(maxSpacing, 2)} mm${highShear ? `, tightened because Vs + Vp (${MyMath.roundToDecimalPlaces(before.Vs + VpEffectiveKN, 2)} kN) exceeds 0.33*sqrt(fc')*bw*d (${MyMath.roundToDecimalPlaces(vsThresholdKN, 2)} kN)` : ""}; a diagonal crack can pass between strips without crossing one.`,
      });
    }
  }

  const phiVpPlate = MyMath.roundToDecimalPlaces(
    RCConstants.SHEAR_STRENGTH_REDUCTION_FACTOR * VpEffectiveKN,
    2,
  );

  const anchorage =
    plates.anchorage !== undefined ? anchorageCapacity(plates.anchorage, geo, baseWarnings) : null;

  const anchorageGoverns = anchorage !== null && anchorage.phiVanchorage < phiVpPlate;
  const phiVp = anchorageGoverns
    ? (anchorage as { phiVanchorage: number }).phiVanchorage
    : phiVpPlate;

  let governedBy: "plateCapacity" | "anchorage" | "webCrushing" = "plateCapacity";
  if (anchorageGoverns) {
    governedBy = "anchorage";
  } else if (webCrushingGoverns) {
    governedBy = "webCrushing";
  }

  return {
    method,
    before: {
      phiVn: before.phiVn,
      calculationDetails: {
        phiVc: before.phiVc,
        phiVs: before.phiVs,
        Vc: before.Vc,
        Vs: before.Vs,
      },
      unit: "kN",
      warnings: before.warnings,
    },
    after: {
      phiVn: MyMath.roundToDecimalPlaces(before.phiVn + phiVp, 2),
      phiVp: MyMath.roundToDecimalPlaces(phiVp, 2),
      governedBy,
      calculationDetails: {
        phiVc: before.phiVc,
        phiVs: before.phiVs,
        Vp: MyMath.roundToDecimalPlaces(VpModelKN, 2),
        VpEffective: MyMath.roundToDecimalPlaces(VpEffectiveKN, 2),
        maxVs: MyMath.roundToDecimalPlaces(maxVsKN, 2),
        headroom: MyMath.roundToDecimalPlaces(headroomKN, 2),
        phiVpPlate,
        phiVanchorage: anchorage !== null ? anchorage.phiVanchorage : null,
        anchorageRows: anchorage !== null ? anchorage.rows : null,
        phiVbolt: anchorage !== null ? anchorage.phiVbolt : null,
        sides: geo.sides,
        coverageRatio: MyMath.roundToDecimalPlaces(geo.coverageRatio, 4),
        ...modelDetails,
      },
      unit: "kN",
      warnings: baseWarnings,
    },
  };
};

/**
 * Shear capacity of a beam strengthened with bolted steel side plates, treating
 * each plate as a supplementary web that resists in-plane shear.
 *
 * The plate reaches the von Mises shear yield stress of 0.6 fy (AISC 360 G2.1):
 *
 * - continuous: `Vp = nSides · 0.6 fy · tp · dp`
 * - strips: `Vp = nSides · 0.6 fy · tp · dp · wp / s`
 *
 * Strips are handled as the fraction `wp / s` of a continuous web, which is an
 * approximation — a discrete strip works more as a tension tie than as a web
 * panel, which is what `sidePlateShearCapacityByTensionTie` models. Run both and
 * take the lower value, or call `compareSidePlateShearCapacity`.
 *
 * ACI 318-19 has no provisions for steel side plates in shear; a warning always
 * says so.
 *
 * @param section - Original beam shear properties (fc_, bw, d, Av, fyt, s, optional lambda)
 * @param plates - Side plate geometry, strength, layout, and optional anchorage
 * @returns `before` and `after` results, each with `phiVn` (kN), `calculationDetails`,
 *   `unit`, and `warnings`; `after` also carries `phiVp` and `governedBy`
 * @throws {RCDesignError} 205 if the plate geometry is inconsistent, 206 if the
 *   existing Vs leaves no headroom under the ACI 318-19 22.5.1.2 maximum, 202 if
 *   the supplied bolt capacity is invalid
 */
export const sidePlateShearCapacityByWebYielding = (
  section: StirrupShearSection,
  plates: SidePlateShearProps,
) => {
  const warnings: Warnings = [];
  const geo = resolveSidePlateGeometry(plates);
  validateSidePlateGeometry(section, plates, geo);
  collectCommonWarnings(section, plates, geo, warnings);

  const tauY = RCConstants.PLATE_SHEAR_YIELD_COEFFICIENT * geo.fy; // MPa
  const VpNominal = geo.sides * tauY * geo.tp * geo.dp * geo.coverageRatio; // N

  // AISC 360 G2.1(a): beyond this slenderness the panel buckles in shear before it
  // yields. The concrete restrains the inner face, so this is a warning, not a limit.
  const slenderness = geo.dp / geo.tp;
  const slendernessLimit =
    RCConstants.PLATE_SHEAR_SLENDERNESS_COEFFICIENT * Math.sqrt(geo.Es / geo.fy);

  if (slenderness > slendernessLimit) {
    warnings.push({
      reference: "AISC360-22, G2.1",
      message: `Plate slenderness dp/tp (${MyMath.roundToDecimalPlaces(slenderness, 1)}) exceeds 2.24*sqrt(Es/fy) (${MyMath.roundToDecimalPlaces(slendernessLimit, 1)}); shear buckling may precede yielding unless the plate is stiffened or continuously restrained by the concrete.`,
    });
  }

  return assembleResult(
    section,
    plates,
    geo,
    VpNominal,
    1.0,
    "webYielding",
    {
      tauY: MyMath.roundToDecimalPlaces(tauY, 2),
      slenderness: MyMath.roundToDecimalPlaces(slenderness, 1),
      slendernessLimit: MyMath.roundToDecimalPlaces(slendernessLimit, 1),
    },
    warnings,
  );
};

/**
 * Shear capacity of a beam strengthened with bolted steel side plates, treating
 * each plate as a tension tie crossing the diagonal crack, following the bonded
 * shear reinforcement model of ACI 440.2R-17 §11.4 with steel in place of FRP:
 *
 * `Vp = nSides · tp · wp · ffe · (sin α + cos α) · dp / s`
 *
 * with `ffe = min(fy, Es · 0.004)` — the 0.004 strain cap of 440.2R §11.4, which
 * keeps the crack tight enough for aggregate interlock — and the additional
 * reduction factor `psi_f = 0.85` for two-sided bonded strengthening. A continuous
 * plate is the case `wp = s`, `α = 90°`.
 *
 * Note that for structural steel `Es · 0.004 = 800 MPa` sits above any normal `fy`,
 * so the strain cap does not bind and the tie reaches yield; this model therefore
 * usually returns a higher capacity than `sidePlateShearCapacityByWebYielding` for
 * a continuous plate. Neither is code-sanctioned for steel side plates — a warning
 * always says so.
 *
 * @param section - Original beam shear properties (fc_, bw, d, Av, fyt, s, optional lambda)
 * @param plates - Side plate geometry, strength, layout, and optional anchorage
 * @returns `before` and `after` results, each with `phiVn` (kN), `calculationDetails`,
 *   `unit`, and `warnings`; `after` also carries `phiVp` and `governedBy`
 * @throws {RCDesignError} 205 if the plate geometry is inconsistent, 206 if the
 *   existing Vs leaves no headroom under the ACI 318-19 22.5.1.2 maximum, 202 if
 *   the supplied bolt capacity is invalid
 */
export const sidePlateShearCapacityByTensionTie = (
  section: StirrupShearSection,
  plates: SidePlateShearProps,
) => {
  const warnings: Warnings = [];
  const geo = resolveSidePlateGeometry(plates);
  validateSidePlateGeometry(section, plates, geo);
  collectCommonWarnings(section, plates, geo, warnings);

  const strainLimitedStress = geo.Es * RCConstants.SIDE_PLATE_EFFECTIVE_STRAIN_LIMIT; // MPa
  const ffe = Math.min(geo.fy, strainLimitedStress);

  if (ffe < geo.fy) {
    warnings.push({
      reference: "ACI440.2R-17, 11.4",
      message: `Effective plate stress limited to ${MyMath.roundToDecimalPlaces(ffe, 2)} MPa by the 0.004 strain cap, below fy (${geo.fy} MPa); the plate does not reach yield.`,
    });
  }

  const orientation = Math.sin(geo.angleRad) + Math.cos(geo.angleRad);
  const VpNominal = geo.sides * geo.tp * ffe * geo.dp * geo.coverageRatio * orientation; // N

  return assembleResult(
    section,
    plates,
    geo,
    VpNominal,
    RCConstants.SIDE_PLATE_REDUCTION_FACTOR_PSI,
    "tensionTie",
    {
      ffe: MyMath.roundToDecimalPlaces(ffe, 2),
      strainLimitedStress: MyMath.roundToDecimalPlaces(strainLimitedStress, 2),
      orientation: MyMath.roundToDecimalPlaces(orientation, 4),
      psi: RCConstants.SIDE_PLATE_REDUCTION_FACTOR_PSI,
    },
    warnings,
  );
};

/**
 * Runs both side plate shear models on the same section and reports the lower
 * result as governing, which is the intended entry point when selecting a
 * conservative design capacity.
 *
 * @param section - Original beam shear properties (fc_, bw, d, Av, fyt, s, optional lambda)
 * @param plates - Side plate geometry, strength, layout, and optional anchorage
 * @returns `webYielding` and `tensionTie` results plus `governing`, holding the
 *   lower `phiVn`, its `phiVp`, and the `method` that produced it
 * @throws {RCDesignError} Whatever either model throws — see their documentation
 */
export const compareSidePlateShearCapacity = (
  section: StirrupShearSection,
  plates: SidePlateShearProps,
) => {
  const webYielding = sidePlateShearCapacityByWebYielding(section, plates);
  const tensionTie = sidePlateShearCapacityByTensionTie(section, plates);

  const governing = tensionTie.after.phiVn < webYielding.after.phiVn ? tensionTie : webYielding;

  return {
    webYielding,
    tensionTie,
    governing: {
      method: governing.method,
      phiVn: governing.after.phiVn,
      phiVp: governing.after.phiVp,
      governedBy: governing.after.governedBy,
    },
  };
};
