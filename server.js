import express from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERAPDF_BIN = process.env.VERAPDF_BIN || 'verapdf';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 50 * 1024 * 1024);
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || os.tmpdir();
const SIGNATURE_VALIDATOR_URL = process.env.SIGNATURE_VALIDATOR_URL || '';
const SIGNATURE_VALIDATOR_TIMEOUT = Number(process.env.SIGNATURE_VALIDATOR_TIMEOUT || 90000);

app.disable('x-powered-by');
app.use(express.static(path.join(process.cwd(), 'public')));

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      const dir = await mkdtemp(path.join(UPLOAD_ROOT, 'pdfa-'));
      cb(null, dir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (_req, file, cb) => {
    const safeName = (file.originalname || 'documento.pdf')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    cb(null, `${Date.now()}-${safeName || 'documento.pdf'}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return cb(null, true);
    cb(new Error('Envie arquivo PDF para validação PDF/A.'));
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'verificador-decreto-10278',
    pdfa: 'veraPDF backend',
    signatureValidator: SIGNATURE_VALIDATOR_URL ? 'configured' : 'not_configured'
  });
});

app.post('/api/validate-pdfa', upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded?.path) {
    return res.status(400).json({ error: 'Arquivo PDF não recebido.' });
  }

  const tempDir = uploaded.destination;

  try {
    const fileStat = await stat(uploaded.path);
    const sha256 = await hashFile(uploaded.path);
    const xml = await runVeraPdf(uploaded.path);
    const parsed = parseVeraPdfXml(xml);

    return res.json({
      engine: 'veraPDF',
      executedAt: new Date().toISOString(),
      fileName: uploaded.originalname,
      fileSize: fileStat.size,
      sha256,
      ...parsed
    });
  } catch (error) {
    const message = normalizeErrorMessage(error);
    return res.status(422).json({
      error: message,
      engine: 'veraPDF',
      executed: false
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
});


app.post('/api/validate-signature', upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded?.path) {
    return res.status(400).json({ error: 'Arquivo PDF não recebido.' });
  }

  const tempDir = uploaded.destination;

  try {
    if (!SIGNATURE_VALIDATOR_URL) {
      return res.status(503).json({
        available: false,
        executed: false,
        error: 'SIGNATURE_VALIDATOR_URL não configurada no backend principal.'
      });
    }

    const fileBuffer = await readFile(uploaded.path);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: uploaded.mimetype || 'application/pdf' });
    formData.append('file', blob, uploaded.originalname || 'documento.pdf');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNATURE_VALIDATOR_TIMEOUT);

    try {
      const response = await fetch(SIGNATURE_VALIDATOR_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_error) {
        payload = { raw: text };
      }

      if (!response.ok) {
        return res.status(502).json({
          available: false,
          executed: false,
          error: payload?.error || payload?.message || `Validador de assinatura respondeu com HTTP ${response.status}`,
          validatorPayload: payload
        });
      }

      return res.json({
        available: true,
        executed: true,
        validator: 'validador-assinatura-icp',
        executedAt: new Date().toISOString(),
        fileName: uploaded.originalname,
        ...payload
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Tempo excedido na validação de assinatura pelo microserviço Java.'
      : normalizeErrorMessage(error);
    return res.status(502).json({
      available: false,
      executed: false,
      error: message
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
});

app.use((error, _req, res, _next) => {
  const status = error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  res.status(status).json({ error: normalizeErrorMessage(error) });
});

app.listen(PORT, () => {
  console.log(`Verificador iniciado em http://localhost:${PORT}`);
});

async function runVeraPdf(filePath) {
  const attempts = [
    ['-f', '0', filePath],
    ['--flavour', '0', filePath],
    [filePath]
  ];

  let lastError = null;

  for (const args of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync(VERAPDF_BIN, args, {
        timeout: Number(process.env.VERAPDF_TIMEOUT || 120000),
        maxBuffer: Number(process.env.VERAPDF_MAX_BUFFER || 20 * 1024 * 1024)
      });
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (output.includes('<report') || output.includes('<validationReport')) return output;
      lastError = new Error(output || 'veraPDF executou, mas não retornou relatório XML reconhecido.');
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
      if (output.includes('<report') || output.includes('<validationReport')) return output;
      lastError = error;
    }
  }

  throw lastError || new Error('Não foi possível executar veraPDF.');
}

function parseVeraPdfXml(xml) {
  const validationTag = xml.match(/<validationReport\b[^>]*>/i)?.[0] || '';
  const detailsTag = xml.match(/<details\b[^>]*>/i)?.[0] || '';

  const isCompliantRaw = getXmlAttr(validationTag, 'isCompliant');
  const profileName = decodeXml(getXmlAttr(validationTag, 'profileName')) || null;
  const rawStatement = decodeXml(getXmlAttr(validationTag, 'statement')) || null;

  const failedItems = [];
  const ruleRegex = /<rule\b([\s\S]*?)<\/rule>/gi;
  let match;
  while ((match = ruleRegex.exec(xml)) && failedItems.length < 8) {
    const ruleBlock = match[0];
    const ruleTag = ruleBlock.match(/<rule\b[^>]*>/i)?.[0] || '';
    const failedChecks = Number(getXmlAttr(ruleTag, 'failedChecks') || 0);
    if (!failedChecks) continue;
    const specification = decodeXml(getXmlAttr(ruleTag, 'specification'));
    const clause = decodeXml(getXmlAttr(ruleTag, 'clause'));
    const testNumber = decodeXml(getXmlAttr(ruleTag, 'testNumber'));
    const description = decodeXml(getXmlNode(ruleBlock, 'description'));
    failedItems.push([specification, clause, testNumber, description].filter(Boolean).join(' · '));
  }

  return {
    available: true,
    executed: true,
    isCompliant: isCompliantRaw === 'true',
    profileName,
    rawStatement,
    passedRules: toNumber(getXmlAttr(detailsTag, 'passedRules')),
    failedRules: toNumber(getXmlAttr(detailsTag, 'failedRules')),
    passedChecks: toNumber(getXmlAttr(detailsTag, 'passedChecks')),
    failedChecks: toNumber(getXmlAttr(detailsTag, 'failedChecks')),
    failedItems
  };
}

function getXmlAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}="([^"]*)"`, 'i')) || tag.match(new RegExp(`${attr}='([^']*)'`, 'i'));
  return match?.[1] || '';
}

function getXmlNode(xml, node) {
  const match = xml.match(new RegExp(`<${node}[^>]*>([\\s\\S]*?)<\\/${node}>`, 'i'));
  return match?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
}

function decodeXml(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeErrorMessage(error) {
  const text = String(error?.message || error || 'Erro desconhecido.');
  if (text.includes('ENOENT')) {
    return 'veraPDF não foi encontrado no servidor. Instale o veraPDF CLI ou configure a variável VERAPDF_BIN.';
  }
  if (text.includes('timed out')) {
    return 'Tempo excedido ao executar veraPDF.';
  }
  return text.slice(0, 1200);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
