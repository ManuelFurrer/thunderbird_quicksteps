function clearDragClasses(el) {
  el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
}

function clearAllDragClasses() {
  document
    .querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-inside')
    .forEach(clearDragClasses);
}

function treeContainsId(items, id) {
  for (const item of items) {
    if (item.id === id) return true;
    if (item.type === 'folder' && treeContainsId(item.children || [], id)) return true;
  }
  return false;
}

function insertIntoTree(items, targetId, item, dropZone) {
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    if (current.id === targetId) {
      if (dropZone === 'before') items.splice(i, 0, item);
      else if (dropZone === 'after') items.splice(i + 1, 0, item);
      else if (dropZone === 'inside' && current.type === 'folder') {
        current.children = current.children || [];
        current.children.push(item);
      }
      return true;
    }
    if (current.type === 'folder') {
      if (insertIntoTree(current.children || [], targetId, item, dropZone)) return true;
    }
  }
  return false;
}

function getDropZone(e, element, isFolder, isExpanded = false) {
  const { top, height } = element.getBoundingClientRect();
  const relY = e.clientY - top;
  if (isFolder) {
    if (relY < height * 0.3) return 'before';
    if (!isExpanded && relY > height * 0.7) return 'after';
    return 'inside';
  }
  return relY < height / 2 ? 'before' : 'after';
}

function isIllegalDrop(draggedItem, targetId) {
  if (!draggedItem) return true;
  if (draggedItem.id === targetId) return true;
  if (draggedItem.type !== 'folder') return false;
  return treeContainsId(draggedItem.children || [], targetId);
}

export function createDragAndDropManager(dependencies) {
  const { getSteps, findItemInTree, removeFromTree, renderSidebar, persistSteps } = dependencies;

  let _draggedItem = null;

  const zoneClassMap = {
    before: 'drag-over-top',
    after: 'drag-over-bottom',
    inside: 'drag-over-inside'
  };

  function setupTreeDraggable(element, itemId, itemType, isExpanded = false) {
    element.draggable = true;

    element.addEventListener('dragstart', (e) => {
      _draggedItem = findItemInTree(getSteps(), itemId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-quicksteps-item', itemId);
      element.classList.add('dragging');
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isIllegalDrop(_draggedItem, element.dataset.id)) return;

      const isFolder = itemType === 'folder';
      const zone = getDropZone(e, element, isFolder, isExpanded);
      const targetClass = zoneClassMap[zone];

      if (!element.classList.contains(targetClass)) {
        clearDragClasses(element);
        element.classList.add(targetClass);
      }
    });

    element.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !element.contains(e.relatedTarget)) {
        clearDragClasses(element);
      }
    });

    element.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearDragClasses(element);

      const incomingId = e.dataTransfer.getData('application/x-quicksteps-item');
      if (!incomingId) return;

      const isFolder = itemType === 'folder';
      const zone = getDropZone(e, element, isFolder, isExpanded);

      if (zone === 'inside' && !isFolder) return;
      if (isIllegalDrop(_draggedItem, element.dataset.id)) return;

      const removed = removeFromTree(incomingId);
      if (!removed) return;

      insertIntoTree(getSteps(), element.dataset.id, removed, zone);
      renderSidebar();
      await persistSteps();
    });

    element.addEventListener('dragend', () => {
      _draggedItem = null;
      element.classList.remove('dragging');
      clearAllDragClasses();
    });
  }

  function setupFolderChildrenDropZone(childrenContainer, folderId) {
    childrenContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isIllegalDrop(_draggedItem, folderId)) return;

      if (!childrenContainer.classList.contains('drag-over-inside')) {
        childrenContainer.classList.add('drag-over-inside');
      }
    });

    childrenContainer.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !childrenContainer.contains(e.relatedTarget)) {
        childrenContainer.classList.remove('drag-over-inside');
      }
    });

    childrenContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      childrenContainer.classList.remove('drag-over-inside');

      const incomingId = e.dataTransfer.getData('application/x-quicksteps-item');
      if (!incomingId || isIllegalDrop(_draggedItem, folderId)) return;

      const removed = removeFromTree(incomingId);
      if (!removed) return;

      const steps = getSteps();
      const folderItem = findItemInTree(steps, folderId);

      if (folderItem?.type === 'folder') {
        folderItem.children = folderItem.children || [];
        folderItem.children.push(removed);
      } else {
        steps.push(removed);
      }

      renderSidebar();
      await persistSteps();
    });
  }

  return {
    setupTreeDraggable,
    setupFolderChildrenDropZone
  };
}

export function setupFlatListDraggable({
  element,
  dragHandle = null,
  dragType = 'text/plain',
  dragValue,
  onDrop
}) {
  if (dragHandle) {
    element.draggable = false;
    dragHandle.addEventListener('mousedown', () => {
      element.draggable = true;
      window.addEventListener(
        'mouseup',
        () => {
          if (!element.classList.contains('dragging')) {
            element.draggable = false;
          }
        },
        { once: true }
      );
    });
  } else {
    element.draggable = true;
  }

  element.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(dragType, String(dragValue));
    element.classList.add('dragging');
  });

  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (element.classList.contains('dragging')) return;

    const bounding = element.getBoundingClientRect();
    const dropBelow = e.clientY - bounding.top > bounding.height / 2;

    element.classList.toggle('drag-over-bottom', dropBelow);
    element.classList.toggle('drag-over-top', !dropBelow);
  });

  element.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !element.contains(e.relatedTarget)) {
      element.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  });

  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    element.classList.remove('drag-over-top', 'drag-over-bottom');

    const incomingData = e.dataTransfer.getData(dragType);
    if (!incomingData) return;

    const bounding = element.getBoundingClientRect();
    const dropBelow = e.clientY - bounding.top > bounding.height / 2;

    await onDrop(incomingData, dropBelow);
  });

  element.addEventListener('dragend', () => {
    if (dragHandle) element.draggable = false;
    element.classList.remove('dragging');

    clearAllDragClasses();
  });
}
