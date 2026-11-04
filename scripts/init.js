'use strict';

/**
 * Inicializa o NavozCoin vazio:
 * - cria as collections e os índices;
 * - garante o administrador definido em ADMIN_USERNAME / ADMIN_PASSWORD;
 * - NÃO cria membros, eventos, temporadas ou movimentações.
 *
 * Uso: npm run init
 * É idempotente: pode rodar novamente sem duplicar o administrador.
 */

const bcrypt = require('bcryptjs');
const { loadEnv } = require('./load-env');

loadEnv();

const { collections, ensureIndexes } = require('../server/db');

async function main() {
  const db = await collections();
  await ensureIndexes();

  const username = process.env.ADMIN_USERNAME || 'Navoz';
  const password = process.env.ADMIN_PASSWORD || 'Navoz';
  const displayName = process.env.ADMIN_DISPLAY_NAME || username;
  const existing = await db.admins.findOne({ usernameLower: username.toLowerCase() });

  if (existing) {
    console.log(`Administrador "${existing.username}" já existe. Nada foi duplicado.`);
  } else {
    const now = new Date();
    await db.admins.insertOne({
      username,
      usernameLower: username.toLowerCase(),
      displayName,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'owner',
      active: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Administrador "${username}" criado.`);
    console.log('Troque a senha no primeiro acesso.');
  }

  const counts = {
    admins: await db.admins.countDocuments(),
    members: await db.members.countDocuments(),
    events: await db.events.countDocuments(),
    seasons: await db.seasons.countDocuments(),
  };

  console.log('');
  console.log('NavozCoin inicializado no estado vazio.');
  console.log(`  Banco: ${db.db.databaseName}`);
  console.log(`  Administradores: ${counts.admins}`);
  console.log(`  Membros: ${counts.members}`);
  console.log(`  Eventos: ${counts.events}`);
  console.log(`  Temporadas: ${counts.seasons}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Falha ao inicializar:', error.message);
    process.exit(1);
  });
