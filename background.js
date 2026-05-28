function generateId() {
  return "qs_" + crypto.randomUUID();
}

function getDefaultQuickSteps() {
  return [
    {
      id: generateId(),
      name: "Archive & Mark Read",
      color: "#4CAF50",
      actions: [{ type: "mark_read" }, { type: "archive" }],
    },
    {
      id: generateId(),
      name: "Delete",
      color: "#f44336",
      actions: [{ type: "delete" }],
    },
    {
      id: generateId(),
      name: "Flag & Keep Unread",
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

function flattenFolders(folders, accountId, accountName) {
  const result = [];
  for (const folder of folders || []) {
    result.push({
      accountId,
      accountName,
      path: folder.path,
      name: folder.name,
      type: folder.type || "",
    });
    if (folder.subFolders && folder.subFolders.length > 0) {
      result.push(
        ...flattenFolders(
          folder.subFolders,
          accountId,
          accountName,
          folder.path,
        ),
      );
    }
  }
  return result;
}

async function getAllFolders() {
  try {
    const accounts = await messenger.accounts.list();
    const allFolders = [];
    for (const account of accounts) {
      const accountFolders = flattenFolders(
        account.folders || [],
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
          if (!action.folder)
            throw new Error("No destination folder specified");
          await messenger.messages.move(messageIds, {
            accountId: action.folder.accountId,
            path: action.folder.path,
          });
          break;

        case "copy":
          if (!action.folder)
            throw new Error("No destination folder specified");
          await messenger.messages.copy(messageIds, {
            accountId: action.folder.accountId,
            path: action.folder.path,
          });
          break;

        case "delete":
          await messenger.messages.delete(messageIds, false);
          break;

        case "delete_permanent":
          await messenger.messages.delete(messageIds, true);
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
          throw new Error("Unkown action type");
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

  if (!step) return { success: false, errors: ["Quick step not found"] };

  if (!step.actions?.length)
    return { success: false, errors: ["No quick steps assigned"] };

  const messages =
    (await messenger.messageDisplay.getDisplayedMessages(tabId)) || [];

  if (messages.length === 0) {
    return {
      success: false,
      errors: [
        "No message selected or displayed. Open or select a message first.",
      ],
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

messenger.runtime.onMessage.addListener(async (message) => {
  try {
    switch (message.type) {
      case "GET_QUICK_STEPS":
        return await getQuickSteps();
      case "SAVE_QUICK_STEPS":
        return await saveQuickSteps(message.steps);
      case "EXECUTE_QUICK_STEP":
        return await executeQuickStep(message.quickStepId, message.tabId);
      case "GET_ALL_FOLDERS":
        return await getAllFolders();
      default:
        return { error: "Unknown message type: " + message.type };
    }
  } catch (e) {
    console.error("[QuickSteps] Background error:", e);
    return { error: e.message };
  }
});
