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

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function firstGrapheme(text) {
  const [first] = segmenter.segment(text);
  return first?.segment ?? '';
}

function normalizeStepIcon(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return firstGrapheme(trimmed) || null;
}

export { STEP_ICON_PRESETS, normalizeStepIcon };
