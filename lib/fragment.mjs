/**
 * The fragment contract for `openmaic_render`.
 *
 * A teaching card is an inline HTML fragment, not a document. These checks run on
 * the Host so a malformed card fails with a sentence the model can act on, instead
 * of reaching the browser and painting an empty box.
 */

/** Tool name, shared by the Host registration and the browser card's toolview. */
export const RENDER_TOOL_NAME = 'openmaic_render';

/** Size ceiling for one fragment; a teaching card should stay far below it. */
export const MAX_FRAGMENT_BYTES = 256 * 1024;

const DOCUMENT_MARKERS = [
  [/<!doctype/i, '<!doctype>'],
  [/<html[\s>]/i, '<html>'],
  [/<head[\s>]/i, '<head>'],
  [/<body[\s>]/i, '<body>'],
];

/**
 * Validate one fragment.
 *
 * @param fragment - the markup the model passed.
 * @param maxBytes - size ceiling.
 * @returns a human-readable problem, or `null` when the fragment is acceptable.
 */
export function validateFragment(fragment, maxBytes = MAX_FRAGMENT_BYTES) {
  if (typeof fragment !== 'string' || fragment.trim() === '') {
    return 'fragment is empty. Pass the card markup as an inline HTML fragment.';
  }

  const size = Buffer.byteLength(fragment, 'utf8');
  if (size > maxBytes) {
    return `fragment is ${size} bytes, over the ${maxBytes}-byte ceiling. Split it into two cards.`;
  }

  // A whole document is the most common mistake: the model copies a standalone
  // page. The card supplies its own skeleton, so a pasted one nests a document
  // inside a document and the browser drops the inner shell.
  const found = DOCUMENT_MARKERS.filter(([pattern]) => pattern.test(fragment)).map(([, label]) => label);
  if (found.length > 0) {
    return (
      `fragment contains document scaffolding (${found.join(', ')}). ` +
      'Pass only the inner markup: the card provides doctype, html, head and body.'
    );
  }

  return null;
}
