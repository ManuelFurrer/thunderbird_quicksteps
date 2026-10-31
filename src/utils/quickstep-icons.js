const STEP_ICON_PRESETS = Object.freeze([
  '📥',
  '✉️',
  '👁️',
  '👥',
  '🔄',
  '↩️',
  '↪️',
  '📁',
  '🗂️',
  '📝',
  '📄',
  '📌',
  '📎',
  '🏷️',
  '⭐',
  '🚩',
  '✅',
  '✔️',
  '🔒',
  '➕',
  '🔍',
  '🖨️',
  '🔔',
  '🔕',
  '⏰',
  '📅',
  '🗑️',
  '❌',
  '🚫',
  '⚠️'
]);

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function firstGrapheme(text) {
  if (segmenter) {
    for (const { segment } of segmenter.segment(text)) {
      return segment;
    }

    return '';
  }

  return Array.from(text)[0] ?? '';
}

function normalizeStepIcon(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return firstGrapheme(trimmed) || null;
}

export { STEP_ICON_PRESETS, normalizeStepIcon };
