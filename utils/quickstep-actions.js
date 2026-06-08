import { getTranslation } from "../utils/i18n.mjs";

const ACTION_TYPES = [
  {
    value: "mark_read",
    i18nKey: "optionsActionTypeMarkReadLabel",
    needsFolder: false,
  },
  {
    value: "mark_unread",
    i18nKey: "optionsActionTypeMarkUnreadLabel",
    needsFolder: false,
  },
  {
    value: "flag",
    i18nKey: "optionsActionTypeFlagLabel",
    needsFolder: false,
  },
  {
    value: "unflag",
    i18nKey: "optionsActionTypeUnflagLabel",
    needsFolder: false,
  },
  {
    value: "archive",
    i18nKey: "optionsActionTypeArchiveLabel",
    needsFolder: false,
  },
  {
    value: "delete",
    i18nKey: "optionsActionTypeDeleteLabel",
    needsFolder: false,
  },
  {
    value: "delete_permanent",
    i18nKey: "optionsActionTypeDeletePermanentLabel",
    needsFolder: false,
  },
  {
    value: "move",
    i18nKey: "optionsActionTypeMoveLabel",
    needsFolder: true,
  },
  {
    value: "copy",
    i18nKey: "optionsActionTypeCopyLabel",
    needsFolder: true,
  },
];

const ACTION_LABELS = {
  mark_read: () => getTranslation("actionMarkRead"),
  mark_unread: () => getTranslation("actionMarkUnread"),
  flag: () => getTranslation("actionFlag"),
  unflag: () => getTranslation("actionUnflag"),
  archive: () => getTranslation("actionArchive"),
  delete: () => getTranslation("actionDeleteTrash"),
  delete_permanent: () => getTranslation("actionDeletePermanent"),
  move: (a) => getTranslation("actionMoveLabel", a.folder?.name || "?"),
  copy: (a) => getTranslation("actionCopyLabel", a.folder?.name || "?"),
};

function getActionLabel(action) {
  const fn = ACTION_LABELS[action.type];
  return fn ? fn(action) : action.type;
}

export { getActionLabel, ACTION_TYPES, ACTION_LABELS };
