import Anthropic from '@anthropic-ai/sdk';
import type { NotionPage } from './notion.service';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un asistente interno de empresa. Tu función es responder preguntas del equipo usando únicamente la información del wiki de Notion que se te proporcionará como contexto.

Reglas:
- Responde SIEMPRE en español
- Basa tus respuestas EXCLUSIVAMENTE en el contexto de Notion proporcionado
- Si el contexto no tiene suficiente información, dilo claramente en lugar de inventar
- Sé conciso y directo, pero completo
- Usa formato Markdown: negritas, listas, etc. cuando mejore la legibilidad
- Al final de cada respuesta, incluye las fuentes con este formato exacto:
  📚 *Fuente(s):* <URL_1|Nombre_Página_1>, <URL_2|Nombre_Página_2>
  (usa formato de enlace de Slack: <url|texto>)
- Si hay varias páginas relevantes, menciona cuál sección responde qué parte`;

export async function generateAnswer(
  query: string,
  notionPages: NotionPage[]
): Promise<string> {
  if (notionPages.length === 0) {
    return (
      '❌ No encontré información relevante en el wiki de Notion para tu pregunta.\n\n' +
      'Intenta reformularla, usa términos más específicos, o revisa directamente en Notion.'
    );
  }

  const contextText = notionPages
    .map(
      (page, i) =>
        `[PÁGINA ${i + 1}: "${page.title}"]\nURL: ${page.url}\n\n${page.content}`
    )
    .join('\n\n---\n\n');

  const userMessage =
    `Contexto del wiki de Notion:\n\n${contextText}\n\n` +
    `---\n\n` +
    `Pregunta: ${query}`;

  console.log(`[Claude] Generando respuesta con ${notionPages.length} páginas de contexto`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock && textBlock.type === 'text'
    ? textBlock.text
    : '⚠️ No se pudo generar una respuesta. Intenta de nuevo.';
}
