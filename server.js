import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const PORT = Number(process.env.PORT || 3000);
const WAHA_URL = String(process.env.WAHA_URL || 'http://waha.railway.internal:3000').replace(/\/$/, '');
const WAHA_API_KEY = String(process.env.WAHA_API_KEY || '').trim();
const WAHA_SESSION = String(process.env.WAHA_SESSION || 'default').trim();
const WHATSAPP_DESTINATION = onlyDigits(process.env.WHATSAPP_DESTINATION || '');
const ALLOWED_ORIGINS = String(
  process.env.ALLOWED_ORIGINS || 'https://barbaduck.com.br,https://www.barbaduck.com.br'
)
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);

const validOptions = Object.freeze({
  conhecimentoClube: new Set([
    'Sim, já conheço',
    'Já ouvi falar, mas ainda não entendo direito',
    'Não conheço'
  ]),
  frequencia: new Set([
    '1 vez por mês',
    '2 vezes por mês',
    '3 vezes por mês ou mais',
    'Varia bastante / depende do mês'
  ]),
  diasPreferencia: new Set([
    'Entre segunda e quarta',
    'Entre quinta e sábado',
    'Não tenho preferência'
  ]),
  tipoPlano: new Set(['Cabelo', 'Barba', 'Cabelo + barba']),
  relacaoBarbearia: new Set([
    'Já conheço a barbearia',
    'Seria minha primeira vez',
    'Já ouvi falar, mas ainda não fui'
  ])
});

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function cleanText(value, maxLength = 180) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeBrazilianPhone(value) {
  let digits = onlyDigits(value);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function maskPhone(value) {
  const digits = onlyDigits(value);
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
}

function validateEnvironment() {
  const missing = [];
  if (!WAHA_API_KEY) missing.push('WAHA_API_KEY');
  if (!WHATSAPP_DESTINATION) missing.push('WHATSAPP_DESTINATION');
  if (missing.length) {
    console.warn(`Variaveis ausentes: ${missing.join(', ')}`);
  }
}

function validatePayload(body) {
  const data = {
    tipo: cleanText(body?.tipo, 80),
    origem: cleanText(body?.origem, 100),
    nome: cleanText(body?.nome, 100),
    whatsapp: cleanText(body?.whatsapp, 30),
    conhecimentoClube: cleanText(body?.conhecimentoClube),
    frequencia: cleanText(body?.frequencia),
    diasPreferencia: cleanText(body?.diasPreferencia),
    tipoPlano: cleanText(body?.tipoPlano),
    relacaoBarbearia: cleanText(body?.relacaoBarbearia),
    consentimento: body?.consentimento === true,
    pagina: cleanText(body?.pagina, 300),
    enviadoEm: cleanText(body?.enviadoEm, 60),
    website: cleanText(body?.website, 100)
  };

  const errors = [];
  if (data.tipo && data.tipo !== 'solicitacao_plano_personalizado') {
    errors.push('Tipo de solicitação inválido.');
  }
  if (data.nome.length < 2) errors.push('Informe um nome válido.');

  const customerPhone = normalizeBrazilianPhone(data.whatsapp);
  if (!/^55\d{10,11}$/.test(customerPhone)) {
    errors.push('Informe um WhatsApp brasileiro válido com DDD.');
  }

  for (const [field, options] of Object.entries(validOptions)) {
    if (!options.has(data[field])) errors.push(`Resposta inválida no campo ${field}.`);
  }

  if (!data.consentimento) errors.push('É necessário autorizar o contato pelo WhatsApp.');

  return { data, customerPhone, errors };
}

function buildMessage(data, customerPhone, requestId) {
  return [
    '🦆 *NOVA SOLICITAÇÃO DE PLANO PERSONALIZADO*',
    '',
    `*Protocolo:* ${requestId}`,
    `*Nome:* ${data.nome}`,
    `*WhatsApp:* +${customerPhone}`,
    '',
    '*Respostas:*',
    `• Conhece o clube: ${data.conhecimentoClube}`,
    `• Frequência: ${data.frequencia}`,
    `• Dias preferidos: ${data.diasPreferencia}`,
    `• Procura plano para: ${data.tipoPlano}`,
    `• Relação com a Barba Duck: ${data.relacaoBarbearia}`,
    '',
    `*Origem:* ${data.origem || 'Landing Page Barba Duck'}`,
    `*Recebido em:* ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
  ].join('\n');
}

async function sendToWaha(text) {
  if (!WAHA_API_KEY || !WHATSAPP_DESTINATION) {
    throw new Error('API não configurada. Verifique as variáveis de ambiente.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${WAHA_URL}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': WAHA_API_KEY
      },
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: `${WHATSAPP_DESTINATION}@c.us`,
        text
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`WAHA respondeu HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    }

    try {
      return JSON.parse(responseText);
    } catch {
      return { raw: responseText };
    }
  } finally {
    clearTimeout(timeout);
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, '');
    if (ALLOWED_ORIGINS.includes(normalized)) return callback(null, true);
    return callback(new Error('Origem não autorizada pelo CORS.'));
  },
  methods: ['POST', 'OPTIONS', 'GET'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400
};

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '20kb', strict: true }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'barbaduck-plano-api',
    timestamp: new Date().toISOString()
  });
});

app.get('/health/waha', async (_req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${WAHA_URL}/ping`, { signal: controller.signal });
    res.status(response.ok ? 200 : 503).json({
      status: response.ok ? 'ok' : 'unavailable',
      wahaHttpStatus: response.status
    });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }
});

app.post('/api/plano-personalizado', formLimiter, async (req, res, next) => {
  try {
    // Honeypot: bots costumam preencher este campo invisível.
    if (cleanText(req.body?.website, 100)) {
      return res.status(200).json({ success: true });
    }

    const { data, customerPhone, errors } = validatePayload(req.body);
    if (errors.length) {
      return res.status(422).json({
        success: false,
        message: 'Revise os dados enviados.',
        errors
      });
    }

    const requestId = crypto.randomUUID().split('-')[0].toUpperCase();
    const message = buildMessage(data, customerPhone, requestId);
    await sendToWaha(message);

    console.info(
      JSON.stringify({
        event: 'personalized_plan_sent',
        requestId,
        customer: data.nome,
        phone: maskPhone(customerPhone),
        timestamp: new Date().toISOString()
      })
    );

    return res.status(201).json({
      success: true,
      message: 'Solicitação enviada com sucesso.',
      protocolo: requestId
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

app.use((error, _req, res, _next) => {
  const isCorsError = error?.message === 'Origem não autorizada pelo CORS.';
  console.error(error);
  res.status(isCorsError ? 403 : 502).json({
    success: false,
    message: isCorsError
      ? 'Origem não autorizada.'
      : 'Não foi possível encaminhar a solicitação ao WhatsApp.'
  });
});

validateEnvironment();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Barba Duck API ouvindo na porta ${PORT}.`);
});
