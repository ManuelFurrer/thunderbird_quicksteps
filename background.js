import { generateId } from "./utils/general-utils.js";
import { DEFAULT_SETTINGS } from "./utils/quickstep-settings.js";

function getDefaultQuickSteps() {
  return [
    {
      id: generateId(),
      name: messenger.i18n.getMessage("defaultStep1Name"),
      color: "#4CAF50",
      actions: [{ type: "mark_read" }, { type: "archive" }],
    },
    {
      id: generateId(),
      name: messenger.i18n.getMessage("defaultStep2Name"),
      color: "#f44336",
      actions: [{ type: "delete" }],
    },
    {
      id: generateId(),
      name: messenger.i18n.getMessage("defaultStep3Name"),
      color: "#FF9800",
      actions: [{ type: "flag" }, { type: "mark_unread" }],
    },
  ];
}

async function getQuickSteps() {
  const result = await messenger.storage.local.get("quicksteps");
  if (result.quicksteps === undefined) {
    const defaults = getDefaultQuickSteps();
    await messenger.storage.local.set({ quicksteps: defaults });
    return defaults;
  }
  return result.quicksteps || [];
}

async function saveQuickSteps(steps) {
  await messenger.storage.local.set({ quicksteps: steps });
  return { success: true };
}

async function getSettings() {
  const result = await messenger.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function saveSettings(settings) {
  await messenger.storage.local.set({ settings });
  return { success: true };
}

function flattenFolders(folders, accountId, accountName, result = []) {
  if (!folders) return result;

  for (const folder of folders) {
    // Exclude special folders like [Gmail] which are not actual mail folders
    if (folder.name !== "[Gmail]") {
      result.push({
        accountId,
        accountName,
        path: folder.path,
        name: folder.name,
        id: folder.id,
      });
    }

    if (folder.subFolders && folder.subFolders.length > 0) {
      flattenFolders(folder.subFolders, accountId, accountName, result);
    }
  }

  return result;
}

async function getAllFolders() {
  try {
    const accounts = await messenger.accounts.list(true);

    const allFolders = [];

    for (const account of accounts) {
      const accountFolders = flattenFolders(
        account.rootFolder?.subFolders || [],
        account.id,
        account.name,
      );

      allFolders.push(...accountFolders);
    }

    return allFolders;
  } catch (e) {
    console.error("[QuickSteps] Error getting folders:", e);
    return [];
  }
}

async function executeActions(messages, actions) {
  const results = [];

  for (const action of actions) {
    const messageIds = messages.map((m) => m.id);

    try {
      switch (action.type) {
        case "move":
          if (!action.folder) {
            throw new Error(
              messenger.i18n.getMessage("errorNoFolderSpecified"),
            );
          }
          await messenger.messages.move(messageIds, action.folder.id);
          break;

        case "copy":
          if (!action.folder) {
            throw new Error(
              messenger.i18n.getMessage("errorNoFolderSpecified"),
            );
          }
          await messenger.messages.copy(messageIds, action.folder.id);
          break;

        case "delete":
          await messenger.messages.delete(messageIds);
          break;

        case "delete_permanent":
          await messenger.messages.delete(messageIds, {
            deletePermanently: true,
          });
          break;

        case "archive":
          await messenger.messages.archive(messageIds);
          break;

        case "mark_read":
          await Promise.all(
            messageIds.map((id) =>
              messenger.messages.update(id, { read: true }),
            ),
          );
          break;

        case "mark_unread":
          await Promise.all(
            messageIds.map((id) =>
              messenger.messages.update(id, { read: false }),
            ),
          );
          break;

        case "flag":
          await Promise.all(
            messageIds.map((id) =>
              messenger.messages.update(id, { flagged: true }),
            ),
          );
          break;

        case "unflag":
          await Promise.all(
            messageIds.map((id) =>
              messenger.messages.update(id, { flagged: false }),
            ),
          );
          break;

        default:
          throw new Error(messenger.i18n.getMessage("errorUnknownActionType"));
      }

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
  const step = steps.find((s) => s.id === quickStepId);

  if (!step)
    return {
      success: false,
      errors: [messenger.i18n.getMessage("errorQuickStepNotFound")],
    };

  if (!step.actions?.length)
    return {
      success: false,
      errors: [messenger.i18n.getMessage("errorNoActionsAssigned")],
    };

  const messages =
    (await messenger.messageDisplay.getDisplayedMessages(tabId)).messages || [];

  if (messages.length === 0) {
    return {
      success: false,
      errors: [messenger.i18n.getMessage("errorNoMessageSelected")],
    };
  }

  const results = await executeActions(messages, step.actions);
  const allSucceeded = results.every((r) => r.success);
  const anySucceeded = allSucceeded || results.some((r) => r.success);
  const errors = !allSucceeded
    ? results.filter((r) => !r.success).map((r) => r.error)
    : [];

  return {
    success: allSucceeded,
    anySucceeded,
    results,
    errors,
    messageCount: messages.length,
  };
}

messenger.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "GET_QUICK_STEPS":
      return getQuickSteps();
    case "SAVE_QUICK_STEPS":
      return saveQuickSteps(message.steps);
    case "EXECUTE_QUICK_STEP":
      return executeQuickStep(message.quickStepId, message.tabId);
    case "GET_ALL_FOLDERS":
      return getAllFolders();
    case "GET_SETTINGS":
      return getSettings();
    case "SAVE_SETTINGS":
      return saveSettings(message.settings);
  }
});
