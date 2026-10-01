import { getTranslation } from '../utils/i18n.mjs';

const FOLDER_SEARCH_MIN_ENTRIES = 10;

function shouldShowFolderSearch(folderCount) {
  return folderCount > FOLDER_SEARCH_MIN_ENTRIES;
}

function getFolderDepth(folder) {
  return Math.max(0, ((folder.path || '').match(/\//g) || []).length - 1);
}

function describeFolder(folder) {
  return folder.accountName ? `${folder.accountName} › ${folder.name}` : folder.name;
}

function closeOpenFolderPickers(eventTarget) {
  document.querySelectorAll('.folder-picker[open]').forEach((picker) => {
    if (!picker.contains(eventTarget)) picker.removeAttribute('open');
  });
}

function createCaretIcon() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'folder-picker-caret');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '6');
  svg.setAttribute('viewBox', '0 0 10 6');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1 1L5 5L9 1');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(path);
  return svg;
}

function buildFolderPicker({ action, foldersByAccount, onSelect }) {
  const details = document.createElement('details');
  details.className = 'folder-picker';

  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.className = 'folder-picker-label';
  summary.appendChild(label);
  summary.appendChild(createCaretIcon());

  const body = document.createElement('div');
  body.className = 'folder-picker-body';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'folder-picker-search';
  searchInput.placeholder = getTranslation('searchPlaceholder');

  const totalFolders = Object.values(foldersByAccount).reduce((sum, f) => sum + f.length, 0);
  searchInput.classList.toggle('hidden', !shouldShowFolderSearch(totalFolders));

  const list = document.createElement('div');
  list.className = 'folder-picker-list';

  const empty = document.createElement('p');
  empty.className = 'folder-picker-empty hidden';
  empty.textContent = getTranslation('searchNoResults');

  body.append(searchInput, list, empty);
  details.append(summary, body);

  let selectedFolder = action.folder || null;
  let entries = null;
  let groups = [];

  function updateLabel() {
    label.classList.toggle('placeholder', !selectedFolder);
    label.textContent = selectedFolder
      ? describeFolder(selectedFolder)
      : getTranslation('optionsSelectFolderPlaceholder');
  }

  function select(entry) {
    selectedFolder = entry.folder;
    for (const e of entries) e.el.classList.toggle('selected', e.id === entry.id);
    updateLabel();
    details.removeAttribute('open');
    onSelect(entry.id);
  }

  function buildList() {
    entries = [];
    groups = [];
    const fragment = document.createDocumentFragment();

    for (const [accountName, folders] of Object.entries(foldersByAccount)) {
      const group = document.createElement('div');
      group.className = 'folder-picker-group';

      const heading = document.createElement('div');
      heading.className = 'folder-picker-group-label';
      heading.textContent = accountName;
      group.appendChild(heading);

      for (const folder of folders) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'folder-picker-option';
        el.textContent = folder.name;
        el.title = `${accountName}${folder.path}`;
        el.style.paddingLeft = `${8 + getFolderDepth(folder) * 12}px`;
        if (selectedFolder?.id === folder.id) el.classList.add('selected');

        const entry = {
          el,
          group,
          folder,
          id: folder.id,
          haystack: `${accountName} ${folder.path}`.toLowerCase()
        };
        el.addEventListener('click', () => select(entry));

        group.appendChild(el);
        entries.push(entry);
      }

      groups.push(group);
      fragment.appendChild(group);
    }

    list.replaceChildren(fragment);
  }

  function applyFilter(query) {
    if (!entries) return;
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const visibleGroups = new Set();
    let visibleCount = 0;

    for (const entry of entries) {
      const show = tokens.every((t) => entry.haystack.includes(t));
      entry.el.classList.toggle('hidden', !show);
      if (show) {
        visibleGroups.add(entry.group);
        visibleCount++;
      }
    }

    for (const group of groups) group.classList.toggle('hidden', !visibleGroups.has(group));
    empty.classList.toggle('hidden', visibleCount > 0);
  }

  details.addEventListener('toggle', () => {
    if (!details.open) return;
    if (!entries) buildList();
    searchInput.value = '';
    applyFilter('');
    if (!searchInput.classList.contains('hidden')) searchInput.focus();
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  });

  searchInput.addEventListener('input', (e) => applyFilter(e.target.value));

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = entries?.find((en) => !en.el.classList.contains('hidden'));
      if (first) select(first);
    }
  });

  details.addEventListener('keydown', (e) => {
    if (!details.open) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      details.removeAttribute('open');
      summary.focus();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const visibleEntries = entries?.filter((en) => !en.el.classList.contains('hidden')) || [];
      if (!visibleEntries.length) return;

      e.preventDefault();

      const currentIndex = visibleEntries.findIndex((en) => en.el === document.activeElement);

      let nextIndex;
      if (e.key === 'ArrowDown') {
        nextIndex =
          currentIndex >= 0 && currentIndex < visibleEntries.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : visibleEntries.length - 1;
      }

      visibleEntries[nextIndex].el.focus();
    }
  });

  updateLabel();
  return details;
}

export { buildFolderPicker, closeOpenFolderPickers };
