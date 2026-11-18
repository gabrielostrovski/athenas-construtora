'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/server.js');
const { DatabaseManager } = require('../server/db.js');

async function start(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athenas-'));
  const dbPath = path.join(dataDir, 'test.db');
  const server = createServer({ port: 0, host: '127.0.0.1', dataDir, dbPath, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, dataDir, dbPath, port: server.address().port };
}
function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (resp) => {
      let d = ''; resp.on('data', (c) => (d += c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const lead = (o = {}) => JSON.stringify({ nome: 'Maria Silva', telefone: '(47) 99999-1234', email: '', tipo: 'Obra comercial', msg: 'Quero orçar', consentimento: true, website: '', ...o });
const JSON_H = { 'Content-Type': 'application/json' };
const post = (port, body, headers = {}) => request(port, 'POST', '/api/contato', { headers: { ...JSON_H, ...headers }, body });
const leads = (dir) => { try { return fs.readFileSync(path.join(dir, 'leads.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };

test('página inicial com cabeçalhos de segurança', async () => {
  const { server, port } = await start();
  const r = await request(port, 'GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /Athenas Construtora/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal((await request(port, 'GET', '/css/style.css')).status, 200);
  assert.equal((await request(port, 'GET', '/js/main.js')).status, 200);
  server.close();
});

test('bloqueia path traversal, dotfiles e arquivos do servidor', async () => {
  const { server, port } = await start();
  for (const p of ['/../server/server.js', '/..%2fserver%2fserver.js', '/%2e%2e/package.json', '/.env', '/css/../../.env', '/%00', '/server/server.js']) {
    const r = await request(port, 'GET', p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.body, /createServer|ADMIN_TOKEN/, p);
  }
  server.close();
});

test('pedido válido é salvo', async () => {
  const { server, port, dataDir } = await start();
  const r = await post(port, lead());
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  const l = leads(dataDir);
  assert.equal(l.length, 1);
  assert.equal(JSON.parse(l[0]).telefone, '47999991234');
  server.close();
});

test('rejeita dados inválidos e falta de consentimento', async () => {
  const { server, port, dataDir } = await start({ contactLimit: 50 });
  for (const b of [lead({ nome: '' }), lead({ telefone: '123' }), lead({ email: 'x' }), lead({ tipo: 'Hackear' }), lead({ consentimento: false }), '[]', '{nao-json']) {
    assert.equal((await post(port, b)).status, 400, b);
  }
  assert.equal(leads(dataDir).length, 0);
  server.close();
});

test('honeypot responde sucesso mas não salva', async () => {
  const { server, port, dataDir } = await start();
  const r = await post(port, lead({ website: 'http://spam.com' }));
  assert.equal(r.status, 200);
  assert.equal(leads(dataDir).length, 0);
  server.close();
});

test('content-type, origem e tamanho', async () => {
  const { server, port } = await start({ contactLimit: 50 });
  assert.equal((await request(port, 'POST', '/api/contato', { headers: { 'Content-Type': 'text/plain' }, body: lead() })).status, 415);
  assert.equal((await post(port, lead(), { Origin: 'https://evil.com' })).status, 403);
  assert.equal((await post(port, lead(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(port, lead({ msg: 'a'.repeat(20000) }))).status, 413);
  assert.equal((await request(port, 'GET', '/api/contato')).status, 405);
  server.close();
});

test('limite de pedidos por IP', async () => {
  const { server, port } = await start({ contactLimit: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await post(port, lead())).status, 200);
  const r = await post(port, lead());
  assert.equal(r.status, 429);
  assert.ok(r.headers['retry-after']);
  server.close();
});

test('rota de administração protegida por token', async () => {
  const off = await start();
  assert.equal((await request(off.port, 'GET', '/api/admin/leads')).status, 404);
  off.server.close();

  const { server, port } = await start({ adminToken: 'token-de-teste-bem-longo' });
  await post(port, lead());
  assert.equal((await request(port, 'GET', '/api/admin/leads')).status, 401);
  assert.equal((await request(port, 'GET', '/api/admin/leads', { headers: { Authorization: 'Bearer errado' } })).status, 401);
  const ok = await request(port, 'GET', '/api/admin/leads', { headers: { Authorization: 'Bearer token-de-teste-bem-longo' } });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).total, 1);
  server.close();
});

test('WhatsApp opcional na resposta', async () => {
  const { server, port } = await start({ whatsapp: '5547999990000' });
  const j = JSON.parse((await post(port, lead())).body);
  assert.match(j.whatsapp, /^https:\/\/wa\.me\/5547999990000\?text=/);
  server.close();
});

test('rotas adicionais do banco: métricas e obras', async () => {
  const token = 'token-de-teste-bem-longo';
  const { server, port } = await start({ adminToken: token });
  await post(port, lead());

  // Métricas
  const m = await request(port, 'GET', '/api/admin/metricas', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(m.status, 200);
  const mj = JSON.parse(m.body);
  assert.equal(mj.ok, true);
  assert.equal(mj.metricas.total, 1);

  // Obras públicas
  const ob = await request(port, 'GET', '/api/obras');
  assert.equal(ob.status, 200);
  assert.equal(JSON.parse(ob.body).ok, true);

  server.close();
});

test('DatabaseManager detecta provedor Supabase e SQLite', () => {
  const dbLocal = new DatabaseManager({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'athenas-test-')) });
  assert.match(dbLocal.provider, /sqlite|jsonl/);
  dbLocal.close();

  const dbRemote = new DatabaseManager({
    supabaseUrl: 'https://exemplo.supabase.co',
    supabaseKey: 'chave-teste-jwt'
  });
  assert.equal(dbRemote.provider, 'supabase');
  assert.equal(dbRemote.isSupabase, true);
  dbRemote.close();
});
