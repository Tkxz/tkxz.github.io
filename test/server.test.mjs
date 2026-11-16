import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAuthService } from '../server/auth.mjs';
import { createHttpServer } from '../server/http.mjs';
import { createLibraryService } from '../server/library.mjs';
import { createRepository } from '../server/storage.mjs';

const prohibitedExpressions = JSON.parse(await readFile(
  new URL('../config/prohibited-expressions.json', import.meta.url), 'utf8',
));
const student = {
  role: 'student', identifier: '12.345.678-5', name: 'Alex Pruebas', password: 'contraseña de prueba para estudiante',
};
const teacher = {
  role: 'teacher', identifier: ' Docente@GMAIL.COM ', name: 'Profesora de prueba', password: 'contraseña de prueba para docente',
};
const admin = {
  role: 'admin', identifier: 'biblioteca@example.test', name: 'Bibliotecaria de prueba', password: 'contraseña de prueba para administración',
};
const sampleBook = {
  title: 'Libro de prueba', isbn: '9780000000001', author: 'Autora de prueba', publisher: 'Editorial de prueba',
  year: 2026, category: 'Narrativa', description: 'Un libro para probar el inventario.', total: 1, condition: 'Nuevo',
};

async function openLibrary(t, { file = ':memory:', now = Date.now } = {}) {
  const repository = await createRepository({ file });
  const auth = createAuthService(repository, { now });
  const library = createLibraryService(repository, { prohibitedExpressions, clock: () => new Date(now()) });
  const server = createHttpServer({ auth, library });
  let shutdown;
  function close() {
    shutdown ??= (async () => {
      try {
        if (server.listening) await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      } finally {
        await repository.close();
      }
    })();
    return shutdown;
  }
  t.after(close);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', cookie, body, actorId, status = 200 } = {}) {
    const headers = new Headers();
    if (cookie) headers.set('Cookie', cookie);
    if (method !== 'GET') headers.set('Origin', origin);
    if (body) headers.set('Content-Type', 'application/json');
    if (actorId) headers.set('X-Biblioteca-Actor', actorId);
    const response = await fetch(`${origin}/api/${path}`, { method, headers, body: JSON.stringify(body) });
    const content = await response.text();
    assert.equal(response.status, status, `${method} /api/${path}`);
    return { headers: response.headers, data: content ? JSON.parse(content) : null };
  }

  async function login({ role, identifier, password }) {
    const { headers, data } = await request('login', { method: 'POST', body: { role, identifier, password } });
    const setCookie = headers.get('Set-Cookie');
    assert.match(setCookie, /; HttpOnly\b/);
    assert.match(setCookie, /; SameSite=Strict\b/);
    return { user: data.user, cookie: setCookie.split(';')[0] };
  }

  const state = async cookie => (await request('state', { cookie })).data;
  return { repository, auth, request, login, state, close };
}

test('Inicio de sesión, revocación y bloqueo persistente en SQLite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'biblioteca-test-'));
  const file = join(directory, 'biblioteca.sqlite');
  let app;
  t.after(async () => {
    await app?.close();
    await rm(file, { force: true });
    await rmdir(directory);
  });

  let time = Date.UTC(2026, 0, 15, 12);
  const now = () => time;
  app = await openLibrary(t, { file, now });
  const user = await app.auth.createUser(student);
  await assert.rejects(app.auth.createUser({ ...teacher, identifier: 'docente@example.test' }), { status: 400 });
  await app.auth.createUser(teacher);

  await app.request('state', { status: 401 });
  await app.request('audit', { status: 401 });
  for (const credentials of [{ ...student, identifier: '12.345.678-9' }, { ...teacher, role: 'admin' }]) {
    await app.request('login', { method: 'POST', body: credentials, status: 401 });
  }
  const session = await app.login({ ...student, identifier: '123456785' });
  assert.deepEqual(session.user, user);
  assert.equal(user.identifier, '12345678-5');
  assert.equal((await app.login(teacher)).user.identifier, 'docente@gmail.com');
  assert.equal(Object.hasOwn(user, 'passwordHash'), false);
  const { users, sessions } = await app.repository.read();
  assert.ok(users.every(account => account.passwordHash.startsWith('scrypt-v1$')));
  assert.ok(sessions.every(session => /^[a-f\d]{64}$/.test(session.tokenHash)));
  assert.ok(!JSON.stringify(users).includes(student.password));
  assert.ok(!JSON.stringify(sessions).includes(session.cookie.split('=')[1]));

  const book = (await app.state(session.cookie)).books[0];
  const review = { bookId: book.id, rating: 4, comment: 'Me gustó la historia y sus personajes.' };
  await app.request('reviews', { method: 'POST', body: review, cookie: session.cookie, status: 204 });
  for (let attempt = 0; attempt < 5; attempt++) {
    await app.request('login', { method: 'POST', body: { ...student, password: 'incorrecta' }, status: 401 });
  }

  await app.close();
  app = await openLibrary(t, { file, now });
  const restored = await app.state(session.cookie);
  assert.deepEqual(restored.user, user);
  assert.equal(restored.reviews[0].comment, review.comment);
  const blocked = await app.request('login', { method: 'POST', body: student, status: 429 });
  assert.equal(blocked.headers.get('Retry-After'), '900');

  time += 15 * 60 * 1000;
  const newSession = await app.login(student);
  assert.deepEqual(newSession.user, user);
  await app.request('logout', { method: 'POST', cookie: newSession.cookie, status: 204 });
  await app.request('state', { cookie: newSession.cookie, status: 401 });
});

test('Reseñas validadas al publicar y editar e historial exclusivo de administración', async t => {
  const app = await openLibrary(t);
  for (const account of [student, teacher, admin]) await app.auth.createUser(account);
  const reader = await app.login(student);
  const professor = await app.login(teacher);
  const staff = await app.login(admin);
  const stale = await app.request('books', {
    method: 'POST', cookie: staff.cookie, body: sampleBook, actorId: reader.user.id, status: 409,
  });
  assert.equal(stale.data.code, 'SESSION_CHANGED');
  for (const { cookie } of [reader, professor]) {
    await app.request('audit', { cookie, status: 403 });
    await app.request('books', { method: 'POST', cookie, body: sampleBook, status: 403 });
  }

  await app.request('books', { method: 'POST', cookie: staff.cookie, body: sampleBook, status: 204 });
  const book = (await app.state(reader.cookie)).books.find(({ isbn }) => isbn === sampleBook.isbn);
  const title = 'Libro de prueba corregido';
  await app.request(`books/${book.id}`, {
    method: 'PATCH', cookie: staff.cookie, body: { ...sampleBook, title }, status: 204,
  });

  const review = { bookId: book.id, rating: 5, comment: 'Excelente lectura para compartir en clase.' };
  const prohibited = { ...review, comment: 'Qué IMBÉCIL es un personaje.' };
  const rejected = await app.request('reviews', { method: 'POST', cookie: reader.cookie, body: prohibited, status: 422 });
  assert.match(rejected.data.message, /Revisa el texto/);
  assert.equal((await app.state(reader.cookie)).reviews.length, 0);
  await app.request('reviews', {
    method: 'POST', cookie: reader.cookie, body: { ...review, user: admin.name, password: admin.password }, status: 204,
  });
  const [saved] = (await app.state(reader.cookie)).reviews;
  assert.equal(saved.user, student.name);
  assert.equal(saved.own, true);
  assert.equal((await app.state(professor.cookie)).reviews[0].own, false);

  const reviewPath = `reviews/${saved.id}`;
  await app.request(reviewPath, { method: 'PATCH', cookie: professor.cookie, body: review, status: 403 });
  await app.request(reviewPath, { method: 'PATCH', cookie: reader.cookie, body: prohibited, status: 422 });
  assert.deepEqual((await app.state(reader.cookie)).reviews[0], saved);
  const edited = { ...review, comment: 'Recomiendo este libro a quienes disfrutan la narrativa.' };
  await app.request(reviewPath, { method: 'PATCH', cookie: reader.cookie, body: edited, status: 204 });
  assert.equal((await app.state(reader.cookie)).reviews[0].comment, edited.comment);
  await app.request(reviewPath, { method: 'DELETE', cookie: professor.cookie, status: 403 });
  await app.request(reviewPath, { method: 'DELETE', cookie: staff.cookie, status: 204 });
  assert.equal((await app.state(reader.cookie)).reviews.length, 0);
  await app.request(`books/${book.id}`, { method: 'DELETE', cookie: staff.cookie, status: 204 });
  assert.ok(!(await app.state(reader.cookie)).books.some(({ id }) => id === book.id));

  const { data: { entries } } = await app.request('audit', { cookie: staff.cookie });
  assert.deepEqual(entries.map(({ action }) => action), ['Eliminar libro', 'Eliminar reseña', 'Editar libro', 'Crear libro']);
  assert.deepEqual(entries.map(({ target }) => target.id), [book.id, saved.id, book.id, book.id]);
  assert.equal(entries[0].target.label, title);
  assert.match(entries[1].target.label, /Reseña de Alex Pruebas/);
  for (const entry of entries) {
    assert.deepEqual(entry.actor, staff.user);
    assert.ok(!Number.isNaN(Date.parse(entry.at)));
  }
  const audit = JSON.stringify(entries);
  for (const secret of ['passwordHash', admin.password, student.password, staff.cookie.split('=')[1]]) {
    assert.ok(!audit.includes(secret));
  }
});

test('Peticiones y préstamos asociados a la cuenta autenticada', async t => {
  const app = await openLibrary(t);
  const otherStudent = { ...student, identifier: '11.111.111-1' };
  for (const account of [student, otherStudent, admin]) await app.auth.createUser(account);
  const reader = await app.login(student);
  const other = await app.login(otherStudent);
  const staff = await app.login(admin);
  const book = (await app.state(reader.cookie)).books.find(({ available }) => available > 0);
  const body = { type: 'loan', bookId: book.id };
  await app.request('requests', { method: 'POST', cookie: reader.cookie, body, status: 204 });
  await app.request('requests', { method: 'POST', cookie: reader.cookie, body, status: 409 });
  assert.deepEqual((await app.state(other.cookie)).requests, []);

  const [pending] = (await app.state(staff.cookie)).requests;
  assert.equal(pending.status, 'Pendiente');
  const approval = { method: 'PATCH', cookie: staff.cookie, body: { approve: true }, status: 204 };
  await app.request(`requests/${pending.id}`, { ...approval, cookie: reader.cookie, status: 403 });
  await app.request(`requests/${pending.id}`, approval);
  const borrowed = await app.state(reader.cookie);
  const [loan] = borrowed.loans;
  assert.equal(loan.status, 'Activo');
  assert.equal(borrowed.books.find(({ id }) => id === book.id).available, book.available - 1);
  assert.deepEqual((await app.state(other.cookie)).loans, []);

  const returned = { type: 'return', loanId: loan.id };
  await app.request('requests', { method: 'POST', cookie: other.cookie, body: returned, status: 403 });
  await app.request('requests', { method: 'POST', cookie: reader.cookie, body: returned, status: 204 });
  const returnRequest = (await app.state(staff.cookie)).requests.find(({ type }) => type === 'return');
  await app.request(`requests/${returnRequest.id}`, approval);
  const final = await app.state(reader.cookie);
  assert.equal(final.loans[0].status, 'Devuelto');
  assert.equal(final.books.find(({ id }) => id === book.id).available, book.available);
});
