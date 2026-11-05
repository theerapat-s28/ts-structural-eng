// Frame members (line elements).

/**
 * A model node that lies off a member's axis, between its ends, by no more than this fraction
 * of the member's length (and at most `NODE_NEAR_MEMBER_MAX_DISTANCE`), but not on it, gets a
 * warning: it is probably meant to be on the member, yet it is not connected to it.
 */
export const NODE_NEAR_MEMBER_RATIO = 0.01;

/** Upper bound (mm) of the near-miss distance given by `NODE_NEAR_MEMBER_RATIO`. */
export const NODE_NEAR_MEMBER_MAX_DISTANCE = 100;
