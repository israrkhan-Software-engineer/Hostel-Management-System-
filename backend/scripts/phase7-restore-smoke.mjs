import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const user = 'hms_restore_check';
const password = `smoke-${randomUUID()}`;
const container = `hms-restore-smoke-${randomUUID().slice(0, 8)}`;
const image = process.env.HMS_RESTORE_TEST_POSTGRES_IMAGE ?? 'postgres:16';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hms-restore-smoke-'));
let containerCreated = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function docker(...args) {
  return run('docker', args);
}

try {
  docker(
    'run',
    '--detach',
    '--name',
    container,
    '--env',
    `POSTGRES_USER=${user}`,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    image,
  );
  containerCreated = true;

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', [
      'exec',
      container,
      'psql',
      '-h',
      '127.0.0.1',
      '-At',
      '-U',
      user,
      '-d',
      'postgres',
      '-c',
      'SELECT 1',
    ], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === '1') {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Disposable PostgreSQL container did not become ready within 60 seconds.');

  docker('exec', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres',
    '-c', 'CREATE DATABASE hms_restore_source');
  docker('exec', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres',
    '-c', 'CREATE DATABASE hms_restore_target');
  docker('exec', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'hms_restore_source',
    '-c', "CREATE TABLE smoke_marker (value text PRIMARY KEY); INSERT INTO smoke_marker VALUES ('restore-round-trip-ok')");

  const dump = docker(
    'exec',
    container,
    'pg_dump',
    '--host',
    '127.0.0.1',
    '--no-owner',
    '-U',
    user,
    '-d',
    'hms_restore_source',
  );
  const dumpPath = path.join(tempDir, 'synthetic.sql');
  await writeFile(dumpPath, dump, 'utf8');
  if (!dump.trim()) throw new Error('Synthetic database dump was empty.');

  run('docker', [
    'exec',
    '-i',
    container,
    'psql',
    '-h',
    '127.0.0.1',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    user,
    '-d',
    'hms_restore_target',
  ], { input: dump });

  const restored = docker(
    'exec',
    container,
    'psql',
    '-h',
    '127.0.0.1',
    '-At',
    '-U',
    user,
    '-d',
    'hms_restore_target',
    '-c',
    'SELECT value FROM smoke_marker',
  ).trim();
  if (restored !== 'restore-round-trip-ok') {
    throw new Error('Restored synthetic marker did not match the source database.');
  }

  console.log('PASS: synthetic PostgreSQL dump restored and verified in an isolated disposable database.');
  console.log('No application database or user data was accessed.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (containerCreated) {
    const cleanup = spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    if (cleanup.status !== 0) {
      console.error(`Cleanup warning: could not remove disposable container ${container}.`);
      process.exitCode = 1;
    }
  }
  await rm(tempDir, { recursive: true, force: true });
}
