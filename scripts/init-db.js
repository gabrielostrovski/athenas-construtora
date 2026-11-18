'use strict';
/**
 * Script CLI para gerenciamento do banco de dados da Athenas Construtora
 * Uso:
 *   node scripts/init-db.js          -> Cria tabelas e insere configurações
 *   node scripts/init-db.js --seed   -> Insere leads e dados de teste para demonstração
 *   node scripts/init-db.js --stats  -> Exibe relatório de métricas e status do banco
 */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseManager } = require('../server/db.js');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'athenas.db'));

console.log('--- Athenas Construtora | Gestão de Banco de Dados ---');
console.log(`Diretório de dados: ${dataDir}`);
console.log(`Arquivo do banco:   ${dbPath}`);

const dbManager = new DatabaseManager({ dataDir, dbPath });

async function seedExemplos() {
  const exemplos = [
    {
      nome: 'Carlos Eduardo Schmitt',
      telefone: '47991234567',
      email: 'carlos.schmitt@exemplo.com.br',
      tipo: 'Construção residencial',
      msg: 'Terreno no bairro Glória com 360m². Quero construir uma casa térrea com 3 quartos.',
      consentimento: true,
      status: 'em_atendimento',
      ip: '127.0.0.1',
      valor_estimado: 450000.00,
      observacoes: 'Cliente já possui escritura do lote. Visita técnica agendada para sábado.'
    },
    {
      nome: 'Juliana Fagundes',
      telefone: '47998765432',
      email: 'juliana.f@exemplo.com.br',
      tipo: 'Reforma ou ampliação',
      msg: 'Quero ampliar a área de fundos da minha casa no Floresta para fazer espaço gourmet com churrasqueira.',
      consentimento: true,
      status: 'novo',
      ip: '127.0.0.1'
    },
    {
      nome: 'Roberto Silveira',
      telefone: '47984561234',
      email: 'roberto@empresaexemplo.com.br',
      tipo: 'Obra comercial',
      msg: 'Galpão comercial no Distrito Industrial com 500m². Preciso de orçamento fechado.',
      consentimento: true,
      status: 'orcamento_enviado',
      ip: '127.0.0.1',
      valor_estimado: 780000.00,
      observacoes: 'Orçamento entregue por e-mail e impresso. Aguardando retorno da diretoria.'
    },
    {
      nome: 'Mariana Duarte',
      telefone: '47997654321',
      email: 'mariana.duarte@exemplo.com.br',
      tipo: 'Construção residencial',
      msg: 'Sobrado de alto padrão no América. Temos o projeto arquitetônico pronto.',
      consentimento: true,
      status: 'fechado',
      ip: '127.0.0.1',
      valor_estimado: 620000.00,
      observacoes: 'Contrato assinado em 10/11. Obra prevista para iniciar em 15 dias.'
    }
  ];

  console.log('\nInserindo leads de exemplo...');
  for (const ex of exemplos) {
    const lead = await dbManager.saveLead(ex);
    if (ex.status !== 'novo') {
      await dbManager.updateLeadStatus(lead.id, ex.status, ex.observacoes);
    }
    console.log(`✔ Lead inserido: ${ex.nome} (${ex.tipo}) — Status: ${ex.status}`);
  }
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--seed')) {
    await seedExemplos();
  }

  const metricas = await dbManager.getMetrics();
  console.log('\n--- Resumo Atual do Banco de Dados ---');
  console.log(`Modo de Armazenamento: ${dbManager.isSqlite ? 'SQLite Nativo (node:sqlite)' : 'JSONL / Arquivo'}`);
  console.log(`Total de Leads:        ${metricas.total || 0}`);
  console.log(`Novos:                 ${metricas.novos || 0}`);
  console.log(`Em atendimento:        ${metricas.em_atendimento || 0}`);
  console.log(`Orçamento enviado:     ${metricas.orcamento_enviado || 0}`);
  console.log(`Fechados:              ${metricas.fechados || 0}`);
  console.log(`Taxa de conversão:     ${metricas.taxa_conversao_pct || 0}%`);

  const obras = await dbManager.getObras();
  console.log(`Obras no portfólio:    ${obras.length}`);

  dbManager.close();
  console.log('\nConcluído com sucesso!');
}

run().catch((err) => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
