import { localizeDocument, getTranslation } from '../utils/i18n.mjs';
import { generateId } from '../utils/general-utils.js';
import { getActionLabel, ACTION_TYPES } from '../utils/quickstep-actions.js';
import { notify } from '../utils/notifications.js';
import { getCachedElementById } from '../utils/dom-utils.js';
import { DEFAULT_SETTINGS } from '../utils/quickstep-settings.js';
import { createDragAndDropManager, setupFlatListDraggable } from '../utils/drag-drop-utils.js';
import { searchTree } from '../utils/search-utils.js';

const DEFAULT_COLOR = '#0078D4';

function isStepBlank(step) {
  return !step.name.trim() && step.actions.length === 1 && step.actions[0].type === 'mark_read';
}

let state = {
  steps: [],
  collapsedFolders: new Set(),
  folders: [],
  foldersById: {},
  foldersByAccount: {},
  foldersLoaded: false,
  accounts: [],
  accountsLoaded: false,
  editing: null,
  editingId: null,
  isNew: false,
  viewingSettings: false,
  searchQuery: '',
  settings: { ...DEFAULT_SETTINGS }
};

const els = {
  stepsList: () => getCachedElementById('steps-list'),
  sidebarEmpty: () => getCachedElementById('sidebar-empty'),
  placeholder: () => getCachedElementById('editor-placeholder'),
  editor: () => getCachedElementById('editor'),
  folderEditor: () => getCachedElementById('folder-editor'),
  settingsView: () => getCachedElementById('settings-view'),
  editorFooter: () => getCachedElementById('editor-footer'),
  navSettingsBtn: () => getCachedElementById('btn-nav-settings'),
  stepName: () => getCachedElementById('step-name'),
  previewActions: () => getCachedElementById('editor-preview-actions'),
  actionsList: () => getCachedElementById('actions-list'),
  addActionBtn: () => getCachedElementById('btn-add-action'),
  folderEditorName: () => getCachedElementById('folder-editor-name'),
  folderDisplayCheckbox: () => getCachedElementById('folder-display-mode'),
  folderDisplayHint: () => getCachedElementById('folder-display-hint'),
  saveBtn: () => getCachedElementById('btn-save'),
  deleteStepBtn: () => getCachedElementById('btn-delete-step'),
  duplicateStepBtn: () => getCachedElementById('btn-duplicate-step'),
  newStepBtn: () => getCachedElementById('btn-new-step'),
  newFolderBtn: () => getCachedElementById('btn-new-folder'),
  confirmOverlay: () => getCachedElementById('confirm-overlay'),
  confirmMessage: () => getCachedElementById('confirm-message'),
  confirmOk: () => getCachedElementById('confirm-ok'),
  confirmCancel: () => getCachedElementById('confirm-cancel'),
  toast: () => getCachedElementById('toast'),
  colorSwatch: () => getCachedElementById('color-swatch'),
  requireConfirmationCheckbox: () => getCachedElementById('step-require-confirmation'),
  autoCloseCheckbox: () => getCachedElementById('setting-auto-close-popup'),
  exportStepsBtn: () => getCachedElementById('btn-export-steps'),
  importStepsBtn: () => getCachedElementById('btn-import-steps'),
  importFileInput: () => getCachedElementById('import-file-input'),
  importOverlay: () => getCachedElementById('import-overlay'),
  importMessage: () => getCachedElementById('import-message'),
  importCancel: () => getCachedElementById('import-cancel'),
  importMerge: () => getCachedElementById('import-merge'),
  importReplace: () => getCachedElementById('import-replace'),
  stepEnabledCheckbox: () => getCachedElementById('step-enabled'),
  sidebarSearchInput: () => getCachedElementById('sidebar-search-input'),
  showSearchBarCheckbox: () => getCachedElementById('setting-show-search-bar')
};

const dndManager = createDragAndDropManager({
  getSteps: () => state.steps,
  findItemInTree,
  removeFromTree,
  renderSidebar,
  persistSteps
});

function findItemInTree(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder') {
      const found = findItemInTree(item.children || [], id);
      if (found) return found;
    }
  }
  return null;
}

function findItemContext(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { array: items, index: i };
    if (items[i].type === 'folder') {
      const found = findItemContext(items[i].children || [], id);
      if (found) return found;
    }
  }
  return null;
}

function removeFromTree(id) {
  const ctx = findItemContext(state.steps, id);
  if (!ctx) return null;
  const [removed] = ctx.array.splice(ctx.index, 1);
  return removed;
}

function upsertItemInTree(item) {
  const clone = JSON.parse(JSON.stringify(item));
  const ctx = findItemContext(state.steps, item.id);

  if (ctx) {
    ctx.array[ctx.index] = clone;
  } else {
    state.steps.push(clone);
  }
}

function countStepsInTree(items) {
  let stepsCount = 0;
  for (const item of items) {
    if (!item.type || item.type === 'step') {
      stepsCount++;
    } else if (item.type === 'folder') {
      stepsCount += countStepsInTree(item.children || []);
    }
  }
  return stepsCount;
}

function assignNewIds(items) {
  return items.map((item) => {
    if (item.type === 'folder')
      return { ...item, id: generateId(), children: assignNewIds(item.children || []) };
    return { ...item, id: generateId() };
  });
}

function showToast(message, type = 'info') {
  notify({
    elm: els.toast(),
    message,
    type,
    duration: 3200
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    els.confirmMessage().textContent = message;
    els.confirmOverlay().classList.remove('hidden');

    function done(result) {
      els.confirmOverlay().classList.add('hidden');
      els.confirmOk().removeEventListener('click', onOk);
      els.confirmCancel().removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk = () => done(true);
    const onCancel = () => done(false);

    els.confirmOk().addEventListener('click', onOk);
    els.confirmCancel().addEventListener('click', onCancel);
  });
}

function showImportChoice(message) {
  if (!state.steps.length) return 'merge';

  return new Promise((resolve) => {
    els.importMessage().textContent = message;
    els.importOverlay().classList.remove('hidden');

    function done(result) {
      els.importOverlay().classList.add('hidden');
      els.importCancel().removeEventListener('click', onCancel);
      els.importMerge().removeEventListener('click', onMerge);
      els.importReplace().removeEventListener('click', onReplace);
      resolve(result);
    }
    const onCancel = () => done('cancel');
    const onMerge = () => done('merge');
    const onReplace = () => done('replace');

    els.importCancel().addEventListener('click', onCancel);
    els.importMerge().addEventListener('click', onMerge);
    els.importReplace().addEventListener('click', onReplace);
  });
}

async function ensureFoldersLoaded() {
  if (state.foldersLoaded) return;

  try {
    state.folders = await messenger.runtime.sendMessage({
      type: 'GET_ALL_FOLDERS'
    });

    state.foldersById = {};
    state.foldersByAccount = {};
    for (const folder of state.folders) {
      state.foldersById[folder.id] = folder;

      if (!state.foldersByAccount[folder.accountName])
        state.foldersByAccount[folder.accountName] = [];
      state.foldersByAccount[folder.accountName].push(folder);
    }

    state.foldersLoaded = true;
  } catch (e) {
    console.error('[QuickSteps] Could not load folders:', e);
    state.folders = [];
    state.foldersById = {};
    state.foldersByAccount = {};
  }
}

function buildFolderSelect(action) {
  const select = document.createElement('select');
  select.className = 'action-folder-select';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = getTranslation('optionsSelectFolderPlaceholder');
  select.appendChild(blank);

  for (const [accountName, folders] of Object.entries(state.foldersByAccount)) {
    const group = document.createElement('optgroup');
    group.label = accountName;
    for (const folder of folders) {
      const opt = document.createElement('option');
      opt.value = folder.id;

      const depth = (folder.path.match(/\//g) || []).length;
      opt.textContent = '\u00a0'.repeat(Math.max(0, depth - 1) * 2) + folder.name;

      if (action.folder && action.folder.id === folder.id) {
        opt.selected = true;
      }

      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  return select;
}

async function persistSteps() {
  await messenger.runtime.sendMessage({
    type: 'SAVE_QUICK_STEPS',
    steps: state.steps
  });
}

async function persistSettings() {
  try {
    await messenger.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: state.settings
    });
    showToast(getTranslation('optionsToastSettingsSaved'), 'success');
  } catch (err) {
    showToast(getTranslation('optionsToastSaveError', [err.message]), 'error');
  }
}

async function autoSave() {
  if (!state.editing) return;

  if (state.editing.type === 'folder') {
    upsertItemInTree(state.editing);

    try {
      await persistSteps();
    } catch (e) {
      console.error('[QuickSteps] Auto-save failed:', e);
    }
    return;
  }

  if (state.isNew && isStepBlank(state.editing)) {
    removeFromTree(state.editing.id);
    return;
  }

  if (!state.editing.name.trim()) state.editing.name = 'Untitled';

  upsertItemInTree(state.editing);

  try {
    await persistSteps();
  } catch (e) {
    console.error('[QuickSteps] Auto-save failed:', e);
  }
}

function spliceReorder(arr, sourceIndex, targetIndex, dropBelow) {
  const [item] = arr.splice(sourceIndex, 1);

  let insertAt = targetIndex;
  if (sourceIndex < targetIndex && !dropBelow) {
    insertAt -= 1;
  } else if (sourceIndex > targetIndex && dropBelow) {
    insertAt += 1;
  }

  arr.splice(insertAt, 0, item);
}

function createActionDragAndDropListeners(row, index, dragHandle) {
  setupFlatListDraggable({
    element: row,
    dragHandle: dragHandle,
    dragType: 'application/x-quicksteps-action',
    dragValue: index,
    onDrop: (draggedIndexRaw, dropBelow) => {
      const sourceIndex = parseInt(draggedIndexRaw, 10);
      if (isNaN(sourceIndex) || sourceIndex === index) return;

      spliceReorder(state.editing.actions, sourceIndex, index, dropBelow);
      renderActionsList();
      updatePreviewActions();
    }
  });
}

function renderSidebar() {
  const list = els.stepsList();
  list.innerHTML = '';

  const query = state.searchQuery.trim();
  const items = query ? searchTree(state.steps, query) : state.steps;

  if (!state.steps.length) {
    els.sidebarEmpty().classList.remove('hidden');
  } else {
    els.sidebarEmpty().classList.add('hidden');

    if (items.length) {
      renderSidebarItems(items, list, 0);
    } else {
      const msg = document.createElement('p');
      msg.className = 'sidebar-search-empty';
      msg.textContent = getTranslation('searchNoResults');
      list.appendChild(msg);
    }
  }

  els.navSettingsBtn().classList.toggle('active', state.viewingSettings);
}

function renderSidebarItems(items, container, depth) {
  for (const item of items) {
    container.appendChild(
      item.type === 'folder'
        ? createFolderSidebarItem(item, depth)
        : createStepSidebarItem(item, depth)
    );
  }
}

function createStepSidebarItem(step, depth) {
  const item = document.createElement('div');
  item.className =
    'step-item' +
    (!state.viewingSettings && state.editingId === step.id ? ' active' : '') +
    (step.enabled === false ? ' step-item-disabled' : '');

  item.dataset.id = step.id;
  item.dataset.type = 'step';

  if (depth > 0) item.style.paddingLeft = `${10 + depth * 16}px`;

  const info = document.createElement('div');
  info.className = 'step-item-info';

  const name = document.createElement('div');
  name.className = 'step-item-name';
  name.style.color = step.color || DEFAULT_COLOR;
  name.textContent = step.name || getTranslation('optionsPlaceholderTitle');

  const meta = document.createElement('div');
  meta.className = 'step-item-meta';
  meta.textContent = step.actions.length
    ? step.actions.map(getActionLabel).join(' → ')
    : getTranslation('optionsNoActionsAssigned');

  info.append(name, meta);
  item.append(info);
  item.addEventListener('click', () => navigateTo(step.id));
  dndManager.setupTreeDraggable(item, step.id, 'step');
  return item;
}

function createFolderSidebarItem(folder, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-wrapper';

  const header = document.createElement('div');
  header.className =
    'step-item folder-item' +
    (!state.viewingSettings && state.editingId === folder.id ? ' active' : '');
  header.dataset.id = folder.id;
  header.dataset.type = 'folder';
  if (depth > 0) header.style.paddingLeft = `${10 + depth * 16}px`;

  const iconEl = document.createElement('span');
  iconEl.className = 'folder-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.appendChild(getIconTemplate('icon-folder'));

  const info = document.createElement('div');
  info.className = 'step-item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'step-item-name';
  nameEl.textContent = folder.name || getTranslation('optionsFolderDefaultName');

  const meta = document.createElement('div');
  meta.className = 'step-item-meta';
  meta.textContent = folder.isFlattened
    ? getTranslation('optionsFolderDisplayFlat')
    : getTranslation('optionsFolderDisplayGroup');

  info.append(nameEl, meta);

  const isCollapsed = state.collapsedFolders.has(folder.id);
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'folder-btn collapse-btn' + (isCollapsed ? ' collapsed' : '');
  collapseBtn.title = getTranslation(isCollapsed ? 'optionsFolderExpand' : 'optionsFolderCollapse');
  collapseBtn.appendChild(getIconTemplate('icon-collapse'));

  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.collapsedFolders.has(folder.id)) state.collapsedFolders.delete(folder.id);
    else state.collapsedFolders.add(folder.id);
    renderSidebar();
  });

  header.append(iconEl, info, collapseBtn);
  header.addEventListener('click', () => navigateTo(folder.id));
  dndManager.setupTreeDraggable(header, folder.id, 'folder', !isCollapsed);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'folder-children-sidebar';
  if (!isCollapsed) {
    renderSidebarItems(folder.children || [], childrenContainer, depth + 1);
    childrenContainer.appendChild(createFolderAddRow(folder.id, depth + 1));
  }
  dndManager.setupFolderChildrenDropZone(childrenContainer, folder.id);

  wrapper.append(header, childrenContainer);
  return wrapper;
}

function createFolderAddRow(folderId, depth) {
  const row = document.createElement('div');
  row.className = 'folder-add-row';
  row.style.paddingLeft = `${10 + depth * 16}px`;

  const addStepBtn = document.createElement('button');
  addStepBtn.className = 'folder-add-btn';
  addStepBtn.textContent = getTranslation('optionsFolderAddStep');
  addStepBtn.addEventListener('click', () => startNewStep(folderId));

  const addFolderBtn = document.createElement('button');
  addFolderBtn.className = 'folder-add-btn';
  addFolderBtn.textContent = getTranslation('optionsFolderAddFolder');
  addFolderBtn.addEventListener('click', () => startNewFolder(folderId));

  row.append(addStepBtn, addFolderBtn);
  return row;
}

function renderEditor() {
  const isStep = !state.viewingSettings && state.editing?.type === 'step';
  const isFolder = !state.viewingSettings && state.editing?.type === 'folder';
  const showPlaceholder = !state.viewingSettings && !state.editing;
  const showSettings = state.viewingSettings;

  els.placeholder().classList.toggle('hidden', !showPlaceholder);
  els.editor().classList.toggle('hidden', !isStep);
  els.folderEditor().classList.toggle('hidden', !isFolder);
  els.settingsView().classList.toggle('hidden', !showSettings);
  els.editorFooter().classList.toggle('hidden', showSettings);

  els.saveBtn().disabled = !isStep && !isFolder;
  els.deleteStepBtn().classList.toggle('hidden', !isStep && !isFolder);
  els.duplicateStepBtn().classList.toggle('hidden', !isStep && !isFolder);

  if (isStep) {
    els.stepName().value = state.editing.name || '';
    updatePreviewActions();
    renderActionsList();
    renderAccountFilter();
    els.colorSwatch().style.backgroundColor = state.editing.color || DEFAULT_COLOR;
    els.requireConfirmationCheckbox().checked = !!state.editing.requireConfirmation;
    els.stepEnabledCheckbox().checked = state.editing.enabled !== false;
  }

  if (isFolder) renderFolderEditor();
  if (showSettings) renderSettingsView();
}

function renderFolderEditor() {
  if (!state.editing || state.editing.type !== 'folder') return;
  els.folderEditorName().value = state.editing.name || '';
  els.folderDisplayCheckbox().checked = state.editing.isFlattened === true;
  updateFolderDisplayHint();
}

function updateFolderDisplayHint() {
  const hint = els.folderDisplayHint();
  if (!hint || !state.editing) return;
  hint.textContent = state.editing.isFlattened
    ? getTranslation('optionsFolderFlatHint')
    : getTranslation('optionsFolderGroupHint');
}

function renderSettingsView() {
  els.autoCloseCheckbox().checked = !!state.settings.autoClosePopup;
  els.showSearchBarCheckbox().checked = !!state.settings.showSearchBar;
}

async function ensureAccountsLoaded() {
  if (state.accountsLoaded) return;
  try {
    state.accounts = await messenger.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
    state.accountsLoaded = true;
  } catch (e) {
    console.error(e);
    state.accounts = [];
  }
}

function updateAccountSelectorLabel() {
  const labelEl = getCachedElementById('account-selector-label');
  const list = getCachedElementById('account-filter-list');
  if (!labelEl || !list) return;

  labelEl.className = 'account-selector-label';

  const checkboxes = [...list.querySelectorAll('input[type=checkbox]')];
  const checked = checkboxes.filter((cb) => cb.checked);
  const total = checkboxes.length;

  let text;
  if (checked.length === total) {
    text = getTranslation('optionsAccountsAll');
    labelEl.classList.add('all');
  } else if (checked.length === 1 || checked.length === 2) {
    text = checked.map((cb) => cb.dataset.name).join(', ');
  } else {
    text = getTranslation('optionsAccountsCount', [checked.length, total]);
  }

  labelEl.textContent = text;
}

async function renderAccountFilter() {
  if (!state.accountsLoaded) await ensureAccountsLoaded();

  const group = getCachedElementById('account-filter-group');

  if (state.accounts.length < 2) {
    group.classList.add('hidden');
    return;
  }

  group.classList.remove('hidden');

  const list = getCachedElementById('account-filter-list');
  list.innerHTML = '';

  const currentAccountIds = state.editing?.accountIds;
  const hasSelectedAccounts = currentAccountIds?.length > 0;

  const fragment = document.createDocumentFragment();

  for (const account of state.accounts) {
    const label = document.createElement('label');
    label.className = 'checkbox-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = account.id;
    input.dataset.name = account.name;
    input.checked = !hasSelectedAccounts || currentAccountIds.includes(account.id);

    input.addEventListener('change', (e) => {
      if (!state.editing) return;

      const checkedIds = [...list.querySelectorAll('input[type=checkbox]:checked')].map(
        (cb) => cb.value
      );

      // Always keep at least one account checked
      if (checkedIds.length === 0) {
        e.target.checked = true;
        return;
      }

      state.editing.accountIds = checkedIds.length === state.accounts.length ? null : checkedIds;

      updateAccountSelectorLabel();
    });

    const span = document.createElement('span');
    span.textContent = account.name;
    label.append(input, span);
    fragment.appendChild(label);
  }

  list.appendChild(fragment);
  updateAccountSelectorLabel();
}

function updatePreviewActions() {
  if (!state.editing) return;
  els.previewActions().textContent = state.editing.actions.length
    ? state.editing.actions.map(getActionLabel).join(' → ')
    : getTranslation('optionsNoActionsYet');
}

async function renderActionsList() {
  const list = els.actionsList();
  list.innerHTML = '';

  const needsFolders = state.editing.actions.some((a) => a.type === 'move' || a.type === 'copy');
  if (needsFolders && !state.foldersLoaded) await ensureFoldersLoaded();

  state.editing.actions.forEach((action, i) => {
    list.appendChild(buildActionRow(i, action));
  });
}

function createActionButtons(index) {
  const btns = document.createElement('div');
  btns.className = 'action-btns';

  const upBtn = document.createElement('button');
  upBtn.className = 'action-btn';
  upBtn.title = getTranslation('optionsMoveUpTitle');
  upBtn.textContent = '↑';
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', () => moveAction(index, -1));

  const downBtn = document.createElement('button');
  downBtn.className = 'action-btn';
  downBtn.title = getTranslation('optionsMoveDownTitle');
  downBtn.textContent = '↓';
  downBtn.disabled = index === state.editing.actions.length - 1;
  downBtn.addEventListener('click', () => moveAction(index, 1));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'action-btn remove';
  removeBtn.title = getTranslation('optionsRemoveTitle');
  removeBtn.textContent = 'X';
  removeBtn.addEventListener('click', () => removeAction(index));

  btns.append(upBtn, downBtn, removeBtn);
  return btns;
}

function attachFolderListener(select, actionIndex) {
  select.addEventListener('change', () => {
    if (select.value) {
      const folder = state.foldersById[select.value];
      if (folder) state.editing.actions[actionIndex].folder = folder;
    } else {
      delete state.editing.actions[actionIndex].folder;
    }
    updatePreviewActions();
  });
}

function refreshFolderPicker(folderContainer, action, actionIndex) {
  folderContainer.innerHTML = '';
  const needsFolder = ACTION_TYPES.find((at) => at.value === action.type)?.needsFolder;
  if (!needsFolder) return;

  if (!state.foldersLoaded) {
    const loading = document.createElement('span');
    loading.className = 'action-folder-loading';
    loading.textContent = getTranslation('optionsFoldersLoading');
    folderContainer.appendChild(loading);
    ensureFoldersLoaded().then(() => {
      folderContainer.innerHTML = '';
      const select = buildFolderSelect(action);
      attachFolderListener(select, actionIndex);
      folderContainer.appendChild(select);
    });
  } else {
    const select = buildFolderSelect(action);
    attachFolderListener(select, actionIndex);
    folderContainer.appendChild(select);
  }
}

function getIconTemplate(id) {
  const template = document.getElementById(id);
  const fragment = template.content.cloneNode(true);
  return fragment.firstElementChild;
}

function buildActionRow(index, action) {
  const row = document.createElement('div');
  row.className = 'action-row';

  const num = document.createElement('span');
  num.className = 'action-num';
  num.textContent = index + 1;

  const typeSelect = document.createElement('select');
  typeSelect.className = 'action-type-select';
  for (const at of ACTION_TYPES) {
    const opt = document.createElement('option');
    opt.value = at.value;
    opt.textContent = getTranslation(at.i18nKey);
    if (at.value === action.type) opt.selected = true;
    typeSelect.appendChild(opt);
  }

  const folderContainer = document.createElement('div');
  folderContainer.style.flex = '1';
  folderContainer.style.minWidth = '0';

  refreshFolderPicker(folderContainer, action, index);

  typeSelect.addEventListener('change', () => {
    state.editing.actions[index].type = typeSelect.value;
    if (!ACTION_TYPES.find((at) => at.value === typeSelect.value)?.needsFolder) {
      delete state.editing.actions[index].folder;
    }
    refreshFolderPicker(folderContainer, state.editing.actions[index], index);
    updatePreviewActions();
  });

  const btns = createActionButtons(index);
  const dragHandle = getIconTemplate('drag-handle-icon');

  row.append(dragHandle, num, typeSelect, folderContainer, btns);
  createActionDragAndDropListeners(row, index, dragHandle);
  return row;
}

function addAction() {
  state.editing.actions.push({ type: 'mark_read' });
  renderActionsList();
  updatePreviewActions();
  els.actionsList().lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeAction(index) {
  state.editing.actions.splice(index, 1);
  renderActionsList();
  updatePreviewActions();
}

function moveAction(index, direction) {
  const actions = state.editing.actions;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= actions.length) return;
  [actions[index], actions[newIndex]] = [actions[newIndex], actions[index]];
  renderActionsList();
  updatePreviewActions();
}

function syncSidebarItem() {
  if (!state.editing) return;
  const item = document.querySelector(`.step-item[data-id="${state.editing.id}"]`);
  if (!item) return;
  const nameEl = item.querySelector('.step-item-name');
  const metaEl = item.querySelector('.step-item-meta');

  if (state.editing.type === 'folder') {
    if (nameEl) {
      nameEl.textContent = state.editing.name || getTranslation('optionsFolderDefaultName');
    }

    if (metaEl) {
      metaEl.textContent = state.editing.isFlattened
        ? getTranslation('optionsFolderDisplayFlat')
        : getTranslation('optionsFolderDisplayGroup');
    }

    return;
  }

  if (nameEl) {
    nameEl.textContent = state.editing.name || getTranslation('optionsPlaceholderTitle');
    nameEl.style.color = state.editing.color || DEFAULT_COLOR;
  }
  if (metaEl)
    metaEl.textContent =
      state.editing.actions.map(getActionLabel).join(' → ') ||
      getTranslation('optionsNoActionsAssigned');

  item.classList.toggle('step-item-disabled', state.editing.enabled === false);
}

async function navigateTo(id) {
  if (!state.viewingSettings && state.editingId === id) return;
  await autoSave();
  state.viewingSettings = false;

  const item = findItemInTree(state.steps, id);
  if (!item) return;

  state.editingId = id;
  state.editing = JSON.parse(JSON.stringify(item));
  state.isNew = false;
  renderEditor();
  renderSidebar();
}

function scrollToItem(id) {
  document
    .querySelector(`.step-item[data-id="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function startNewStep(parentId = null) {
  autoSave().then(() => {
    const newStep = {
      id: generateId(),
      type: 'step',
      name: '',
      color: DEFAULT_COLOR,
      requireConfirmation: false,
      enabled: true,
      accountIds: null,
      actions: [{ type: 'mark_read' }]
    };

    if (parentId) {
      const folder = findItemInTree(state.steps, parentId);
      if (folder?.type === 'folder') {
        folder.children = folder.children || [];
        folder.children.push(newStep);
        state.collapsedFolders.delete(parentId);
      } else {
        state.steps.push(newStep);
      }
    } else {
      state.steps.push(newStep);
    }

    state.editingId = newStep.id;
    state.editing = JSON.parse(JSON.stringify(newStep));
    state.isNew = true;
    state.viewingSettings = false;
    renderSidebar();
    renderEditor();
    setTimeout(() => {
      els.stepName().focus();
      scrollToItem(newStep.id);
    }, 50);
  });
}

async function startNewFolder(parentId = null) {
  await autoSave();

  const newFolder = {
    id: generateId(),
    type: 'folder',
    name: '',
    isFlattened: false,
    children: []
  };

  if (parentId) {
    const folder = findItemInTree(state.steps, parentId);
    if (folder?.type === 'folder') {
      folder.children = folder.children || [];
      folder.children.push(newFolder);
      state.collapsedFolders.delete(parentId);
    } else {
      state.steps.push(newFolder);
    }
  } else {
    state.steps.push(newFolder);
  }

  state.editingId = newFolder.id;
  state.editing = JSON.parse(JSON.stringify(newFolder));
  state.isNew = false;
  state.viewingSettings = false;

  await persistSteps();
  renderSidebar();
  renderEditor();
  setTimeout(() => {
    els.folderEditorName().focus();
    scrollToItem(newFolder.id);
  }, 50);
}

async function goToSettings() {
  if (state.viewingSettings) return;
  await autoSave();
  state.editing = null;
  state.editingId = null;
  state.isNew = false;
  state.viewingSettings = true;
  renderSidebar();
  renderEditor();
}

async function saveCurrentStep() {
  if (!state.editing) return;

  if (state.editing.type === 'folder') {
    upsertItemInTree(state.editing);

    try {
      await persistSteps();
      renderSidebar();
      showToast(getTranslation('optionsToastSaved'), 'success');
    } catch (e) {
      showToast(getTranslation('optionsToastSaveError', [e.message]), 'error');
    }
    return;
  }

  if (!state.editing.name.trim()) {
    els.stepName().focus();
    els.stepName().style.borderBottomColor = '#d32f2f';
    setTimeout(() => (els.stepName().style.borderBottomColor = ''), 2000);
    showToast(getTranslation('optionsToastNameRequired'), 'error');
    return;
  }

  for (const action of state.editing.actions) {
    if ((action.type === 'move' || action.type === 'copy') && !action.folder) {
      showToast(getTranslation('optionsToastFolderRequired'), 'error');
      return;
    }
  }

  upsertItemInTree(state.editing);

  state.isNew = false;

  try {
    await persistSteps();
    renderSidebar();
    showToast(getTranslation('optionsToastSaved'), 'success');
  } catch (e) {
    showToast(getTranslation('optionsToastSaveError', [e.message]), 'error');
  }
}

async function deleteCurrentStep() {
  const name = state.editing?.name || 'Quick Step';
  const confirmed = await showConfirm(getTranslation('optionsConfirmDeleteMessage', [name]));
  if (!confirmed) return;
  removeFromTree(state.editingId);
  state.editing = null;
  state.editingId = null;
  state.isNew = false;

  try {
    await persistSteps();
    renderSidebar();
    renderEditor();
    showToast(getTranslation('optionsToastDeleted'), 'info');
  } catch (e) {
    showToast(getTranslation('optionsToastDeleteError', [e.message]), 'error');
  }
}

async function deleteFolderById(folderId) {
  const folder = findItemInTree(state.steps, folderId);
  if (!folder) return;

  if ((folder.children || []).length > 0) {
    const stepCount = countStepsInTree(folder.children);
    const confirmed = await showConfirm(
      getTranslation('optionsConfirmDeleteFolderMessage', [
        folder.name || getTranslation('optionsFolderDefaultName'),
        stepCount
      ])
    );
    if (!confirmed) return;
  }

  if (state.editingId === folderId) {
    state.editing = null;
    state.editingId = null;
  }

  const ctx = findItemContext(state.steps, folderId);
  if (!ctx) return;
  ctx.array.splice(ctx.index, 1, ...(folder.children || []));

  await persistSteps();
  renderSidebar();
  renderEditor();
}

async function duplicateCurrentStep() {
  if (!state.editing) return;
  state.isNew = false;
  await autoSave();

  const source = JSON.parse(JSON.stringify(state.editing));
  const isFolder = state.editing.type === 'folder';

  let duplicate;
  if (isFolder) {
    [duplicate] = assignNewIds([
      {
        ...source,
        name: getTranslation('optionsDuplicateCopyName', [source.name])
      }
    ]);
  } else {
    duplicate = {
      ...source,
      type: 'step',
      id: generateId(),
      name: getTranslation('optionsDuplicateCopyName', [source.name])
    };
  }

  const ctx = findItemContext(state.steps, state.editing.id);
  if (ctx) ctx.array.splice(ctx.index + 1, 0, duplicate);
  else state.steps.push(duplicate);

  state.editingId = duplicate.id;
  state.editing = JSON.parse(JSON.stringify(duplicate));

  try {
    await persistSteps();
    renderSidebar();
    renderEditor();
    showToast(
      getTranslation(isFolder ? 'optionsToastDuplicatedFolder' : 'optionsToastDuplicatedStep'),
      'success'
    );
    setTimeout(() => scrollToItem(duplicate.id), 50);
  } catch (e) {
    showToast(getTranslation('optionsToastSaveError', [e.message]), 'error');
  }
}

function exportSteps() {
  const dataStr = JSON.stringify(state.steps, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quicksteps-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast(getTranslation('optionsToastExported'), 'success');
}

function normalizeTreeItems(list) {
  const validActionTypes = new Set(ACTION_TYPES.map((a) => a.value));
  const result = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;

    if (raw.type === 'folder') {
      result.push({
        type: 'folder',
        name: typeof raw.name === 'string' ? raw.name : '',
        isFlattened: raw.isFlattened === true,
        children: normalizeTreeItems(raw.children || [])
      });
      continue;
    }

    if (!Array.isArray(raw.actions)) continue;
    const actions = raw.actions
      .filter((a) => a && validActionTypes.has(a.type))
      .map((a) => {
        const action = { type: a.type };
        if (
          (a.type === 'move' || a.type === 'copy') &&
          a.folder &&
          typeof a.folder === 'object' &&
          a.folder.id
        ) {
          action.folder = {
            id: a.folder.id,
            name: a.folder.name || '',
            path: a.folder.path || '',
            accountId: a.folder.accountId,
            accountName: a.folder.accountName || ''
          };
        }
        return action;
      });

    if (!actions.length) continue;

    result.push({
      type: 'step',
      name: typeof raw.name === 'string' ? raw.name : '',
      color: typeof raw.color === 'string' ? raw.color : DEFAULT_COLOR,
      requireConfirmation: raw.requireConfirmation === true,
      enabled: raw.enabled !== false,
      accountIds:
        Array.isArray(raw.accountIds) && raw.accountIds.length > 0 ? raw.accountIds : null,
      actions
    });
  }
  return result;
}

function normalizeImportedSteps(parsed) {
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.steps) ? parsed.steps : null;
  if (!list) return null;
  return normalizeTreeItems(list);
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    showToast(getTranslation('optionsToastImportInvalid'), 'error');
    return;
  }
  const importedItems = normalizeImportedSteps(parsed);
  if (!importedItems) {
    showToast(getTranslation('optionsToastImportInvalid'), 'error');
    return;
  }

  const stepCount = countStepsInTree(importedItems);
  const hasFolders = importedItems.some((i) => i.type === 'folder');
  if (stepCount === 0 && !hasFolders) {
    showToast(getTranslation('optionsToastImportEmpty'), 'info');
    return;
  }

  const choice = await showImportChoice(getTranslation('optionsImportChoiceMessage', [stepCount]));
  if (choice === 'cancel') return;

  const freshItems = assignNewIds(importedItems);
  state.steps = choice === 'replace' ? freshItems : [...state.steps, ...freshItems];

  try {
    await persistSteps();
    renderSidebar();
    showToast(getTranslation('optionsToastImported', [stepCount]), 'success');
  } catch (err) {
    showToast(getTranslation('optionsToastSaveError', [err.message]), 'error');
  }
}

async function init() {
  try {
    state.steps = await messenger.runtime.sendMessage({
      type: 'GET_QUICK_STEPS'
    });
  } catch (e) {
    showToast(getTranslation('optionsToastLoadError', [e.message]), 'error');
    state.steps = [];
  }

  try {
    state.settings = await messenger.runtime.sendMessage({
      type: 'GET_SETTINGS'
    });
  } catch (e) {
    console.error('[QuickSteps] Could not load settings:', e);
    state.settings = { ...DEFAULT_SETTINGS };
  }

  ensureFoldersLoaded();
  ensureAccountsLoaded();

  renderSidebar();
  renderEditor();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      autoSave();
    }
  });

  document.addEventListener('click', (event) => {
    const accountSelect = getCachedElementById('account-selector');

    // close account select dropdown on outside click
    if (
      accountSelect &&
      accountSelect.hasAttribute('open') &&
      !accountSelect.contains(event.target)
    ) {
      accountSelect.removeAttribute('open');
    }
  });

  els.newStepBtn().addEventListener('click', () => startNewStep());
  els.newFolderBtn().addEventListener('click', () => startNewFolder());

  els.saveBtn().addEventListener('click', saveCurrentStep);
  els.deleteStepBtn().addEventListener('click', () => {
    if (!state.editing) return;
    if (state.editing.type === 'folder') {
      deleteFolderById(state.editing.id);
    } else {
      deleteCurrentStep();
    }
  });
  els.duplicateStepBtn().addEventListener('click', duplicateCurrentStep);
  els.addActionBtn().addEventListener('click', addAction);
  els.navSettingsBtn().addEventListener('click', goToSettings);

  els.exportStepsBtn().addEventListener('click', exportSteps);
  els.importStepsBtn().addEventListener('click', () => els.importFileInput().click());
  els.importFileInput().addEventListener('change', handleImportFile);

  els.autoCloseCheckbox().addEventListener('change', async (e) => {
    state.settings.autoClosePopup = e.target.checked;
    await persistSettings();
  });

  els.requireConfirmationCheckbox().addEventListener('change', (e) => {
    if (!state.editing || state.editing.type !== 'step') return;
    state.editing.requireConfirmation = e.target.checked;
  });

  els.stepName().addEventListener('input', (e) => {
    if (!state.editing || state.editing.type !== 'step') return;
    state.editing.name = e.target.value;
    updatePreviewActions();
    syncSidebarItem();
  });

  els.stepEnabledCheckbox().addEventListener('change', (e) => {
    if (!state.editing || state.editing.type !== 'step') return;
    state.editing.enabled = e.target.checked;
    syncSidebarItem();
  });

  const colorInput = getCachedElementById('step-color');
  const colorSwatch = els.colorSwatch();

  colorSwatch.style.backgroundColor = DEFAULT_COLOR;

  colorInput.addEventListener('input', (event) => {
    if (!state.editing || state.editing.type !== 'step') return;
    const selectedColor = event.target.value;
    colorSwatch.style.backgroundColor = selectedColor;

    state.editing.color = selectedColor;
    syncSidebarItem();
  });

  els.folderEditorName().addEventListener('input', (e) => {
    if (!state.editing || state.editing.type !== 'folder') return;
    state.editing.name = e.target.value;
    syncSidebarItem();
  });

  els.folderDisplayCheckbox().addEventListener('change', (e) => {
    if (!state.editing || state.editing.type !== 'folder') return;
    state.editing.isFlattened = e.target.checked;
    updateFolderDisplayHint();
    syncSidebarItem();
  });

  els.sidebarSearchInput().addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderSidebar();
  });

  els.showSearchBarCheckbox().addEventListener('change', async (e) => {
    state.settings.showSearchBar = e.target.checked;
    await persistSettings();
  });

  localizeDocument();
}

document.addEventListener('DOMContentLoaded', init);
