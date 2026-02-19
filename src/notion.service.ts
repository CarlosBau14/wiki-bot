import { Client, isFullPage } from '@notionhq/client';
import type {
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  content: string;
}

function extractRichText(richText: RichTextItemResponse[]): string {
  return richText.map((rt) => rt.plain_text).join('');
}

function extractPageTitle(page: PageObjectResponse): string {
  const titleProp = Object.values(page.properties).find(
    (prop) => prop.type === 'title'
  );
  if (titleProp && titleProp.type === 'title') {
    return extractRichText(titleProp.title);
  }
  return 'Sin título';
}

async function extractBlockContent(
  blockId: string,
  depth = 0
): Promise<string> {
  // Limitar recursión para evitar páginas muy profundas
  if (depth > 3) return '';

  const response = await notion.blocks.children.list({
    block_id: blockId,
    page_size: 50,
  });

  const lines: string[] = [];

  for (const block of response.results) {
    if (!('type' in block)) continue;
    const b = block as BlockObjectResponse;

    let text = '';

    switch (b.type) {
      case 'paragraph':
        text = extractRichText(b.paragraph.rich_text);
        break;
      case 'heading_1':
        text = `# ${extractRichText(b.heading_1.rich_text)}`;
        break;
      case 'heading_2':
        text = `## ${extractRichText(b.heading_2.rich_text)}`;
        break;
      case 'heading_3':
        text = `### ${extractRichText(b.heading_3.rich_text)}`;
        break;
      case 'bulleted_list_item':
        text = `• ${extractRichText(b.bulleted_list_item.rich_text)}`;
        break;
      case 'numbered_list_item':
        text = `${extractRichText(b.numbered_list_item.rich_text)}`;
        break;
      case 'to_do':
        const done = b.to_do.checked ? '✓' : '○';
        text = `${done} ${extractRichText(b.to_do.rich_text)}`;
        break;
      case 'toggle':
        text = extractRichText(b.toggle.rich_text);
        break;
      case 'quote':
        text = `> ${extractRichText(b.quote.rich_text)}`;
        break;
      case 'callout':
        text = `📌 ${extractRichText(b.callout.rich_text)}`;
        break;
      case 'code':
        text = `\`\`\`${b.code.language}\n${extractRichText(b.code.rich_text)}\n\`\`\``;
        break;
      case 'table_row':
        text = b.table_row.cells
          .map((cell) => extractRichText(cell))
          .join(' | ');
        break;
      case 'divider':
        text = '---';
        break;
    }

    if (text.trim()) lines.push(text);

    // Extraer contenido de bloques hijo (toggles, columnas, etc.)
    if (b.has_children && depth < 2) {
      const childContent = await extractBlockContent(b.id, depth + 1);
      if (childContent) lines.push(childContent);
    }
  }

  return lines.filter(Boolean).join('\n');
}

// Normaliza un ID de Notion eliminando guiones para comparación
function normalizeId(id: string): string {
  return id.replace(/-/g, '');
}

export async function searchNotion(query: string): Promise<NotionPage[]> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  console.log(`[Notion] Buscando: "${query}"${databaseId ? ` (database: ${databaseId})` : ''}`);

  // Pedimos más resultados para compensar el filtrado posterior por database
  const response = await notion.search({
    query,
    filter: { property: 'object', value: 'page' },
    page_size: 20,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });

  // Filtrar solo páginas que pertenezcan al database configurado
  const filtered = databaseId
    ? response.results.filter((result) => {
        if (!isFullPage(result)) return false;
        const parent = result.parent;
        return (
          parent.type === 'database_id' &&
          normalizeId(parent.database_id) === normalizeId(databaseId)
        );
      })
    : response.results;

  console.log(
    `[Notion] Resultados: ${response.results.length} totales, ${filtered.length} en el database`
  );

  const pages: NotionPage[] = [];

  for (const result of filtered.slice(0, 5)) {
    if (!isFullPage(result)) continue;

    try {
      const title = extractPageTitle(result);
      const content = await extractBlockContent(result.id);

      if (content.trim()) {
        pages.push({
          id: result.id,
          title,
          url: result.url,
          // Limitar contenido por página para no saturar el contexto de Claude
          content: content.slice(0, 3000),
        });
        console.log(`[Notion] Página añadida: "${title}" (${content.length} chars)`);
      }
    } catch (err) {
      console.error(`[Notion] Error procesando página ${result.id}:`, err);
    }
  }

  return pages;
}
