import sanitizeHtml from 'sanitize-html';

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ul', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'a', 'span'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], ol: ['start'], th: ['colspan', 'rowspan', 'colwidth'], td: ['colspan', 'rowspan', 'colwidth'], col: ['span'], code: ['class'] },
    allowedClasses: { code: ['language-*'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({ tagName, attribs: { ...attributes, rel: 'noopener noreferrer' } }),
    },
  });
}
