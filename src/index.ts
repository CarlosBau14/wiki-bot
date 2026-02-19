import 'dotenv/config';
import { App, ExpressReceiver } from '@slack/bolt';
import express, { Request, Response, NextFunction, Router } from 'express';
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

// ─────────────────────────────────────────────
// Lee el body del stream y lo almacena como req.rawBody.
// Bolt comprueba req.rawBody antes de leer el stream, por lo que
// usará este buffer en lugar de intentar releer el stream consumido.
// ─────────────────────────────────────────────
function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────
// Router propio que se pasa a ExpressReceiver.
// Al registrarlo ANTES de que Bolt añada su middleware,
// este handler corre ANTES de la verificación de firma.
// ─────────────────────────────────────────────
const router = Router();

router.post(
  '/slack/events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = await readRawBody(req);
      // Guardamos el buffer para que Bolt lo use sin releer el stream
      (req as any).rawBody = rawBody;
      const body = JSON.parse(rawBody.toString());
      if (body.type === 'url_verification') {
        res.json({ challenge: body.challenge });
        return;
      }
    } catch {
      // Body no es JSON válido — Bolt lo rechazará con 400
    }
    next();
  }
);

// ─────────────────────────────────────────────
// Receiver de Bolt con nuestro router pre-configurado.
// Bolt añade su stack (firma + handlers) DESPUÉS de nuestros handlers.
// ─────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  router,
});

// ─────────────────────────────────────────────
// Handler en "/" para el challenge de Slack.
// Bolt no registra nada en "/", así que no hay conflictos.
// ─────────────────────────────────────────────
receiver.app.post('/', express.json(), (req: Request, res: Response) => {
  if (req.body?.type === 'url_verification') {
    res.json({ challenge: req.body.challenge });
    return;
  }
  res.status(200).send('OK');
});

// ─────────────────────────────────────────────
// App de Bolt
// ─────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// ─────────────────────────────────────────────
// Mención al bot: @WikiBot ¿cuál es la política de vacaciones?
// ─────────────────────────────────────────────
app.event('app_mention', async ({ event, client, say }) => {
  const query = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!query) {
    await say({
      text: '¡Hola! Mencióname con una pregunta y buscaré en el wiki de Notion. Ejemplo:\n`@WikiBot ¿Cuál es nuestra política de vacaciones?`',
      thread_ts: event.ts,
    });
    return;
  }

  await client.reactions
    .add({ channel: event.channel, timestamp: event.ts, name: 'thinking_face' })
    .catch(() => {});

  try {
    console.log(`\n[app_mention] Query: "${query}"`);

    const notionPages = await searchNotion(query);
    const answer = await generateAnswer(query, notionPages);

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
  await app.start(Number(process.env.PORT) || 3000);
  const port = process.env.PORT || 3000;
  console.log(`\n⚡ Wiki Bot iniciado en el puerto ${port}`);
  console.log(`   Endpoints del challenge: POST / y POST /slack/events`);
  console.log(`   Slash command configurado: /wiki`);
})();
