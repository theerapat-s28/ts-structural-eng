import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "@app-utils/math";

import {
  RebarGroupInput,
  RectBeamBarLayoutInput,
} from "@app-core/types/rc-beam.type";

import { Warnings } from "@app-core/types/output-message.type";

import * as RCConstants from "@app-core/constants/rc.constant";

interface BarGroupLayout {
  numberOfLayers: number;
  barsPerLayer: number[];
  distanceFromFace: number; // mm, face to centroid of the bar group
  outerExtent: number; // mm, face to outer edge of the farthest layer
  As: number; // mm2, total area of the group
}

/**
 * Lays out a group of same-diameter bars (top or bottom) into the minimum
 * number of layers that fit within the section width, per ACI 318-19 25.2.1
 * (min clear spacing within a layer) and 25.2.2 (min clear spacing between
 * layers), then returns the centroid distance from the near face.
 */
const calculateBarGroupLayout = (
  group: RebarGroupInput,
  b: number,
  cover: number,
  stirrupDiameter: number,
  maxAggregateSize: number,
): BarGroupLayout => {
  const { count, diameter } = group;

  if (count <= 0) {
    return {
      numberOfLayers: 0,
      barsPerLayer: [],
      distanceFromFace: 0,
      outerExtent: 0,
      As: 0,
    };
  }

  const minClearSpacing = Math.max(
    RCConstants.MIN_BAR_CLEAR_SPACING,
    diameter,
    RCConstants.AGGREGATE_SPACING_FACTOR * maxAggregateSize,
  );

  const availableWidth = b - 2 * (cover + stirrupDiameter);
  const maxBarsPerLayer = Math.min(
    count,
    Math.floor(
      (availableWidth + minClearSpacing) / (diameter + minClearSpacing),
    ),
  );

  if (maxBarsPerLayer < 1) {
    throw new RCDesignError(Errors.SECTION_TOO_NARROW_FOR_BAR);
  }

  const numberOfLayers = Math.ceil(count / maxBarsPerLayer);
  const baseBarsPerLayer = Math.floor(count / numberOfLayers);
  const remainder = count % numberOfLayers;
  const barsPerLayer = Array.from({ length: numberOfLayers }, (_, i) =>
    i < remainder ? baseBarsPerLayer + 1 : baseBarsPerLayer,
  );

  const layerPitch = diameter + RCConstants.MIN_LAYER_CLEAR_SPACING;
  const firstLayerDistance = cover + stirrupDiameter + diameter / 2;

  const weightedSum = barsPerLayer.reduce(
    (sum, n, i) => sum + n * (firstLayerDistance + i * layerPitch),
    0,
  );

  return {
    numberOfLayers,
    barsPerLayer,
    distanceFromFace: weightedSum / count,
    outerExtent:
      cover +
      stirrupDiameter +
      numberOfLayers * diameter +
      (numberOfLayers - 1) * RCConstants.MIN_LAYER_CLEAR_SPACING,
    As: count * (Math.PI / 4) * diameter ** 2,
  };
};

/**
 * Lays out top and bottom rebar groups within a rectangular beam section,
 * determining the number of layers required to satisfy ACI 318-19 minimum
 * bar spacing (25.2.1) and layer spacing (25.2.2), and returns the resulting
 * effective depth `d` and compression steel depth `d_`, both measured from
 * the top (compression) face so they plug directly into
 * {@link rectBeamMomentCapacity}'s `d` / `d_` inputs.
 *
 * @param input - Section dimensions, top/bottom bar groups, and optional
 *   cover / stirrup diameter / max aggregate size (default to ACI 318-19
 *   Table 20.6.1.3.1 values for cast-in-place beams not exposed to weather
 *   or in contact with ground)
 * @returns `d`, `d_`, per-group layer counts and areas, `unit`, and `warnings`
 * @throws {RCDesignError} If a bar does not fit within the section width, or
 *   if the combined top/bottom layers exceed the section height
 */
export const rectBeamBarLayout = (input: RectBeamBarLayoutInput) => {
  const warnings: Warnings = [];
  const cover = input.cover ?? RCConstants.DEFAULT_BEAM_COVER;
  const stirrupDiameter =
    input.stirrupDiameter ?? RCConstants.DEFAULT_STIRRUP_DIAMETER;
  const maxAggregateSize =
    input.maxAggregateSize ?? RCConstants.DEFAULT_MAX_AGGREGATE_SIZE;

  const top = calculateBarGroupLayout(
    input.topBars,
    input.b,
    cover,
    stirrupDiameter,
    maxAggregateSize,
  );
  const bottom = calculateBarGroupLayout(
    input.bottomBars,
    input.b,
    cover,
    stirrupDiameter,
    maxAggregateSize,
  );

  if (top.outerExtent + bottom.outerExtent > input.h) {
    throw new RCDesignError(Errors.BAR_LAYOUT_EXCEEDS_SECTION_HEIGHT);
  }

  return {
    d: MyMath.roundToDecimalPlaces(input.h - bottom.distanceFromFace, 1),
    d_: MyMath.roundToDecimalPlaces(top.distanceFromFace, 1),
    top: {
      numberOfLayers: top.numberOfLayers,
      barsPerLayer: top.barsPerLayer,
      As: MyMath.roundToDecimalPlaces(top.As, 1),
    },
    bottom: {
      numberOfLayers: bottom.numberOfLayers,
      barsPerLayer: bottom.barsPerLayer,
      As: MyMath.roundToDecimalPlaces(bottom.As, 1),
    },
    unit: "mm",
    warnings: warnings,
  };
};
