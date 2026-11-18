-- ==============================================================================
-- Athenas Construtora — Esquema do Banco de Dados Relacional (SQLite 3)
-- Arquivo: database/schema.sql
-- ==============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------------------------
-- Tabela: leads (Pedidos de Orçamento recebidos pela Landing Page)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,                                -- UUID v4
    nome TEXT NOT NULL,                                 -- Nome completo do cliente
    telefone TEXT NOT NULL,                             -- Apenas dígitos com DDD (ex: 47999991234)
    email TEXT,                                         -- E-mail opcional
    tipo TEXT NOT NULL CHECK (tipo IN (                 -- Tipo de obra selecionado no formulário
        'Construção residencial',
        'Reforma ou ampliação',
        'Obra comercial',
        'Outro'
    )),
    msg TEXT,                                           -- Detalhes do projeto informados pelo cliente
    consentimento INTEGER NOT NULL DEFAULT 1 CHECK (    -- Aceite da LGPD
        consentimento IN (0, 1)
    ),
    status TEXT NOT NULL DEFAULT 'novo' CHECK (         -- Status no funil comercial
        status IN (
            'novo',
            'em_atendimento',
            'orcamento_enviado',
            'fechado',
            'perdido'
        )
    ),
    ip TEXT,                                            -- IP de origem da requisição
    origem TEXT NOT NULL DEFAULT 'site',                -- Origem do lead (site, whatsapp, indicação)
    valor_estimado REAL,                                -- Valor estimado em R$ após avaliação
    observacoes TEXT,                                   -- Anotações internas da equipe
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------------------------
-- Tabela: interacoes (Histórico de contatos e acompanhamento do lead)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interacoes (
    id TEXT PRIMARY KEY,                                -- UUID v4
    lead_id TEXT NOT NULL,                              -- Chave estrangeira para o lead
    tipo TEXT NOT NULL CHECK (tipo IN (                 -- Canal / tipo de interação
        'whatsapp',
        'ligacao',
        'email',
        'reuniao',
        'visita_tecnica',
        'nota'
    )),
    descricao TEXT NOT NULL,                            -- Detalhes da conversa ou ação
    autor TEXT NOT NULL DEFAULT 'admin',                -- Quem realizou o contato
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- Tabela: obras (Portfólio de obras da construtora)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obras (
    id TEXT PRIMARY KEY,                                -- Identificador único
    titulo TEXT NOT NULL,                               -- Nome da obra (ex: Sobrado Glória)
    categoria TEXT NOT NULL CHECK (categoria IN (       -- Categoria
        'Construção residencial',
        'Reforma ou ampliação',
        'Obra comercial',
        'Outro'
    )),
    bairro TEXT DEFAULT 'Floresta, Joinville',         -- Localização da obra
    descricao TEXT,                                     -- Descrição técnica / destaques
    area_m2 REAL,                                       -- Metragem quadrada
    status_obra TEXT NOT NULL DEFAULT 'concluida' CHECK (-- Situação da obra
        status_obra IN ('planejamento', 'em_andamento', 'concluida')
    ),
    imagem_url TEXT,                                    -- Caminho da imagem no site
    destaque INTEGER NOT NULL DEFAULT 0 CHECK (         -- Exibir em destaque na página inicial
        destaque IN (0, 1)
    ),
    ordem INTEGER NOT NULL DEFAULT 0,                   -- Ordem de exibição
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (            -- Visível no site
        ativo IN (0, 1)
    ),
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------------------------
-- Tabela: configuracoes (Parâmetros da empresa exibidos no site)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,                             -- Nome do parâmetro
    valor TEXT NOT NULL,                                -- Conteúdo
    descricao TEXT,                                     -- Explicação da finalidade
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------------------------
-- Índices para alta performance de consulta
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_criado_em ON leads (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_tipo ON leads (tipo);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads (telefone);
CREATE INDEX IF NOT EXISTS idx_interacoes_lead_id ON interacoes (lead_id);
CREATE INDEX IF NOT EXISTS idx_obras_ativo_ordem ON obras (ativo, ordem);

-- ------------------------------------------------------------------------------
-- Trigger: Atualização automática da coluna 'atualizado_em' em leads
-- ------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_leads_atualizado_em
AFTER UPDATE ON leads
FOR EACH ROW
BEGIN
    UPDATE leads SET atualizado_em = datetime('now', 'localtime') WHERE id = OLD.id;
END;

-- ------------------------------------------------------------------------------
-- Visão (View): Resumo consolidado de leads com quantidade de interações
-- ------------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS vw_leads_resumo AS
SELECT 
    l.id,
    l.nome,
    l.telefone,
    l.email,
    l.tipo,
    l.status,
    l.valor_estimado,
    l.criado_em,
    l.atualizado_em,
    COUNT(i.id) AS total_interacoes,
    MAX(i.criado_em) AS ultimo_contato
FROM leads l
LEFT JOIN interacoes i ON l.id = i.lead_id
GROUP BY l.id;

-- ------------------------------------------------------------------------------
-- Visão (View): Métricas gerais do funil de vendas
-- ------------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS vw_metricas_leads AS
SELECT 
    COUNT(*) AS total_leads,
    SUM(CASE WHEN status = 'novo' THEN 1 ELSE 0 END) AS novos,
    SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) AS em_atendimento,
    SUM(CASE WHEN status = 'orcamento_enviado' THEN 1 ELSE 0 END) AS orcamento_enviado,
    SUM(CASE WHEN status = 'fechado' THEN 1 ELSE 0 END) AS fechados,
    SUM(CASE WHEN status = 'perdido' THEN 1 ELSE 0 END) AS perdidos,
    SUM(CASE WHEN date(criado_em) = date('now', 'localtime') THEN 1 ELSE 0 END) AS leads_hoje
FROM leads;
