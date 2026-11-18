'use strict';
/**
 * Camada de Banco de Dados — Athenas Construtora
 * Suporte a:
 *   1. Supabase (PostgreSQL na Nuvem via REST API nativa / fetch - sem dependências)
 *   2. SQLite 3 local (node:sqlite nativo em Node.js 22+)
 *   3. Fallback em arquivo JSON caso rode em versão legada sem credenciais
 */
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

let sqliteModule = null;
try {
  sqliteModule = require('node:sqlite');
} catch {
  sqliteModule = null;
}

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    telefone TEXT NOT NULL,
    email TEXT,
    tipo TEXT NOT NULL,
    msg TEXT,
    consentimento INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'novo',
    ip TEXT,
    origem TEXT NOT NULL DEFAULT 'site',
    valor_estimado REAL,
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_leads_criado_em ON leads (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_tipo ON leads (tipo);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads (telefone);
`;

class DatabaseManager {
  constructor(opts = {}) {
    this.dataDir = path.resolve(opts.dataDir || path.join(__dirname, '..', 'data'));
    this.dbPath = path.resolve(opts.dbPath || path.join(this.dataDir, 'athenas.db'));
    
    // Supabase
    this.supabaseUrl = (opts.supabaseUrl || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    this.supabaseKey = (opts.supabaseKey || process.env.SUPABASE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
    this.isSupabase = Boolean(this.supabaseUrl && this.supabaseKey);

    // SQLite
    this.isSqlite = Boolean(sqliteModule && sqliteModule.DatabaseSync);
    this.db = null;
    this.queue = Promise.resolve();

    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        console.error('Aviso ao criar dataDir:', err.message);
      }
    }

    if (this.isSupabase) {
      console.log(`Conectado ao Supabase: ${this.supabaseUrl}`);
    } else if (this.isSqlite) {
      this._initSqlite();
    } else {
      console.warn('Utilizando armazenamento local em arquivo.');
    }
  }

  get provider() {
    if (this.isSupabase) return 'supabase';
    if (this.isSqlite) return 'sqlite';
    return 'jsonl';
  }

  _initSqlite() {
    try {
      this.db = new sqliteModule.DatabaseSync(this.dbPath);
      this.db.exec(SCHEMA_SQL);
      this._importLegacyJsonlIfEmpty();
    } catch (err) {
      console.error('Falha ao inicializar SQLite nativo:', err.message);
      this.isSqlite = false;
      this.db = null;
    }
  }

  _importLegacyJsonlIfEmpty() {
    if (!this.db) return;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS total FROM leads').get();
      if (row.total > 0) return;

      const jsonlPath = path.join(this.dataDir, 'leads.jsonl');
      if (!fs.existsSync(jsonlPath)) return;

      const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
      if (!lines.length) return;

      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO leads (
          id, nome, telefone, email, tipo, msg, consentimento, status, ip, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        try {
          const l = JSON.parse(line);
          insert.run(
            l.id || crypto.randomUUID(),
            l.nome || 'Sem nome',
            l.telefone || '',
            l.email || null,
            l.tipo || 'Outro',
            l.msg || null,
            l.consentimento ? 1 : 0,
            l.status || 'novo',
            l.ip || null,
            l.criadoEm || l.criado_em || new Date().toISOString(),
            l.criadoEm || l.criado_em || new Date().toISOString()
          );
        } catch {}
      }
    } catch (err) {
      console.warn('Aviso na migração legada:', err.message);
    }
  }

  // --- Operações com Supabase ---

  async _supabaseFetch(endpoint, options = {}) {
    const url = `${this.supabaseUrl}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const resp = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Erro no Supabase (${resp.status}): ${errText}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    const range = resp.headers.get('content-range') || '';
    let total = null;
    if (range && range.includes('/')) {
      const parts = range.split('/');
      total = parts[1] !== '*' ? Number(parts[1]) : null;
    }

    const data = contentType.includes('application/json') ? await resp.json() : null;
    return { data, total, status: resp.status };
  }

  async saveLead(dados) {
    const lead = {
      id: dados.id || crypto.randomUUID(),
      nome: dados.nome,
      telefone: dados.telefone,
      email: dados.email || null,
      tipo: dados.tipo,
      msg: dados.msg || null,
      consentimento: dados.consentimento ? true : false,
      status: dados.status || 'novo',
      ip: dados.ip || null,
      origem: dados.origem || 'site',
      valor_estimado: dados.valor_estimado || null,
      observacoes: dados.observacoes || null,
      criado_em: dados.criadoEm || dados.criado_em || new Date().toISOString()
    };

    if (this.isSupabase) {
      await this._supabaseFetch('leads', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(lead)
      });
    } else if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO leads (
          id, nome, telefone, email, tipo, msg, consentimento, status, ip, origem, valor_estimado, observacoes, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        lead.id, lead.nome, lead.telefone, lead.email, lead.tipo, lead.msg,
        lead.consentimento ? 1 : 0, lead.status, lead.ip, lead.origem, lead.valor_estimado,
        lead.observacoes, lead.criado_em, lead.criado_em
      );
    }

    // Backup local de redundância
    await this._appendJsonlBackup(lead);

    return lead;
  }

  async _appendJsonlBackup(lead) {
    const p = this.queue.then(async () => {
      await fsp.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      const line = JSON.stringify({
        id: lead.id,
        criadoEm: lead.criado_em,
        nome: lead.nome,
        telefone: lead.telefone,
        email: lead.email,
        tipo: lead.tipo,
        msg: lead.msg,
        status: lead.status,
        ip: lead.ip
      }) + '\n';
      await fsp.appendFile(path.join(this.dataDir, 'leads.jsonl'), line, { mode: 0o600 });
    });
    this.queue = p.catch(() => {});
    return p;
  }

  async getLeads(opts = {}) {
    const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const status = opts.status ? String(opts.status).trim() : null;
    const tipo = opts.tipo ? String(opts.tipo).trim() : null;
    const busca = opts.busca ? String(opts.busca).trim() : null;

    if (this.isSupabase) {
      const params = new URLSearchParams();
      params.append('select', '*');
      params.append('order', 'criado_em.desc');
      params.append('limit', String(limit));
      params.append('offset', String(offset));

      if (status) params.append('status', `eq.${status}`);
      if (tipo) params.append('tipo', `eq.${tipo}`);
      if (busca) {
        params.append('or', `(nome.ilike.*${busca}*,telefone.ilike.*${busca}*,email.ilike.*${busca}*,msg.ilike.*${busca}*)`);
      }

      const res = await this._supabaseFetch(`leads?${params.toString()}`, {
        method: 'GET',
        headers: { 'Prefer': 'count=exact' }
      });

      return {
        total: res.total !== null ? res.total : (res.data ? res.data.length : 0),
        leads: res.data || [],
        limit,
        offset
      };
    }

    if (this.isSqlite && this.db) {
      let where = 'WHERE 1=1';
      const params = [];

      if (status) {
        where += ' AND status = ?';
        params.push(status);
      }
      if (tipo) {
        where += ' AND tipo = ?';
        params.push(tipo);
      }
      if (busca) {
        where += ' AND (nome LIKE ? OR telefone LIKE ? OR email LIKE ? OR msg LIKE ?)';
        const b = `%${busca}%`;
        params.push(b, b, b, b);
      }

      const totalStmt = this.db.prepare(`SELECT COUNT(*) AS total FROM leads ${where}`);
      const { total } = totalStmt.get(...params);

      const listStmt = this.db.prepare(`
        SELECT id, nome, telefone, email, tipo, msg, consentimento, status, ip, origem, valor_estimado, observacoes, criado_em, atualizado_em
        FROM leads
        ${where}
        ORDER BY criado_em DESC
        LIMIT ? OFFSET ?
      `);
      const rows = listStmt.all(...params, limit, offset);

      return { total, leads: rows, limit, offset };
    }

    return this._getLeadsFromJsonl(limit, offset, status, busca);
  }

  async _getLeadsFromJsonl(limit, offset, status, busca) {
    let linhas = [];
    try {
      linhas = (await fsp.readFile(path.join(this.dataDir, 'leads.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    let parsed = linhas.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    if (status) parsed = parsed.filter((l) => l.status === status);
    if (busca) {
      const b = busca.toLowerCase();
      parsed = parsed.filter((l) =>
        (l.nome && l.nome.toLowerCase().includes(b)) ||
        (l.telefone && l.telefone.includes(b)) ||
        (l.email && l.email.toLowerCase().includes(b)) ||
        (l.msg && l.msg.toLowerCase().includes(b))
      );
    }

    const total = parsed.length;
    const leads = parsed.reverse().slice(offset, offset + limit);

    return { total, leads, limit, offset };
  }

  async getLeadById(id) {
    if (!id) return null;
    if (this.isSupabase) {
      const res = await this._supabaseFetch(`leads?id=eq.${id}&select=*`);
      return res.data && res.data.length ? res.data[0] : null;
    }
    if (this.isSqlite && this.db) {
      return this.db.prepare('SELECT * FROM leads WHERE id = ?').get(id) || null;
    }
    const { leads } = await this.getLeads({ limit: 500 });
    return leads.find((l) => l.id === id) || null;
  }

  async updateLeadStatus(id, novoStatus, observacoes = null) {
    const STATUS_VALIDOS = ['novo', 'em_atendimento', 'orcamento_enviado', 'fechado', 'perdido'];
    if (!STATUS_VALIDOS.includes(novoStatus)) {
      throw new Error(`Status inválido: ${novoStatus}`);
    }

    if (this.isSupabase) {
      const payload = { status: novoStatus };
      if (observacoes !== null && observacoes !== undefined) payload.observacoes = observacoes;
      const res = await this._supabaseFetch(`leads?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });
      return res.data && res.data.length ? res.data[0] : null;
    }

    if (this.isSqlite && this.db) {
      if (observacoes) {
        this.db.prepare(
          'UPDATE leads SET status = ?, observacoes = ?, atualizado_em = datetime(\'now\', \'localtime\') WHERE id = ?'
        ).run(novoStatus, observacoes, id);
      } else {
        this.db.prepare(
          'UPDATE leads SET status = ?, atualizado_em = datetime(\'now\', \'localtime\') WHERE id = ?'
        ).run(novoStatus, id);
      }
      return this.getLeadById(id);
    }

    return null;
  }

  async getMetrics() {
    if (this.isSupabase) {
      const { leads, total } = await this.getLeads({ limit: 1000 });
      const novos = leads.filter((l) => l.status === 'novo').length;
      const em_atendimento = leads.filter((l) => l.status === 'em_atendimento').length;
      const fechados = leads.filter((l) => l.status === 'fechado').length;
      const orcamento_enviado = leads.filter((l) => l.status === 'orcamento_enviado').length;
      const perdidos = leads.filter((l) => l.status === 'perdido').length;
      const conversao = total > 0 ? Number(((fechados / total) * 100).toFixed(1)) : 0;
      return {
        total,
        novos,
        em_atendimento,
        orcamento_enviado,
        fechados,
        perdidos,
        taxa_conversao_pct: conversao
      };
    }

    if (this.isSqlite && this.db) {
      const gerais = this.db.prepare(`
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'novo' THEN 1 ELSE 0 END) AS novos,
          SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) AS em_atendimento,
          SUM(CASE WHEN status = 'orcamento_enviado' THEN 1 ELSE 0 END) AS orcamento_enviado,
          SUM(CASE WHEN status = 'fechado' THEN 1 ELSE 0 END) AS fechados,
          SUM(CASE WHEN status = 'perdido' THEN 1 ELSE 0 END) AS perdidos
        FROM leads
      `).get();

      const conversao = gerais.total > 0
        ? Number(((gerais.fechados / gerais.total) * 100).toFixed(1))
        : 0;

      return { ...gerais, taxa_conversao_pct: conversao };
    }

    const { leads, total } = await this.getLeads({ limit: 1000 });
    return {
      total,
      novos: leads.filter((l) => l.status === 'novo').length,
      em_atendimento: leads.filter((l) => l.status === 'em_atendimento').length,
      fechados: leads.filter((l) => l.status === 'fechado').length,
      perdidos: leads.filter((l) => l.status === 'perdido').length,
      taxa_conversao_pct: total > 0 ? Number(((leads.filter((l) => l.status === 'fechado').length / total) * 100).toFixed(1)) : 0
    };
  }

  async getObras() {
    return [
      {
        id: 'obra-casa-floresta',
        titulo: 'Casa Térrea Moderna',
        categoria: 'Construção residencial',
        bairro: 'Floresta, Joinville',
        descricao: 'Casa térrea com 3 suítes, pé-direito duplo e área gourmet integrada.',
        area_m2: 185.50,
        status_obra: 'concluida'
      },
      {
        id: 'obra-sobrado-costa-silva',
        titulo: 'Sobrado Contemporâneo',
        categoria: 'Construção residencial',
        bairro: 'Costa e Silva, Joinville',
        descricao: 'Sobrado com 2 pavimentos e preparação para energia solar.',
        area_m2: 220.00,
        status_obra: 'concluida'
      },
      {
        id: 'obra-clinica-america',
        titulo: 'Espaço Comercial',
        categoria: 'Obra comercial',
        bairro: 'América, Joinville',
        descricao: 'Adequação completa de clínica médica com acessibilidade.',
        area_m2: 310.00,
        status_obra: 'concluida'
      }
    ];
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch {}
      this.db = null;
    }
  }
}

module.exports = { DatabaseManager };
