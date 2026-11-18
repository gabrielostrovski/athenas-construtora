'use strict';
/**
 * Servidor da Athenas Construtora — Node.js 22+, sem dependências externas.
 * Serve o site (pasta /public), banco de dados relacional e API REST.
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseManager } = require('./db.js');

const TIPOS = ['Construção residencial', 'Reforma ou ampliação', 'Obra comercial', 'Outro'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

function loadConfig(o = {}) {
  const e = process.env;
  const dataDir = path.resolve(o.dataDir ?? (e.DATA_DIR || path.join(__dirname, '..', 'data')));
  return {
    port: o.port ?? (Number(e.PORT) || 3000),
    host: o.host ?? (e.HOST || '0.0.0.0'),
    publicDir: path.resolve(o.publicDir ?? path.join(__dirname, '..', 'public')),
    dataDir,
    dbPath: o.dbPath ?? (e.DB_PATH ? path.resolve(e.DB_PATH) : path.join(dataDir, 'athenas.db')),
    supabaseUrl: o.supabaseUrl ?? (e.SUPABASE_URL || ''),
    supabaseKey: o.supabaseKey ?? (e.SUPABASE_KEY || e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_ANON_KEY || ''),
    adminToken: o.adminToken ?? (e.ADMIN_TOKEN || ''),
    trustProxy: o.trustProxy ?? (e.TRUST_PROXY === 'true'),
    siteOrigin: o.siteOrigin ?? (e.SITE_ORIGIN || ''),
    whatsapp: o.whatsapp ?? (e.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
    webhook: o.webhook ?? (e.NOTIFY_WEBHOOK_URL || ''),
    contactLimit: o.contactLimit ?? 5,
    windowMs: o.windowMs ?? 15 * 60 * 1000
  };
}

function makeLimiter() {
  const hits = new Map();
  function hit(key, max, windowMs) {
    const now = Date.now();
    if (hits.size > 50000) hits.clear();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    return true;
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600000) hits.delete(k);
  }, 600000);
  timer.unref();
  return { hit, close: () => clearInterval(timer) };
}

const clean = (s, max) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function validate(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { erros: ['Dados inválidos.'] };
  const str = (k) => (typeof b[k] === 'string' ? b[k] : '');
  const erros = [];
  const nome = clean(str('nome'), 100);
  const email = clean(str('email'), 254);
  const msg = clean(str('msg'), 1000);
  const tipo = str('tipo');
  let tel = str('telefone').replace(/\D/g, '');
  if (tel.startsWith('55') && tel.length >= 12) tel = tel.slice(2);

  if (nome.length < 2) erros.push('Informe seu nome.');
  if (!/^[1-9][1-9](9\d{8}|[2-9]\d{7})$/.test(tel)) erros.push('Informe um telefone válido com DDD.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) erros.push('E-mail inválido.');
  if (!TIPOS.includes(tipo)) erros.push('Escolha um tipo de obra.');
  if (str('msg').length > 1000) erros.push('A mensagem deve ter até 1000 caracteres.');
  if (b.consentimento !== true) erros.push('É necessário concordar com o contato para enviar.');
  return { erros, dados: { nome, telefone: tel, email, tipo, msg } };
}

function createServer(opts = {}) {
  const cfg = loadConfig(opts);
  const limiter = makeLimiter();
  const db = new DatabaseManager({
    dataDir: cfg.dataDir,
    dbPath: cfg.dbPath,
    supabaseUrl: cfg.supabaseUrl,
    supabaseKey: cfg.supabaseKey
  });

  const clientIp = (req) => {
    if (cfg.trustProxy && req.headers['x-forwarded-for']) {
      return String(req.headers['x-forwarded-for']).split(',').pop().trim();
    }
    return req.socket.remoteAddress || '?';
  };

  function securityHeaders(req, res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const https = req.socket.encrypted || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  function sendJson(res, status, obj, extra = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extra
    });
    res.end(body);
  }
  function sendText(res, status, text, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(text);
  }

  function readJson(req, max = 8192) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > max) return reject(Object.assign(new Error('grande'), { status: 413 }));
      let size = 0, tooBig = false;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) { tooBig = true; return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return reject(Object.assign(new Error('grande'), { status: 413 }));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Object.assign(new Error('json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function originOk(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host || (cfg.siteOrigin && o === cfg.siteOrigin); }
    catch { return false; }
  }

  function saveLead(lead) {
    return db.saveLead(lead);
  }

  function notify(lead) {
    if (!cfg.webhook.startsWith('https://')) return;
    const text = `Novo pedido de orçamento: ${lead.nome} (${lead.telefone}) — ${lead.tipo}` + (lead.msg ? `\n${lead.msg}` : '');
    fetch(cfg.webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000)
    }).catch(() => console.error('Aviso: falha ao notificar o webhook.'));
  }

  async function contato(req, res, ip) {
    if (!limiter.hit('c:' + ip, cfg.contactLimit, cfg.windowMs)) {
      return sendJson(res, 429, { ok: false, erros: ['Muitas tentativas. Tente novamente em alguns minutos.'] },
        { 'Retry-After': String(Math.ceil(cfg.windowMs / 1000)) });
    }
    if (!originOk(req)) return sendJson(res, 403, { ok: false, erros: ['Origem não permitida.'] });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return sendJson(res, 415, { ok: false, erros: ['Formato não suportado.'] });
    }
    let body;
    try { body = await readJson(req); }
    catch (err) {
      const status = err.status || 400;
      return sendJson(res, status, { ok: false, erros: [status === 413 ? 'Pedido grande demais.' : 'Dados inválidos.'] },
        status === 413 ? { Connection: 'close' } : {});
    }
    const ok = { ok: true, mensagem: 'Pedido recebido! Entraremos em contato em breve.' };
    if (body && typeof body.website === 'string' && body.website.trim() !== '') return sendJson(res, 200, ok); // robô
    const { erros, dados } = validate(body);
    if (erros.length) return sendJson(res, 400, { ok: false, erros });

    const lead = {
      id: crypto.randomUUID(),
      criadoEm: new Date().toISOString(),
      ...dados,
      ip
    };
    try { await saveLead(lead); }
    catch (err) {
      console.error('Erro ao salvar pedido:', err.code || err.message);
      return sendJson(res, 500, { ok: false, erros: ['Não foi possível registrar o pedido agora. Tente novamente.'] });
    }
    notify(lead);
    const resp = { ...ok };
    if (cfg.whatsapp) {
      const t = `Olá, sou ${lead.nome}. Pedi um orçamento no site (${lead.tipo}).`;
      resp.whatsapp = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(t)}`;
    }
    return sendJson(res, 200, resp);
  }

  function checkAdminAuth(req, res, ip) {
    if (cfg.adminToken.length < 16) {
      sendJson(res, 404, { ok: false });
      return false;
    }
    if (!limiter.hit('a:' + ip, 10, cfg.windowMs)) {
      sendJson(res, 429, { ok: false });
      return false;
    }
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(got, cfg.adminToken)) {
      sendJson(res, 401, { ok: false });
      return false;
    }
    return true;
  }

  async function adminLeads(req, res, ip) {
    if (!checkAdminAuth(req, res, ip)) return;
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const limit = Number(urlObj.searchParams.get('limit')) || 200;
      const offset = Number(urlObj.searchParams.get('offset')) || 0;
      const status = urlObj.searchParams.get('status') || '';
      const tipo = urlObj.searchParams.get('tipo') || '';
      const busca = urlObj.searchParams.get('busca') || '';

      const resultado = await db.getLeads({ limit, offset, status, tipo, busca });
      return sendJson(res, 200, {
        ok: true,
        total: resultado.total,
        leads: resultado.leads,
        limit: resultado.limit,
        offset: resultado.offset
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, erros: ['Erro ao buscar leads: ' + err.message] });
    }
  }

  async function adminMetricas(req, res, ip) {
    if (!checkAdminAuth(req, res, ip)) return;
    try {
      const metricas = await db.getMetrics();
      return sendJson(res, 200, { ok: true, metricas });
    } catch (err) {
      return sendJson(res, 500, { ok: false, erros: [err.message] });
    }
  }

  async function adminUpdateLead(req, res, ip, leadId) {
    if (!checkAdminAuth(req, res, ip)) return;
    let body;
    try { body = await readJson(req); }
    catch { return sendJson(res, 400, { ok: false, erros: ['Corpo da requisição inválido.'] }); }

    const { status, observacoes } = body || {};
    try {
      const atualizado = await db.updateLeadStatus(leadId, status, observacoes);
      if (!atualizado) return sendJson(res, 404, { ok: false, erros: ['Lead não encontrado.'] });
      return sendJson(res, 200, { ok: true, lead: atualizado });
    } catch (err) {
      return sendJson(res, 400, { ok: false, erros: [err.message] });
    }
  }

  async function listarObras(res) {
    try {
      const obras = await db.getObras();
      return sendJson(res, 200, { ok: true, obras });
    } catch (err) {
      return sendJson(res, 500, { ok: false, erros: [err.message] });
    }
  }

  async function serveStatic(req, res, rawPath) {
    let p;
    try { p = decodeURIComponent(rawPath); } catch { return sendText(res, 400, 'Requisição inválida.'); }
    if (p.includes('\0')) return sendText(res, 400, 'Requisição inválida.');
    if (p.endsWith('/')) p += 'index.html';
    const rel = path.normalize(p).replace(/^[/\\]+/, '');
    const abs = path.join(cfg.publicDir, rel);
    const ext = path.extname(abs).toLowerCase();
    if (!abs.startsWith(cfg.publicDir + path.sep) || rel.split(/[/\\]/).some((s) => s.startsWith('.')) || !MIME[ext]) {
      return sendText(res, 404, 'Página não encontrada.');
    }
    let st;
    try { st = await fsp.stat(abs); } catch { return sendText(res, 404, 'Página não encontrada.'); }
    if (!st.isFile()) return sendText(res, 404, 'Página não encontrada.');
    res.writeHead(200, {
      'Content-Type': MIME[ext], 'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  }

  async function handle(req, res) {
    securityHeaders(req, res);
    if (!req.url || req.url[0] !== '/') return sendText(res, 400, 'Requisição inválida.');
    const ip = clientIp(req);
    if (!limiter.hit('g:' + ip, 300, 60000)) return sendText(res, 429, 'Muitas requisições.', { 'Retry-After': '60' });
    const pathname = req.url.split('?')[0];

    if (pathname === '/api/saude') return sendJson(res, 200, { ok: true });
    if (pathname === '/api/obras') {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false }, { Allow: 'GET' });
      return listarObras(res);
    }
    if (pathname === '/api/contato') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false }, { Allow: 'POST' });
      return contato(req, res, ip);
    }
    if (pathname === '/api/admin/leads') {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false }, { Allow: 'GET' });
      return adminLeads(req, res, ip);
    }
    if (pathname === '/api/admin/metricas') {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false }, { Allow: 'GET' });
      return adminMetricas(req, res, ip);
    }
    const matchLeadStatus = pathname.match(/^\/api\/admin\/leads\/([a-zA-Z0-9_-]+)\/status$/);
    if (matchLeadStatus) {
      if (req.method !== 'POST' && req.method !== 'PATCH') {
        return sendJson(res, 405, { ok: false }, { Allow: 'POST, PATCH' });
      }
      return adminUpdateLead(req, res, ip, matchLeadStatus[1]);
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    return sendText(res, 405, 'Método não permitido.', { Allow: 'GET, HEAD' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('Erro interno:', err.message);
      if (!res.headersSent) sendJson(res, 500, { ok: false, erros: ['Erro interno.'] });
      else res.end();
    });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.on('clientError', (_e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  server.on('close', () => {
    limiter.close();
    db.close();
  });
  server.cfg = cfg;
  server.db = db;
  return server;
}

module.exports = { createServer, validate };

if (require.main === module) {
  const server = createServer();
  const { port, host, adminToken, dbPath, supabaseUrl } = server.cfg;
  if (adminToken.length < 16) console.warn('Aviso: ADMIN_TOKEN ausente ou curto (mín. 16). A rota de administração está desativada.');
  const dbInfo = server.db.isSupabase
    ? `Supabase (${supabaseUrl})`
    : `${dbPath} (${server.db.isSqlite ? 'SQLite Nativo' : 'JSONL'})`;
  console.log(`Banco de dados: ${dbInfo}`);
  server.listen(port, host, () => console.log(`Athenas Construtora no ar em http://localhost:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
