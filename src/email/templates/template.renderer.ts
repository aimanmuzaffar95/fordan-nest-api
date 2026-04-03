import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

const cache = new Map<string, HandlebarsTemplateDelegate>();

const TEMPLATES_DIR = path.join(__dirname);

const SAFE_NAME_RE = /^[a-z0-9_-]+$/i;

export function renderTemplate(
  name: string,
  context: Record<string, unknown>,
): string {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(`Invalid template name: "${name}"`);
  }

  let compiled = cache.get(name);

  if (!compiled) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.hbs`);
    const source = fs.readFileSync(filePath, 'utf8');
    compiled = Handlebars.compile(source);
    cache.set(name, compiled);
  }

  return compiled(context);
}

/** Strip HTML tags to produce a plain-text fallback. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
