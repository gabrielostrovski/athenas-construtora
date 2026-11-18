'use strict';
/**
 * Script CLI para exportar leads da Athenas Construtora em CSV ou JSON.
 * Uso:
 *   node scripts/export-data.js --csv   -> Salva em data/leads_export.csv
 *   node scripts/export-data.js --json  -> Salva em data/leads_export.json
 */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseManager } = require('../server/db.js');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dbManager = new DatabaseManager({ dataDir });

function toCSV(leads) {
  const headers = ['ID', 'Data/Hora', 'Nome', 'Telefone', 'Email', 'Tipo de Obra', 'Status', 'Valor Estimado', 'Mensagem', 'Observações'];
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = [headers.join(',')];
  for (const l of leads) {
    rows.push([
      escapeCsv(l.id),
      escapeCsv(l.criado_em || l.criadoEm),
      escapeCsv(l.nome),
      escapeCsv(l.telefone),
      escapeCsv(l.email),
      escapeCsv(l.tipo),
      escapeCsv(l.status),
      escapeCsv(l.valor_estimado),
      escapeCsv(l.msg),
      escapeCsv(l.observacoes)
    ].join(','));
  }
  return '\uFEFF' + rows.join('\r\n'); // Inclui BOM para abrir com acentuação correta no Excel
}

async function run() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const format = isJson ? 'JSON' : 'CSV';

  console.log(`Carregando leads para exportação em ${format}...`);
  const { leads, total } = await dbManager.getLeads({ limit: 10000 });

  if (!leads.length) {
    console.log('Nenhum lead encontrado para exportar.');
    dbManager.close();
    return;
  }

  if (isJson) {
    const outPath = path.join(dataDir, 'leads_export.json');
    fs.writeFileSync(outPath, JSON.stringify(leads, null, 2), 'utf8');
    console.log(`✔ ${total} lead(s) exportado(s) com sucesso para:\n  ${outPath}`);
  } else {
    const outPath = path.join(dataDir, 'leads_export.csv');
    fs.writeFileSync(outPath, toCSV(leads), 'utf8');
    console.log(`✔ ${total} lead(s) exportado(s) com sucesso para:\n  ${outPath}`);
  }

  dbManager.close();
}

run().catch((err) => {
  console.error('Erro na exportação:', err);
  process.exit(1);
});
