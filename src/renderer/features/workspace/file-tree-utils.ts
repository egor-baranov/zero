export interface TreeNode {
  type: 'file' | 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

interface MutableTreeNode {
  type: 'file' | 'dir';
  name: string;
  path: string;
  children: Map<string, MutableTreeNode>;
}

const sortByName = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    sensitivity: 'base',
    numeric: true,
  });

const collapseDirectoryChain = (
  node: MutableTreeNode,
): {
  name: string;
  path: string;
  children: Map<string, MutableTreeNode>;
} => {
  let currentName = node.name;
  let currentPath = node.path;
  let currentChildren = node.children;

  while (currentChildren.size === 1) {
    const [onlyChild] = Array.from(currentChildren.values());
    if (!onlyChild || onlyChild.type !== 'dir') {
      break;
    }

    currentName = `${currentName}/${onlyChild.name}`;
    currentPath = onlyChild.path;
    currentChildren = onlyChild.children;
  }

  return {
    name: currentName,
    path: currentPath,
    children: currentChildren,
  };
};

export const buildFileTree = (filePaths: string[]): TreeNode[] => {
  const root = new Map<string, MutableTreeNode>();

  for (const rawPath of filePaths) {
    const normalizedPath = rawPath
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');

    if (!normalizedPath) {
      continue;
    }

    const segments = normalizedPath.split('/');
    let currentLevel = root;
    let parentPath = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const segmentPath = parentPath ? `${parentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      const existing = currentLevel.get(segment);

      if (existing) {
        if (!isLeaf) {
          existing.type = 'dir';
          currentLevel = existing.children;
          parentPath = segmentPath;
        }
        continue;
      }

      const nextNode: MutableTreeNode = {
        type: isLeaf ? 'file' : 'dir',
        name: segment,
        path: segmentPath,
        children: new Map<string, MutableTreeNode>(),
      };

      currentLevel.set(segment, nextNode);

      if (!isLeaf) {
        currentLevel = nextNode.children;
        parentPath = segmentPath;
      }
    }
  }

  const finalize = (level: Map<string, MutableTreeNode>): TreeNode[] => {
    const values = Array.from(level.values());
    values.sort((left, right) => {
      if (left.type === right.type) {
        return sortByName(left.name, right.name);
      }

      return left.type === 'dir' ? -1 : 1;
    });

    return values.map((node) => {
      if (node.type === 'dir') {
        const collapsed = collapseDirectoryChain(node);
        return {
          type: 'dir',
          name: collapsed.name,
          path: collapsed.path,
          children: finalize(collapsed.children),
        };
      }

      return {
        type: 'file',
        name: node.name,
        path: node.path,
        children: [],
      };
    });
  };

  return finalize(root);
};
