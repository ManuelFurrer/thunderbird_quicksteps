function generateId() {
  return 'qs_' + crypto.randomUUID();
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function countStepsInTree(items) {
  let count = 0;

  for (const item of items || []) {
    if (item && typeof item === 'object') {
      if (item.type === 'folder') {
        count += countStepsInTree(item.children);
      } else {
        count++;
      }
    }
  }

  return count;
}

export { generateId, debounce, countStepsInTree };
