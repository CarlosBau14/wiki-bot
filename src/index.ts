import 'dotenv/config';
import { App } from '@slack/bolt';
import { searchNotion } from './notion.service';
import { generateAnswer } from './claude.service';

// Validar variables de entorno obligatorias
const required = [
  'NOTION_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'ANTHROPIC_API_KEY',
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Falta variable de entorno: ${key}`);
    process.exit(1);
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  port: Number(process.env.PORT) || 3000,
});

// ─────────────────────────────────────────────
// Mención al bot: @WikiBot ¿cuál es la política de vacaciones?
// ─────────────────────────────────────────────
app.event('app_mention', async ({ event, client, say }) => {
  // Limpiar la mención del bot del texto
  const query = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!query) {
    await say({
      text: '¡Hola! Mencióname con una pregunta y buscaré en el wiki de Notion. Ejemplo:\n`@WikiBot ¿Cuál es nuestra política de vacaciones?`',
      thread_ts: event.ts,
    });
    return;
  }

  // Reacción "pensando..." mientras procesamos
  await client.reactions
    .add({ channel: event.channel, timestamp: event.ts, name: 'thinking_face' })
    .catch(() => {});

  try {
    console.log(`\n[app_mention] Query: "${query}"`);

    const notionPages = await searchNotion(query);
    const answer = await generateAnswer(query, notionPages);

    // Responder en el mismo hilo
    const threadTs = 'thread_ts' in event ? event.thread_ts : event.ts;
    await say({
      text: answer,
      thread_ts: threadTs ?? event.ts,
    });
  } catch (error) {
    console.error('[app_mention] Error:', error);
    await say({
      text: '❌ Ocurrió un error al procesar tu consulta. Por favor intenta de nuevo.',
      thread_ts: event.ts,
    });
  } finally {
    await client.reactions
      .remove({ channel: event.channel, timestamp: event.ts, name: 'thinking_face' })
      .catch(() => {});
  }
});

// ─────────────────────────────────────────────
// Slash command: /wiki ¿cuál es la política de vacaciones?
// ─────────────────────────────────────────────
app.command('/wiki', async ({ command, ack, respond, client }) => {
  // Hay que hacer ack() en menos de 3 segundos
  await ack();

  const query = command.text.trim();

  if (!query) {
    await respond({
      response_type: 'ephemeral',
      text: '⚠️ Incluye una pregunta. Ejemplo:\n`/wiki ¿Cuál es nuestra política de vacaciones?`',
    });
    return;
  }

  try {
    console.log(`\n[/wiki] Query: "${query}" (usuario: ${command.user_name})`);

    const notionPages = await searchNotion(query);
    const answer = await generateAnswer(query, notionPages);

    // Publicar la respuesta en el canal (visible para todos)
    await client.chat.postMessage({
      channel: command.channel_id,
      text: `*<@${command.user_id}> preguntó:* ${query}\n\n${answer}`,
      mrkdwn: true,
    });
  } catch (error) {
    console.error('[/wiki] Error:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Ocurrió un error al procesar tu consulta. Por favor intenta de nuevo.',
    });
  }
});

// ─────────────────────────────────────────────
// Arrancar
// ─────────────────────────────────────────────
(async () => {
  await app.start();
  const port = process.env.PORT || 3000;
  console.log(`\n⚡ Wiki Bot iniciado en el puerto ${port}`);
  console.log(`   URL para Slack Events API: http://tu-dominio:${port}/slack/events`);
  console.log(`   Slash command configurado: /wiki`);
})();
