'use strict';

/**
 * Zera os dados operacionais do NavozCoin, preservando os administradores.
 *
 * Remove:
 *   members, events, eventParticipants, pointTransactions, rewards,
 *   redemptions, seasons, auditLogs, adminSessions e rateLimits.
 *
 * Mantém:
 *   admins (login e senha atuais).
 *
 * Uso:
 *   npm run reset          -> pede confirmação no terminal
 *   npm run reset:force    -> executa sem confirmação (uso automatizado)
 */

const readline = require('readline');
const { loadEnv } = require('./load-env');

loadEnv();

const { collections, withTransaction, ensureIndexes } = require('../server/db');

const FORCE = process.argv.includes('--yes') || process.argv.includes('--force');
const OPERATIONAL_COLLECTIONS = [
  'members',
  'events',
  'eventParticipants',
  'pointTransactions',
  'rewards',
  'redemptions',
  'seasons',
  'auditLogs',
  'adminSessions',
  'rateLimits',
];

function confirm() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      'Isso apagará TODOS os membros, eventos, pontos, presentes, resgates, temporadas e logs. Os administradores serão mantidos. Continuar? (digite ZERAR): ',
      (answer) => {
        rl.close();
        resolve(answer.trim().toUpperCase() === 'ZERAR');
      }
    );
  });
}

async function main() {
  const db = await collections();
  const adminCount = await db.admins.countDocuments({ active: true });
  if (!adminCount) {
    throw new Error(
      'Nenhum administrador ativo encontrado. O reset foi cancelado para não bloquear o acesso.'
    );
  }

  if (!FORCE) {
    const ok = await confirm();
    if (!ok) {
      console.log('Reset cancelado. Nada foi alterado.');
      process.exit(0);
    }
  }

  console.log(`Zerando dados operacionais de "${db.db.databaseName}"...`);

  await withTransaction(async (session) => {
    for (const name of OPERATIONAL_COLLECTIONS) {
      await db[name].deleteMany({}, { session });
    }
  });

  await ensureIndexes();

  const counts = {};
  for (const name of [
    'admins',
    'members',
    'events',
    'eventParticipants',
    'pointTransactions',
    'rewards',
    'redemptions',
    'seasons',
    'auditLogs',
    'adminSessions',
    'rateLimits',
  ]) {
    counts[name] = await db[name].countDocuments();
  }

  console.log('');
  console.log('NavozCoin zerado com sucesso.');
  console.log(`  Administradores preservados: ${counts.admins}`);
  console.log(`  Membros: ${counts.members}`);
  console.log(`  Eventos: ${counts.events}`);
  console.log(`  Transações: ${counts.pointTransactions}`);
  console.log(`  Presentes: ${counts.rewards}`);
  console.log(`  Resgates: ${counts.redemptions}`);
  console.log(`  Temporadas: ${counts.seasons}`);
  console.log(`  Auditoria: ${counts.auditLogs}`);
  console.log(`  Sessões ativas: ${counts.adminSessions}`);
  console.log('');
  console.log('Faça login novamente para iniciar a operação.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Falha ao zerar o sistema:', error.message);
    process.exit(1);
  });
