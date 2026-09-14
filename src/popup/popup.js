import { localizeDocument, getTranslation } from '../utils/i18n.mjs';
import { getActionLabel } from '../utils/quickstep-actions.js';
import { notify } from '../utils/notifications.js';
import { getCachedElementById } from '../utils/dom-utils.js';
import { DEFAULT_SETTINGS } from '../utils/quickstep-settings.js';
import { searchTree } from '../utils/search-utils.js';

async function getCurrentMailTabId() {
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab?.id ?? null;
}

function showStatus(message, type = 'info') {
  notify({
    elm: getCachedElementById('status-bar'),
    message,
    type
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = getCachedElementById('confirm-overlay');
    const messageEl = getCachedElementById('confirm-message');
    const runBtn = getCachedElementById('confirm-run');
    const cancelBtn = getCachedElementById('confirm-cancel');

    messageEl.textContent = message;
    overlay.classList.remove('hidden');

    const controller = new AbortController();
    const { signal } = controller;

    const done = (result) => {
      overlay.classList.add('hidden');
      controller.abort();
      resolve(result);
    };

    runBtn.addEventListener('click', () => done(true), { signal });
    cancelBtn.addEventListener('click', () => done(false), { signal });
  });
}

function openOptions() {
  messenger.runtime.openOptionsPage();
  window.close();
}

async function executeStep(step, btn, autoClosePopup) {
  btn.disabled = true;
  btn.classList.add('executing');

  try {
    const tabId = await getCurrentMailTabId();
    if (tabId === null) {
      showStatus(getTranslation('statusNoMailTab'), 'error');
      return;
    }

    const result = await messenger.runtime.sendMessage({
      type: 'EXECUTE_QUICK_STEP',
      quickStepId: step.id,
      tabId
    });

    if (result.success) {
      const count = result.messageCount;
      const key = count === 1 ? 'statusAppliedSingle' : 'statusAppliedMultiple';
      showStatus(getTranslation(key, [step.name, count.toString()]), 'success');

      if (autoClosePopup) {
        window.close();
      }
    } else if (result.anySucceeded) {
      const count = result.messageCount;
      const errorDetail = result.errors?.length ? `: ${result.errors[0]}` : '.';

      showStatus(
        getTranslation('statusAppliedWithErrors', [step.name, count.toString(), errorDetail]),
        'warning'
      );
    } else if (result.errors?.length) {
      showStatus(getTranslation('statusError', [result.errors[0]]), 'error');
    } else {
      showStatus(getTranslation('statusActionFailed'), 'error');
    }
  } catch (e) {
    showStatus(getTranslation('statusError', [e.message]), 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('executing');
  }
}

async function handleStepClick(step, btn, autoClosePopup) {
  if (step.requireConfirmation) {
    const confirmed = await showConfirm(getTranslation('popupConfirmMessage', [step.name]));
    if (!confirmed) return;
  }

  await executeStep(step, btn, autoClosePopup);
}

function createStepButton(step, autoClosePopup) {
  const btn = document.createElement('button');
  btn.className = 'step-btn';
  btn.style.setProperty('--step-color', step.color || '#0078D4');

  const info = document.createElement('div');
  info.className = 'step-info';

  const name = document.createElement('span');
  name.className = 'step-name';
  name.textContent = step.name;

  const desc = document.createElement('span');
  desc.className = 'step-desc';
  desc.textContent = step.actions.map(getActionLabel).join(' → ');

  info.append(name, desc);
  btn.append(info);
  btn.title = `${step.name}\n${step.actions.map(getActionLabel).join(' → ')}`;

  btn.addEventListener('click', () => handleStepClick(step, btn, autoClosePopup));
  return btn;
}

function createFolderGroup(folder) {
  const details = document.createElement('details');
  details.className = 'folder-group';
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'folder-summary';

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow';
  arrow.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'folder-group-name';
  name.textContent = folder.name || getTranslation('optionsFolderDefaultName');

  summary.append(arrow, name);

  const childContainer = document.createElement('div');
  childContainer.className = 'folder-children';

  details.append(summary, childContainer);
  return details;
}

function renderTreeItems(items, container, autoClosePopup) {
  for (const item of items) {
    if (item.type === 'folder') {
      renderFolderItem(item, container, autoClosePopup);
    } else {
      container.appendChild(createStepButton(item, autoClosePopup));
    }
  }
}

function renderFolderItem(folder, container, autoClosePopup) {
  const children = folder.children || [];
  if (folder.isFlattened) {
    renderTreeItems(children, container, autoClosePopup);
    return;
  }

  const group = createFolderGroup(folder);
  const childContainer = group.querySelector('.folder-children');
  renderTreeItems(children, childContainer, autoClosePopup);

  if (childContainer.children.length > 0) {
    container.appendChild(group);
  }
}

function renderFilteredSteps(steps, query, autoClosePopup) {
  const container = getCachedElementById('steps-container');
  const emptyState = getCachedElementById('empty-state');
  const searchEmpty = getCachedElementById('search-empty');

  if (!steps || steps.length === 0) {
    container.classList.add('hidden');
    emptyState.classList.remove('hidden');
    searchEmpty.classList.add('hidden');
    return;
  }

  const items = query ? searchTree(steps, query) : steps;

  const fragment = document.createDocumentFragment();
  renderTreeItems(items, fragment, autoClosePopup);
  container.replaceChildren(fragment);

  const hasContent = container.children.length > 0;
  container.classList.toggle('hidden', !hasContent);
  emptyState.classList.toggle('hidden', hasContent || !!query);
  searchEmpty.classList.toggle('hidden', hasContent || !query);
}

async function getCurrentAccountId() {
  try {
    const [mailTab] = await messenger.mailTabs.query({ active: true, currentWindow: true });
    const accountId = mailTab?.displayedFolder?.accountId;
    if (accountId) return accountId;
  } catch {}

  try {
    const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });

    if (tab?.id) {
      const { messages } = await messenger.messageDisplay.getDisplayedMessages(tab.id);
      const accountId = messages?.[0]?.folder?.accountId;
      if (accountId) return accountId;
    }
  } catch {}

  return null;
}

async function fetchInitialData() {
  const [settingsResult, accountId] = await Promise.all([
    messenger.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => DEFAULT_SETTINGS),
    getCurrentAccountId()
  ]);

  const settings = { ...DEFAULT_SETTINGS, ...settingsResult };

  const steps = await messenger.runtime.sendMessage({
    type: 'GET_QUICK_STEPS',
    onlyEnabled: true,
    accountId
  });

  return { settings, steps };
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function initPopup() {
  getCachedElementById('btn-settings').addEventListener('click', openOptions);
  getCachedElementById('createFirstBtn').addEventListener('click', openOptions);

  const loading = getCachedElementById('loading');
  const searchBar = getCachedElementById('search-bar');
  const searchInput = getCachedElementById('search-input');

  loading.classList.remove('hidden');
  getCachedElementById('steps-container').classList.add('hidden');
  getCachedElementById('empty-state').classList.add('hidden');
  getCachedElementById('search-empty').classList.add('hidden');

  try {
    const { settings, steps } = await fetchInitialData();

    const showSearch = !!settings.showSearchBar;
    searchBar.classList.toggle('hidden', !showSearch);
    if (searchInput) searchInput.value = '';

    searchInput.addEventListener(
      'input',
      debounce((e) => {
        renderFilteredSteps(steps, e.target.value, settings.autoClosePopup);
      }, 150)
    );

    renderFilteredSteps(steps, '', settings.autoClosePopup);
  } catch (e) {
    showStatus(getTranslation('statusLoadError', [e.message]), 'error');
  } finally {
    loading.classList.add('hidden');
    localizeDocument();
  }
}

document.addEventListener('DOMContentLoaded', initPopup);
