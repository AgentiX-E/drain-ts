/**
 * Node — building block for the fixed-depth prefix tree.
 *
 * Maps 1:1 to Python `Node` class (drain.py L28-L35).
 *
 * Python `__slots__` equivalent: keyToChildNode, clusterIds
 *
 * Each Node in the parse tree represents a position within the token sequence.
 * Nodes at the maximum depth (maxNodeDepth) hold cluster_ids — references
 * to clusters that share the same token prefix path.
 */

export class Node {
  /**
   * Child nodes keyed by token value.
   * Uses Map for O(1) lookup — mirrors Python dict (MutableMapping[str, Node]).
   * The special key `paramStr` (e.g. "<*>") is used as a wildcard for
   * parameterized tokens.
   *
   * Python: self.key_to_child_node: MutableMapping[str, Node] = {}
   */
  readonly keyToChildNode: Map<string, Node> = new Map();

  /**
   * IDs of clusters rooted at this node (leaf nodes only).
   * For non-leaf nodes, this is empty.
   *
   * Python: self.cluster_ids: Sequence[int] = []
   */
  clusterIds: number[] = [];
}
