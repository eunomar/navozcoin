'use strict';

/**
 * Publicação assistida na Vercel.
 *
 * - carrega as credenciais do .env.local (que fica fora do Git);
 * - valida a conexão com o Atlas antes de publicar;
 * - envia automaticamente as variáveis de ambiente para Production e Preview;
 * - faz o deploy e testa /api/health no final.
 *
 * Uso:
 *   npm run deploy
 *   npm run deploy -- --dry-run
 *
 * Requer apenas autenticação na Vercel: o script chama `vercel login` se preciso.
 * Não é necessário abrir o dashboard para configurar variáveis.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadEnv } = require('./load-env');

loadEnv();

const ROOT = path.join(__dirname, '..');
const PROJECT = process.env.VERCEL_PROJECT || 'navozcoin';
const PRODUCTION_ORIGIN = (
  process.env.PRODUCTION_ORIGIN || `https://${PROJECT}.vercel.app`
).replace(/\/$/, '');
const DRY_RUN = process.argv.includes('--dry-run');
const VERCEL_VERSION = '65.11.0';
const RUNTIME_KEYS = ['MONGODB_URI', 'MONGODB_DB', 'APP_ORIGIN', 'APP_TIMEZONE'];

function fail(message) {
  console.error(`\n[deploy] ${message}`);
  process.exit(1);
}

function runVercel(args, { input, capture = false } = {}) {
  const localCli = path.join(ROOT, 'node_modules', 'vercel', 'dist', 'index.js');
  const useLocal = fs.existsSync(localCli);
  const command = useLocal
    ? process.execPath
    : process.platform === 'win32'
      ? 'npx.cmd'
      : 'npx';
  const commandArgs = useLocal
    ? [localCli, ...args]
    : ['--yes', `vercel@${VERCEL_VERSION}`, ...args];
  const options = {
    cwd: ROOT,
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
      VERCEL_DISABLE_UPDATE_CHECK: '1',
    },
    encoding: 'utf8',
    shell: !useLocal && process.platform === 'win32',
  };
  if (capture) {
    options.stdio = ['pipe', 'pipe', 'pipe'];
    if (input !== undefined) options.input = input;
  } else {
    options.stdio = input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit';
    if (input !== undefined) options.input = input;
  }
  const result = spawnSync(command, commandArgs, options);
  if (result.error) fail(`Não foi possível executar o Vercel CLI: ${result.error.message}`);
  return result;
}

function outputOf(result) {
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

async function preflight() {
  console.log('[deploy] Validando configuração local...');
  if (!fs.existsSync(path.join(ROOT, '.env.local'))) {
    fail('Crie o .env.local antes de publicar (veja .env.example).');
  }
  if (!process.env.MONGODB_URI) fail('MONGODB_URI não está definida no .env.local.');
  if (!process.env.MONGODB_DB) process.env.MONGODB_DB = 'navozcoin';
  process.env.APP_ORIGIN = PRODUCTION_ORIGIN;
  process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

  for (const key of RUNTIME_KEYS) {
    if (!process.env[key]) fail(`Variável obrigatória ausente: ${key}.`);
  }

  // A conexão real com o Atlas é validada antes do deploy.
  const { ping } = require('../server/db');
  try {
    await ping();
    console.log('[deploy] MongoDB Atlas: OK');
  } catch (error) {
    fail(
      `Não foi possível conectar ao Atlas com a URI local (${error.message}). ` +
        'Corrija o .env.local e tente novamente.'
    );
  }
}

function ensureLoggedIn() {
  console.log('[deploy] Verificando autenticação da Vercel...');
  let result = runVercel(['whoami'], { capture: true });
  if (result.status === 0) {
    console.log(`[deploy] Vercel: ${outputOf(result)}`);
    return;
  }

  console.log('[deploy] Você ainda não está autenticado. Abrindo o login da Vercel...');
  runVercel(['login']);
  result = runVercel(['whoami'], { capture: true });
  if (result.status !== 0) {
    fail('Login da Vercel não concluído. Rode `npx vercel@65.11.0 login` e tente novamente.');
  }
  console.log(`[deploy] Vercel: ${outputOf(result)}`);
}

function ensureLinked() {
  if (fs.existsSync(path.join(ROOT, '.vercel', 'project.json'))) {
    console.log('[deploy] Projeto Vercel já vinculado.');
    return;
  }
  console.log(`[deploy] Vinculando ao projeto "${PROJECT}"...`);
  const result = runVercel(
    ['link', '--yes', '--project', PROJECT],
    { capture: true }
  );
  if (result.status !== 0) {
    fail(
      `Não foi possível vincular o projeto "${PROJECT}". ` +
        'Rode `npx vercel link` manualmente e escolha o projeto correto.\n' +
        outputOf(result)
    );
  }
  console.log('[deploy] Projeto vinculado.');
}

function syncEnvironment(target) {
  console.log(`[deploy] Enviando variáveis para ${target}...`);
  for (const key of RUNTIME_KEYS) {
    // Remove a versão anterior (se existir) para permitir atualização limpa.
    runVercel(['env', 'rm', key, '--environment', target, '--yes'], { capture: true });
    const result = runVercel(
      ['env', 'add', key, '--environment', target, '--sensitive', '--yes'],
      { input: `${process.env[key]}\n`, capture: true }
    );
    if (result.status !== 0) {
      fail(`Falha ao configurar ${key} em ${target}: ${outputOf(result)}`);
    }
    console.log(`[deploy]   ${key}: OK`);
  }
}

async function checkDeploy(url) {
  console.log('[deploy] Aguardando a nova função responder...');
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const response = await fetch(`${url}/api/health`, { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.ok) {
        console.log('[deploy] Health check: OK — Atlas conectado.');
        console.log(`[deploy] Aplicação publicada em ${url}`);
        return;
      }
      if (data.error && data.error.reason === 'ATLAS_UNREACHABLE') {
        console.error(
          '\n[deploy] A função está publicada, mas o Atlas recusou a conexão a partir da Vercel.'
        );
        console.error(
          'No MongoDB Atlas, abra Network Access e adicione 0.0.0.0/0 (ou libere os IPs da Vercel).'
        );
        console.error(`Detalhe: ${JSON.stringify(data.checks || {})}`);
        process.exitCode = 2;
        return;
      }
      if (attempt === 6) {
        console.error(`[deploy] Health check não confirmou o banco: ${JSON.stringify(data)}`);
        process.exitCode = 2;
      }
    } catch (error) {
      if (attempt === 6) {
        console.error(`[deploy] Não foi possível consultar ${url}/api/health: ${error.message}`);
        process.exitCode = 2;
      }
    }
  }
}

async function main() {
  console.log('');
  console.log('  NAVOZCOIN — deploy assistido');
  console.log('  ----------------------------');
  await preflight();

  if (DRY_RUN) {
    console.log('');
    console.log('[deploy] DRY RUN concluído. Nada foi enviado para a Vercel.');
    console.log(`[deploy] Origem de produção: ${PRODUCTION_ORIGIN}`);
    RUNTIME_KEYS.forEach((key) => {
      const value = key === 'MONGODB_URI' ? '(oculta)' : process.env[key];
      console.log(`[deploy]   ${key}=${value}`);
    });
    return;
  }

  ensureLoggedIn();
  ensureLinked();
  syncEnvironment('production');
  syncEnvironment('preview');

  console.log('[deploy] Publicando em produção...');
  const deploy = runVercel(['deploy', '--prod', '--yes'], { capture: true });
  const output = outputOf(deploy);
  if (deploy.status !== 0) fail(`Falha no deploy:\n${output}`);
  const match = output.match(/https:\/\/[^\s]+\.vercel\.app/);
  const url = match ? match[0] : PRODUCTION_ORIGIN;
  console.log(`[deploy] Deploy concluído: ${url}`);

  await checkDeploy(url);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error('[deploy] Erro inesperado:', error);
    process.exit(1);
  });
