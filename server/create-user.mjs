import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { Writable } from 'node:stream';
import { createAuthService, AuthError } from './auth.mjs';
import { createRepository } from './storage.mjs';

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Ejecuta este comando en una terminal interactiva.');
  }

  let muted = false;
  const terminal = new Writable({
    write(chunk, encoding, callback) {
      if (muted) callback();
      else stdout.write(chunk, encoding, callback);
    }
  });
  const prompt = createInterface({ input: stdin, output: terminal, terminal: true });
  const abort = new AbortController();
  prompt.on('close', () => abort.abort());
  prompt.on('SIGINT', () => prompt.close());
  const ask = text => prompt.question(text, { signal: abort.signal });

  async function askPassword(label) {
    stdout.write(label);
    muted = true;
    try {
      return await ask('');
    } finally {
      muted = false;
      stdout.write('\n');
    }
  }

  try {
    const role = (await ask('Rol (student, teacher o admin): ')).trim().toLowerCase();
    const identifierLabel = { student: 'RUT', teacher: 'Dirección de Gmail', admin: 'Correo electrónico' }[role];
    if (typeof identifierLabel !== 'string') throw new Error('Selecciona student, teacher o admin.');
    const name = await ask('Nombre completo: ');
    const identifier = await ask(`${identifierLabel}: `);
    const password = await askPassword('Contraseña (mínimo 12 caracteres): ');
    const confirmation = await askPassword('Repite la contraseña: ');
    if (confirmation !== password) throw new Error('Las contraseñas deben coincidir.');
    prompt.close();

    const repository = await createRepository();
    try {
      const account = await createAuthService(repository).createUser({ role, identifier, name, password });
      stdout.write(`Cuenta creada para ${account.name} (${account.role}).\n`);
    } finally {
      await repository.close();
    }
  } finally {
    prompt.close();
  }
}

try {
  await main();
} catch (error) {
  const message = error.name === 'AbortError' ? 'Creación de cuenta cancelada.' : error.message;
  stderr.write(`${error instanceof AuthError ? message : `Creación de cuenta: ${message}`}\n`);
  process.exitCode = 1;
}
