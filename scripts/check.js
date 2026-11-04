'use strict';

/**
 * Diagnóstico do NavozCoin.
 * Verifica conexão, coleções, índices, administrador, temporada ativa e a
 * integridade entre carteiras e o ledger financeiro.
 *
 * Uso: npm run check
 */

const { loadEnv } = require('./load-env');

loadEnv();

const { connect, ensureIndexes } = require('../server/db');

async function main() {
  const db = await connect();
  console.log(`Banco: ${db.databaseName}`);
  console.log('Conexão Atlas: OK');
  await ensureIndexes();
  console.log('Índices: OK');

  const required = [
    'admins',
    'adminSessions',
    'members',
    'events',
    'eventParticipants',
    'pointTransactions',
    'rewards',
    'redemptions',
    'seasons',
    'auditLogs',
  ];

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((item) => item.name));
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) {
    throw new Error(`Coleções ausentes: ${missing.join(', ')}. Execute npm run seed.`);
  }

  const admin = await db.collection('admins').findOne({ active: true });
  if (!admin) {
    throw new Error('Nenhum administrador ativo. Execute npm run seed.');
  }
  console.log(`Administrador ativo: ${admin.username}`);

  const activeSeasons = await db.collection('seasons').countDocuments({ status: 'active' });
  if (activeSeasons > 1) {
    throw new Error('Há mais de uma temporada ativa. Ative apenas uma.');
  }
  console.log(`Temporada ativa: ${activeSeasons ? 'sim' : 'nenhuma'}`);

  const [memberTotals] = await db
    .collection('members')
    .aggregate([
      {
        $group: {
          _id: null,
          balance: { $sum: '$balance' },
          reserved: { $sum: '$reserved' },
          earned: { $sum: '$totalEarned' },
          spent: { $sum: '$totalSpent' },
        },
      },
    ])
    .toArray();

  const [ledgerTotals] = await db
    .collection('pointTransactions')
    .aggregate([
      {
        $group: {
          _id: null,
          balance: { $sum: '$balanceDelta' },
          reserved: { $sum: '$reservedDelta' },
          earned: { $sum: '$rankingDelta' },
          spent: { $sum: '$spentDelta' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const members = memberTotals || { balance: 0, reserved: 0, earned: 0, spent: 0 };
  const ledger = ledgerTotals || { balance: 0, reserved: 0, earned: 0, spent: 0, count: 0 };

  const checks = [
    ['saldo', members.balance, ledger.balance],
    ['reservado', members.reserved, ledger.reserved],
    ['conquistado', members.earned, ledger.earned],
    ['resgatado', members.spent, ledger.spent],
  ];
  let mismatch = false;
  for (const [label, memberValue, ledgerValue] of checks) {
    if (Number(memberValue) !== Number(ledgerValue)) {
      mismatch = true;
      console.error(`  DIVERGÊNCIA ${label}: carteiras=${memberValue} ledger=${ledgerValue}`);
    }
  }

  const pendingReservedAgg = await db
    .collection('redemptions')
    .aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$totalPoints' } } },
    ])
    .toArray();
  const pendingReserved = (pendingReservedAgg[0] && pendingReservedAgg[0].total) || 0;
  if (pendingReserved !== members.reserved) {
    mismatch = true;
    console.error(
      `  DIVERGÊNCIA reservas: resgates pendentes=${pendingReserved} carteiras=${members.reserved}`
    );
  }

  if (mismatch) throw new Error('Ledger inconsistente. Verifique o banco antes de continuar.');

  console.log('Ledger: OK');
  console.log(
    `  ${ledger.count} transações · saldo ${members.balance} · reservado ${members.reserved} · conquistado ${members.earned} · resgatado ${members.spent}`
  );

  const counts = await Promise.all(
    ['members', 'events', 'rewards', 'redemptions', 'seasons', 'auditLogs'].map(async (name) => [
      name,
      await db.collection(name).countDocuments(),
    ])
  );
  console.log(`Registros: ${counts.map(([name, count]) => `${name}=${count}`).join(' · ')}`);
  console.log('\nDiagnóstico concluído sem erros.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nFalha no diagnóstico:', error.message);
    process.exit(1);
  });
