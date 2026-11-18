# Athenas Construtora — Site + Backend + Banco de Dados

Site institucional com formulário de captação de orçamentos e banco de dados integrado com suporte a **Supabase (PostgreSQL na Nuvem)** e **SQLite local**. Backend em **Node.js 22+**, sem dependências externas.

---

## Estrutura do Projeto
```
public/                  → Arquivos estáticos da landing page (HTML, CSS, JS)
server/
  ├── server.js          → Servidor HTTP nativo e rotas da API
  └── db.js              → Gerenciador com suporte a Supabase e SQLite nativo
database/
  ├── supabase_schema.sql→ Script SQL para executar no SQL Editor do Supabase (com RLS)
  └── schema.sql         → Estrutura para SQLite 3 local
scripts/
  ├── migrate-to-supabase.js → Migra os leads locais (SQLite/JSONL) para o Supabase
  ├── init-db.js         → CLI para inicializar, popular (--seed) ou inspecionar (--stats)
  └── export-data.js     → CLI para exportação de leads em CSV (Excel) ou JSON
data/
  └── athenas.db         → Arquivo SQLite local (utilizado quando não configurado Supabase)
test/                    → Testes automatizados (node:test)
.env.example             → Variáveis de ambiente modelo
```

---

## Como Migrar para o Supabase (Passo a Passo)

### 1. Criar o Projeto no Supabase
1. Acesse [supabase.com](https://supabase.com) e crie uma conta ou faça login.
2. Crie um novo projeto (ex.: `athenas-construtora`).

### 2. Criar a Tabela no Supabase
1. No painel do seu projeto Supabase, acesse **SQL Editor** no menu lateral esquerdo.
2. Abra o arquivo [database/supabase_schema.sql](file:///c:/Users/nety_/Downloads/athenas-construtora%20(1)/athenas-construtora/database/supabase_schema.sql), copie todo o conteúdo, cole no SQL Editor e clique em **Run**.
3. A tabela `leads` será criada com:
   - Todas as colunas necessárias para o formulário.
   - **Row Level Security (RLS)** ativado com políticas de segurança:
     - Permite inserção anônima (para os visitantes da landing page enviarem pedidos).
     - Protege a leitura e edição apenas para a administração.

### 3. Configurar as Chaves no arquivo `.env`
1. No Supabase, vá em **Project Settings** (ícone de engrenagem) > **API**.
2. Copie:
   - **Project URL**
   - **anon / public key** (ou **service_role key**)
3. No seu arquivo `.env`, adicione:
   ```env
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_KEY=sua-chave-aqui
   ```

### 4. (Opcional) Migrar Leads Locais para o Supabase
Se você já possui leads salvos localmente e quer enviá-los para o Supabase:
```bash
npm run db:migrate-supabase
```

### 5. Iniciar o Servidor
```bash
npm start
```
O servidor detectará o Supabase automaticamente e exibirá no terminal:
`Banco de dados: Supabase (https://seu-projeto.supabase.co)`

---

## Tabela Principal: `leads`
| Coluna | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | UUID / TEXT (PK) | Identificador único do pedido |
| `nome` | VARCHAR(100) | Nome do cliente |
| `telefone` | VARCHAR(20) | Telefone / WhatsApp com DDD |
| `email` | VARCHAR(254) | E-mail do cliente (opcional) |
| `tipo` | VARCHAR(50) | Tipo de obra selecionado no formulário |
| `msg` | TEXT | Detalhes do projeto enviados pelo cliente |
| `consentimento` | BOOLEAN | Aceite dos termos de contato LGPD |
| `status` | VARCHAR(30) | Status: *'novo'*, *'em_atendimento'*, *'fechado'*, etc. |
| `ip` | VARCHAR(45) | IP de origem da requisição |
| `observacoes` | TEXT | Anotações da construtora |
| `criado_em` | TIMESTAMPTZ | Data e hora em que o cliente enviou o pedido |

---

## Comandos do Projeto (CLI)

- **Migrar dados locais para o Supabase:**
  ```bash
  npm run db:migrate-supabase
  ```
- **Exportar leads para planilha Excel (CSV):**
  ```bash
  npm run db:export
  ```
- **Exportar em JSON:**
  ```bash
  npm run db:export:json
  ```
- **Rodar com banco SQLite local (se não quiser usar Supabase):**
  ```bash
  npm start
  ```
