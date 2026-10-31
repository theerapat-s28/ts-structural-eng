import { findAutoRestraints } from "@app-fea/shared/solver/auto-restraint";
import { buildBoundaryConditions } from "@app-fea/shared/solver/boundary-conditions";
import { memberDofs } from "@app-fea/frame/solver/member-assembly";
import { elementDofs } from "@app-fea/shared/solver/global-assembly";

describe("elementDofs", () => {
  it("lists 6 DOFs per node in the element's node order", () => {
    expect(elementDofs([2, 0, 5])).toEqual([
      12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5, 30, 31, 32, 33, 34, 35,
    ]);
  });

  it("gives a member's DOFs as a 2-node element", () => {
    expect(memberDofs({ startIndex: 3, endIndex: 1 })).toEqual(elementDofs([3, 1]));
  });
});

describe("findAutoRestraints with an element of more than 2 nodes", () => {
  // 3-node element on nodes [2, 0, 1]: rotational stiffness only at its 1st and 3rd node
  const nodes = [2, 0, 1];
  const kGlobal = Array.from({ length: 18 }, (_, i) =>
    Array.from({ length: 18 }, (__, j) => {
      if (i !== j) return 0;
      const position = Math.floor(i / 6);
      const rotation = i % 6 >= 3;
      return rotation && position === 1 ? 0 : 1000;
    }),
  );
  const nodeIndex = new Map([0, 1, 2].map((n) => [n, n]));

  it("reads each node's rotational block from that node's position in the element", () => {
    const boundary = buildBoundaryConditions([], nodeIndex, 18);
    const held = findAutoRestraints(3, [{ nodes, kGlobal }], boundary);

    // node 0 sits at position 1, the only position without rotational stiffness
    expect(held.map((r) => r.node)).toEqual([0, 0, 0]);
    const axes = held.map((r) => r.axis.map(Math.abs));
    expect(axes).toEqual(
      expect.arrayContaining([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    );
  });

  it("adds the blocks of every element meeting at a node", () => {
    const boundary = buildBoundaryConditions([], nodeIndex, 18);
    // a second element whose only rotational stiffness is at node 0
    const other = {
      nodes: [0, 1],
      kGlobal: Array.from({ length: 12 }, (_, i) =>
        Array.from({ length: 12 }, (__, j) => (i === j && i >= 3 && i < 6 ? 500 : 0)),
      ),
    };
    expect(findAutoRestraints(3, [{ nodes, kGlobal }, other], boundary)).toEqual([]);
  });
});
