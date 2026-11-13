import { generateId } from './utils/general-utils.js';
import { DEFAULT_SETTINGS } from './utils/quickstep-settings.js';

const CURRENT_SCHEMA = 1;

const MESSAGE_UPDATES = Object.freeze({
  mark_read: { read: true },
  mark_unread: { read: false },
  flag: { flagged: true },
  unflag: { flagged: false },
  mark_junk: { junk: true },
  mark_not_junk: { junk: false }
});

function getDefaultQuickSteps() {
  return [
    {
      id: generateId(),
      type: 'step',
      name: messenger.i18n.getMessage('defaultStep1Name'),
      color: '#4CAF50',
      requireConfirmation: false,
      enabled: true,
      actions: [{ type: 'mark_read' }, { type: 'archive' }]
    },
    {
      id: generateId(),
      type: 'step',
      name: messenger.i18n.getMessage('defaultStep2Name'),
      color: '#f44336',
      requireConfirmation: true,
      enabled: true,
      actions: [{ type: 'delete' }]
    },
    {
      id: generateId(),
      type: 'step',
      name: messenger.i18n.getMessage('defaultStep3Name'),
      color: '#FF9800',
      requireConfirmation: false,
      enabled: true,
      actions: [{ type: 'flag' }, { type: 'mark_unread' }]
    }
  ];
}

function migrateTree(items) {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    if (item.type === 'folder') {
      return [{ ...item, children: migrateTree(item.children) }];
    }

    return [{ type: 'step', ...item }];
  });
}

function filterTree(items, onlyEnabled, accountId) {
  const result = [];
  for (const item of items) {
    if (item.type === 'folder') {
      const filteredChildren = filterTree(item.children || [], onlyEnabled, accountId);
      if (filteredChildren.length > 0 || !onlyEnabled) {
        result.push({ ...item, children: filteredChildren });
      }
    } else {
      const enabledOk = !onlyEnabled || item.enabled !== false; // Uses !== false to include legacy items that lack the 'enabled' property.
      const accountOk =
        !accountId ||
        !item.accountIds ||
        item.accountIds.length === 0 ||
        item.accountIds.includes(accountId);
      if (enabledOk && accountOk) result.push(item);
    }
  }
  return result;
}

function findStepInTree(items, id) {
  for (const item of items) {
    if (item.type === 'step' && item.id === id) return item;
    if (item.type === 'folder') {
      const found = findStepInTree(item.children || [], id);
      if (found) return found;
    }
  }
  return null;
}

async function getQuickSteps(onlyEnabled = false, accountId = null) {
  let { quicksteps, schemaVersion } = await messenger.storage.local.get([
    'quicksteps',
    'schemaVersion'
  ]);

  if (quicksteps === undefined) {
    quicksteps = getDefaultQuickSteps();
    await saveQuickSteps(quicksteps);
  } else if (!schemaVersion) {
    quicksteps = migrateTree(quicksteps);
    await saveQuickSteps(quicksteps);
  }

  if (!quicksteps?.length) {
    return [];
  }

  if (!onlyEnabled && !accountId) return quicksteps;
  return filterTree(quicksteps, onlyEnabled, accountId);
}

async function saveQuickSteps(steps) {
  await messenger.storage.local.set({ quicksteps: steps, schemaVersion: CURRENT_SCHEMA });
  return { success: true };
}

async function getSettings() {
  const result = await messenger.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

async function saveSettings(settings) {
  await messenger.storage.local.set({ settings });
  return { success: true };
}

function flattenFolders(folders, accountId, accountName, result = []) {
  if (!folders) return result;

  for (const folder of folders) {
    // Exclude special folders like [Gmail] which are not actual mail folders
    if (folder.name !== '[Gmail]') {
      result.push({
        accountId,
        accountName,
        path: folder.path,
        name: folder.name,
        id: folder.id
      });
    }

    if (folder.subFolders && folder.subFolders.length > 0) {
      flattenFolders(folder.subFolders, accountId, accountName, result);
    }
  }

  return result;
}

async function getAccounts() {
  try {
    const accounts = await messenger.accounts.list();
    return accounts.map((a) => ({ id: a.id, name: a.name }));
  } catch (e) {
    console.error('[QuickSteps] Error getting accounts:', e);
    return [];
  }
}

async function getAllFolders() {
  try {
    const accounts = await messenger.accounts.list(true);

    const allFolders = [];

    for (const account of accounts) {
      const accountFolders = flattenFolders(
        account.rootFolder?.subFolders || [],
        account.id,
        account.name
      );

      allFolders.push(...accountFolders);
    }

    return allFolders;
  } catch (e) {
    console.error('[QuickSteps] Error getting folders:', e);
    return [];
  }
}

function getTargetFolderId(action) {
  if (!action.folder) {
    throw new Error(messenger.i18n.getMessage('errorNoFolderSpecified'));
  }

  return action.folder.id;
}

async function runAction(action, messageIds) {
  if (Object.hasOwn(MESSAGE_UPDATES, action.type)) {
    const props = MESSAGE_UPDATES[action.type];

    await Promise.all(messageIds.map((id) => messenger.messages.update(id, props)));
    return;
  }

  switch (action.type) {
    case 'move':
      return messenger.messages.move(messageIds, getTargetFolderId(action));
    case 'copy':
      return messenger.messages.copy(messageIds, getTargetFolderId(action));
    case 'delete':
      return messenger.messages.delete(messageIds);
    case 'delete_permanent':
      return messenger.messages.delete(messageIds, { deletePermanently: true });
    case 'archive':
      return messenger.messages.archive(messageIds);
    default:
      throw new Error(messenger.i18n.getMessage('errorUnknownActionType'));
  }
}

async function executeActions(messages, actions) {
  const messageIds = messages.map((m) => m.id);
  const results = [];

  for (const action of actions) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await runAction(action, messageIds);
      results.push({ action: action.type, success: true });
    } catch (e) {
      results.push({ action: action.type, success: false, error: e.message });
      break;
    }
  }
  return results;
}

async function executeQuickStep(quickStepId, tabId) {
  const steps = await getQuickSteps();
  const step = findStepInTree(steps, quickStepId);

  if (!step) {
    return {
      success: false,
      errors: [messenger.i18n.getMessage('errorQuickStepNotFound')]
    };
  }

  if (!step.actions?.length) {
    return {
      success: false,
      errors: [messenger.i18n.getMessage('errorNoActionsAssigned')]
    };
  }

  let messages = [];

  if (tabId !== null) {
    const displayed = await messenger.messageDisplay.getDisplayedMessages(tabId).catch(() => ({}));
    messages = displayed.messages || [];

    if (messages.length === 0) {
      const selected = await messenger.mailTabs.getSelectedMessages(tabId).catch(() => ({}));
      messages = selected.messages || [];
    }
  }

  if (messages.length === 0) {
    return {
      success: false,
      errors: [messenger.i18n.getMessage('errorNoMessageSelected')]
    };
  }

  const results = await executeActions(messages, step.actions);
  const allSucceeded = results.every((r) => r.success);
  const anySucceeded = allSucceeded || results.some((r) => r.success);
  const errors = !allSucceeded ? results.filter((r) => !r.success).map((r) => r.error) : [];

  return {
    success: allSucceeded,
    anySucceeded,
    results,
    errors,
    messageCount: messages.length
  };
}

messenger.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'GET_QUICK_STEPS':
      return getQuickSteps(message.onlyEnabled, message.accountId);
    case 'SAVE_QUICK_STEPS':
      return saveQuickSteps(message.steps);
    case 'EXECUTE_QUICK_STEP':
      return executeQuickStep(message.quickStepId, message.tabId);
    case 'GET_ALL_FOLDERS':
      return getAllFolders();
    case 'GET_ACCOUNTS':
      return getAccounts();
    case 'GET_SETTINGS':
      return getSettings();
    case 'SAVE_SETTINGS':
      return saveSettings(message.settings);
  }
});
