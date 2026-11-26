import { expect, test } from 'bun:test';
import { sanitizeRichText } from './rich-text';

test('rich text preserves Tiptap starter/table formatting and safe links', () => {
  const input = '<h2>Heading</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s></p><blockquote><p>Quoted</p></blockquote><ol start="2"><li><p>Second</p></li></ol><pre><code class="language-js">a &lt; b</code></pre><hr><table><tbody><tr><th colspan="2" rowspan="1" colwidth="100,100"><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table><p><a href="https://example.com" target="_blank">Link</a></p>';
  const result = sanitizeRichText(input);
  for (const element of ['<h2>Heading</h2>', '<strong>Bold</strong>', '<u>Underline</u>', '<table>', 'colwidth="100,100"', 'class="language-js"', 'href="https://example.com"', 'rel="noopener noreferrer"']) expect(result).toContain(element);
  expect(sanitizeRichText(result)).toBe(result);
});

test('rich text strips scripts, events, unsafe URLs and CSS without corrupting normal text', () => {
  const input = '<script>alert(1)</script><style>body{display:none}</style><p onclick="evil()" style="position:fixed">Keep text</p><img src=x onerror=evil()><svg onload=evil()><script>evil()</script></svg><a href="javascript:alert(1)" onclick="evil()">Bad link</a><a href="data:text/html,evil">Data</a><a href="//evil.example">Protocol</a><iframe src="https://evil.example"></iframe>';
  const result = sanitizeRichText(input);
  expect(result).toContain('<p>Keep text</p>');
  for (const forbidden of ['script', 'style=', 'onclick', 'onerror', 'onload', '<svg', '<img', '<iframe', 'javascript:', 'data:', 'href="//', 'alert(1)', 'evil()']) expect(result).not.toContain(forbidden);
  expect(sanitizeRichText('Normal text, punctuation and 123')).toBe('Normal text, punctuation and 123');
  expect(sanitizeRichText('A & B < 3 and > 1')).toBe('A &amp; B &lt; 3 and &gt; 1');
  expect(sanitizeRichText('<a href="mailto:help@example.com">Email</a>')).toContain('href="mailto:help@example.com"');
});
