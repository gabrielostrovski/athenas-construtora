'use strict';
/**
 * Script de migração de dados locais (SQLite / JSONL) para o Supabase
 * Uso:
 *   node scripts/migrate-to-supabase.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseManager } = require('../server/db.js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl || !supabaseKey) {
  console.error('\n❌ Erro: SUPABASE_URL e SUPABASE_KEY não configurados no arquivo .env!');
  console.error('\nPara configurar:');
  console.error('1. Abra ou crie o arquivo .env');
  console.error('2. Adicione as credenciais do seu projeto Supabase:');
  console.error('   SUPABASE_URL=https://seu-projeto.supabase.co');
  console.error('   SUPABASE_KEY=sua-chave-anon-ou-service-role');
  console.error('3. Rode novamente: npm run db:migrate-supabase\n');
  process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const localDb = new DatabaseManager({ dataDir, supabaseUrl: '', supabaseKey: '' });
const remoteDb = new DatabaseManager({ dataDir, supabaseUrl, supabaseKey });

async function run() {
  console.log('--- Athenas Construtora | Migração para o Supabase ---');
  console.log(`Destino: ${supabaseUrl}`);

  console.log('\nLendo leads locais...');
  const { leads, total } = await localDb.getLeads({ limit: 10000 });

  if (!leads.length) {
    console.log('Nenhum lead local encontrado para migrar.');
    localDb.close();
    remoteDb.close();
    return;
  }

  console.log(`Encontrados ${total} lead(s) para migrar.`);
  let sucesso = 0;
  let falhas = 0;

  for (const l of leads) {
    try {
      await remoteDb.saveLead(l);
      sucesso++;
      console.log(`✔ Migrado: [${l.nome}] - Telefone: ${l.telefone} (${l.tipo})`);
    } catch (err) {
      falhas++;
      console.error(`✖ Erro ao migrar [${l.nome}]:`, err.message);
    }
  }

  console.log('\n--- Resultado da Migração ---');
  console.log(`Total processado: ${leads.length}`);
  console.log(`Sucessos:         ${sucesso}`);
  console.log(`Falhas:           ${falhas}`);

  localDb.close();
  remoteDb.close();
  console.log('\nProcesso finalizado!');
}

run().catch((err) => {
  console.error('Erro fatal durante a migração:', err);
  process.exit(1);
});
