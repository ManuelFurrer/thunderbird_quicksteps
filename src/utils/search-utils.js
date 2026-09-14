function filterNodes(nodes, query) {
  const result = [];

  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue;

    const nameMatch = (item.name || '').toLowerCase().includes(query);

    if (item.type === 'folder') {
      if (nameMatch) {
        result.push({ ...item });
      } else if (Array.isArray(item.children)) {
        const matchingChildren = filterNodes(item.children, query);
        if (matchingChildren.length > 0) {
          result.push({ ...item, children: matchingChildren });
        }
      }
    } else if (nameMatch) {
      result.push({ ...item });
    }
  }

  return result;
}

export function searchTree(items, query) {
  if (!Array.isArray(items)) return [];
  if (typeof query !== 'string') return [];

  const q = query.trim().toLowerCase();
  if (!q) return items;

  return filterNodes(items, q);
}
