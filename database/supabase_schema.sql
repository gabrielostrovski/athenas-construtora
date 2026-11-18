-- ==============================================================================
-- Athenas Construtora — Esquema para o Supabase (PostgreSQL)
-- Copie e cole este script no SQL Editor do seu projeto Supabase e clique em RUN.
-- ==============================================================================

-- 1. Criação da tabela de leads (pedidos de orçamento da landing page)
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(254),
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN (
        'Construção residencial',
        'Reforma ou ampliação',
        'Obra comercial',
        'Outro'
    )),
    msg TEXT,
    consentimento BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(30) NOT NULL DEFAULT 'novo' CHECK (
        status IN ('novo', 'em_atendimento', 'orcamento_enviado', 'fechado', 'perdido')
    ),
    ip VARCHAR(45),
    origem VARCHAR(50) NOT NULL DEFAULT 'site',
    valor_estimado NUMERIC(12, 2),
    observacoes TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices para buscas rápidas no painel do Supabase
CREATE INDEX IF NOT EXISTS idx_leads_criado_em ON public.leads (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_tipo ON public.leads (tipo);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON public.leads (telefone);

-- 3. Trigger para manter a coluna atualizado_em sempre atualizada
CREATE OR REPLACE FUNCTION public.set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_atualizado_em ON public.leads;
CREATE TRIGGER trg_leads_atualizado_em
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.set_atualizado_em();

-- 4. Segurança: Ativar Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Política 1: O formulário da Landing Page (anon) pode INSERIR novos pedidos
DROP POLICY IF EXISTS "Permitir envio de orçamentos pela landing page" ON public.leads;
CREATE POLICY "Permitir envio de orçamentos pela landing page"
ON public.leads
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Política 2: Somente a chave secreta (service_role) ou usuários autenticados podem ver e editar os pedidos
DROP POLICY IF EXISTS "Acesso restrito para admin" ON public.leads;
CREATE POLICY "Acesso restrito para admin"
ON public.leads
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
