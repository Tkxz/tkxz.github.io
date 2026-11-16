import { randomUUID } from 'node:crypto';
import { normalizeRut } from './auth.mjs';

const schoolDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
});
const conditions = ['Nuevo', 'Bueno', 'Regular', 'Deteriorado'];

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function requireRole(actor, ...roles) {
  if (!actor) fail(401, 'authentication_required', 'Inicia sesión para continuar.');
  if (!roles.includes(actor.role)) fail(403, 'forbidden', 'No tienes permisos para realizar esta acción.');
}

function textField(value, label, { min = 1, max = 100 } = {}) {
  if (min === 0 && value === undefined) return '';
  const text = typeof value === 'string' ? value.trim() : '';
  if ((value !== undefined && typeof value !== 'string') || text.length < min || text.length > max) {
    fail(400, 'invalid_field', `${label} debe tener entre ${min} y ${max} caracteres.`);
  }
  return text;
}

function integerField(value, label, min, max) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(400, 'invalid_field', `${label} debe ser un número entero entre ${min} y ${max}.`);
  }
  return number;
}

function dateField(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value) return value;
  }
  fail(400, 'invalid_date', 'Indica fechas válidas para el préstamo y la devolución.');
}

function dueAfterTwoWeeks(today) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

function findRecord(records, id, label) {
  const record = records.find((item) => item.id === id);
  if (!record) fail(404, 'not_found', `${label} no existe.`);
  return record;
}

function reviewWords(text) {
  return text.normalize('NFKD').toLocaleLowerCase('es-CL')
    .replace(/[\p{M}\p{Cf}]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function createReviewFilter(expressions) {
  if (!Array.isArray(expressions) || expressions.some((value) => typeof value !== 'string' || !reviewWords(value))) {
    throw new TypeError('La configuración del filtro de reseñas debe ser una lista de expresiones válidas.');
  }
  const terms = [...new Set(expressions.map((value) => ` ${reviewWords(value)} `))];
  return (comment) => {
    const normalized = ` ${reviewWords(comment)} `;
    if (terms.some((term) => normalized.includes(term))) {
      fail(422, 'prohibited_expression', 'Revisa el texto de tu reseña y elimina las obscenidades o los insultos antes de guardarla.');
    }
  };
}

function validateBook(input, books, previous) {
  const isbn = textField(input.isbn, 'El ISBN', { max: 20 });
  const isbnKey = (value) => value.replace(/[\s-]+/g, '').toUpperCase();
  if (books.some((book) => book.id !== previous?.id && isbnKey(book.isbn) === isbnKey(isbn))) {
    fail(409, 'duplicate_isbn', 'Ya existe un libro con ese ISBN.');
  }
  const total = integerField(input.total, 'El total de ejemplares', 0, 10000);
  const checkedOut = previous ? previous.total - previous.available : 0;
  if (total < checkedOut) {
    fail(409, 'insufficient_total', 'El total no puede ser inferior a los ejemplares prestados.');
  }
  if (!conditions.includes(input.condition)) fail(400, 'invalid_condition', 'Selecciona un estado físico válido.');
  return {
    title: textField(input.title, 'El título', { max: 120 }),
    author: textField(input.author, 'El autor'),
    isbn,
    publisher: textField(input.publisher, 'La editorial'),
    year: integerField(input.year, 'El año de publicación', 0, 2100),
    category: textField(input.category, 'La categoría', { max: 50 }),
    description: textField(input.description, 'La descripción', { min: 0, max: 600 }),
    total,
    available: total - checkedOut,
    condition: input.condition,
  };
}

function auditEntry(state, actor, now, action, type, id, label) {
  const { id: actorId, identifier, name, role } = actor;
  state.audit.push({
    id: randomUUID(),
    at: now.toISOString(),
    action,
    target: { id, type, label },
    actor: { id: actorId, identifier, name, role },
  });
}

function isReturned(loan) {
  return Boolean(loan.returnedAt) || loan.status === 'Devuelto';
}

function catalogBook(book) {
  const { id, title, author, category, age, pages, cover, description, isbn, publisher, year, available, condition } = book;
  return { id, title, author, category, age, pages, cover, description, isbn, publisher, year, available, condition };
}

function publicLoan(loan, today) {
  const { id, user, bookId, bookTitle, loanDate, dueDate, returnedAt } = loan;
  const status = isReturned(loan) ? 'Devuelto' : dueDate < today ? 'Vencido' : 'Activo';
  return { id, user, bookId, bookTitle, loanDate, dueDate, returnedAt, status };
}

function publicRequest(request) {
  const { id, type, student, bookId, bookTitle, loanId, status, createdAt } = request;
  return { id, type, student, bookId, bookTitle, loanId, status, createdAt };
}

function publicReview(review, actor) {
  const { id, user, bookId, bookTitle, rating, comment, createdAt, updatedAt } = review;
  return { id, user, bookId, bookTitle, rating, comment, createdAt, updatedAt, own: review.ownerId === actor.id };
}

function availableBook(state, id) {
  const book = findRecord(state.books, id, 'El libro');
  if (book.available < 1) fail(409, 'book_unavailable', 'Este libro no tiene ejemplares disponibles.');
  return book;
}

function issueLoan(state, book, { user, studentId, loanDate, dueDate }, today) {
  const loan = {
    id: randomUUID(),
    user,
    studentId,
    bookId: book.id,
    bookTitle: book.title,
    loanDate,
    dueDate,
    returnedAt: null,
    status: dueDate < today ? 'Vencido' : 'Activo',
  };
  book.available -= 1;
  state.loans.push(loan);
  return loan;
}

function registerReturn(state, loan, today) {
  if (isReturned(loan)) fail(409, 'already_returned', 'Este préstamo ya fue devuelto.');
  const book = findRecord(state.books, loan.bookId, 'El libro asociado al préstamo');
  book.available = Math.min(book.total, book.available + 1);
  loan.returnedAt = today;
  loan.status = 'Devuelto';
  for (const request of state.requests) {
    if (request.type === 'return' && request.loanId === loan.id && request.status === 'Pendiente') {
      request.status = 'Aprobada';
    }
  }
  return book;
}

export function createLibraryService(repository, { prohibitedExpressions, clock = () => new Date() }) {
  const checkReview = createReviewFilter(prohibitedExpressions);

  function reviewFields(state, actor, input, previous) {
    const book = state.books.find((item) => item.id === input.bookId);
    if (!book && (!previous || input.bookId !== previous.bookId)) fail(404, 'not_found', 'El libro no existe.');
    const comment = textField(input.comment, 'El comentario', { min: 5, max: 600 });
    checkReview(comment);
    if (state.reviews.some((review) => review.ownerId === actor.id && review.bookId === input.bookId && review.id !== previous?.id)) {
      fail(409, 'duplicate_review', 'Ya tienes una reseña de este libro. Puedes editarla.');
    }
    return {
      bookId: input.bookId,
      bookTitle: book?.title ?? previous.bookTitle,
      rating: integerField(input.rating, 'La calificación', 1, 5),
      comment,
    };
  }

  return {
    async state(actor) {
      requireRole(actor, 'student', 'teacher', 'admin');
      const state = await repository.read();
      const today = schoolDate.format(clock());
      const visibleToActor = (record) => actor.role === 'admin' || (actor.role === 'student' && record.studentId === actor.id);
      return {
        books: actor.role === 'admin' ? state.books : state.books.map(catalogBook),
        loans: state.loans.filter(visibleToActor).map((loan) => publicLoan(loan, today)),
        reviews: state.reviews.map((review) => publicReview(review, actor)),
        requests: state.requests.filter(visibleToActor).map(publicRequest),
      };
    },

    async audit(actor) {
      requireRole(actor, 'admin');
      const state = await repository.read();
      return [...state.audit].reverse();
    },

    async createBook(actor, input) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const now = clock();
        const book = {
          ...validateBook(input, state.books),
          id: randomUUID(), cover: 'cover-1', age: 'Lectura general', pages: '', registeredAt: now.toISOString(),
        };
        state.books.push(book);
        auditEntry(state, actor, now, 'Crear libro', 'libro', book.id, book.title);
      });
    },

    async editBook(actor, id, input) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const book = findRecord(state.books, id, 'El libro');
        Object.assign(book, validateBook(input, state.books, book));
        auditEntry(state, actor, clock(), 'Editar libro', 'libro', book.id, book.title);
      });
    },

    async deleteBook(actor, id) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const book = findRecord(state.books, id, 'El libro');
        if (state.loans.some((loan) => loan.bookId === id && !isReturned(loan))) {
          fail(409, 'active_loans', 'No puedes eliminar un libro con préstamos activos.');
        }
        // Keep the title visible on reviews and past movements once the catalog entry is gone.
        for (const record of [...state.loans, ...state.reviews, ...state.requests]) {
          if (record.bookId === id) record.bookTitle = book.title;
        }
        const now = clock();
        for (const request of state.requests) {
          if (request.bookId === id && request.status === 'Pendiente') {
            request.status = 'Rechazada';
            auditEntry(state, actor, now, 'Rechazar petición', 'petición', request.id, book.title);
          }
        }
        state.books = state.books.filter((record) => record.id !== id);
        auditEntry(state, actor, now, 'Eliminar libro', 'libro', book.id, book.title);
      });
    },

    async createReview(actor, input) {
      requireRole(actor, 'student', 'teacher', 'admin');
      return repository.update((state) => {
        const fields = reviewFields(state, actor, input);
        state.reviews.push({
          ...fields, id: randomUUID(), ownerId: actor.id, user: actor.name,
          createdAt: clock().toISOString(), updatedAt: null,
        });
      });
    },

    async editReview(actor, id, input) {
      requireRole(actor, 'student', 'teacher', 'admin');
      return repository.update((state) => {
        const review = findRecord(state.reviews, id, 'La reseña');
        if (review.ownerId !== actor.id) fail(403, 'forbidden', 'Solo puedes editar tus propias reseñas.');
        Object.assign(review, reviewFields(state, actor, input, review), { updatedAt: clock().toISOString() });
      });
    },

    async deleteReview(actor, id) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const review = findRecord(state.reviews, id, 'La reseña');
        const title = state.books.find((book) => book.id === review.bookId)?.title ?? review.bookTitle;
        const label = title ? `Reseña de ${review.user} sobre «${title}»` : `Reseña de ${review.user}`;
        state.reviews = state.reviews.filter((record) => record.id !== id);
        auditEntry(state, actor, clock(), 'Eliminar reseña', 'reseña', id, label);
      });
    },

    async createLoan(actor, input) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const book = availableBook(state, input.bookId);
        const loanDate = dateField(input.loanDate);
        const dueDate = dateField(input.dueDate);
        if (dueDate < loanDate) fail(400, 'invalid_date_range', 'La fecha límite debe ser igual o posterior al préstamo.');
        const studentRut = textField(input.studentRut, 'El RUT', { min: 0, max: 20 });
        let student;
        if (studentRut) {
          const identifier = normalizeRut(studentRut);
          if (!identifier) fail(400, 'invalid_rut', 'Ingresa un RUT de estudiante válido.');
          student = state.users.find((user) => user.role === 'student' && user.identifier === identifier);
          if (!student) fail(404, 'student_not_found', 'No existe una cuenta de estudiante con ese RUT.');
        }
        const user = student?.name ?? textField(input.user, 'El nombre del solicitante');
        const now = clock();
        const loan = issueLoan(state, book, { user, studentId: student?.id ?? null, loanDate, dueDate }, schoolDate.format(now));
        auditEntry(state, actor, now, 'Registrar préstamo', 'préstamo', loan.id, book.title);
      });
    },

    async returnLoan(actor, id) {
      requireRole(actor, 'admin');
      return repository.update((state) => {
        const loan = findRecord(state.loans, id, 'El préstamo');
        const now = clock();
        const book = registerReturn(state, loan, schoolDate.format(now));
        auditEntry(state, actor, now, 'Registrar devolución', 'préstamo', id, book.title);
      });
    },

    async createRequest(actor, input) {
      requireRole(actor, 'student');
      return repository.update((state) => {
        if (input.type !== 'loan' && input.type !== 'return') fail(400, 'invalid_request_type', 'Selecciona un tipo de solicitud válido.');
        let book;
        let loan;
        if (input.type === 'loan') {
          book = availableBook(state, input.bookId);
        } else {
          loan = findRecord(state.loans, input.loanId, 'El préstamo');
          if (loan.studentId !== actor.id) fail(403, 'forbidden', 'Solo puedes solicitar la devolución de tus propios préstamos.');
          if (isReturned(loan)) fail(409, 'already_returned', 'Este préstamo ya fue devuelto.');
          book = findRecord(state.books, loan.bookId, 'El libro');
        }
        const duplicate = state.requests.some((request) => {
          if (request.status !== 'Pendiente' || request.type !== input.type || request.studentId !== actor.id) return false;
          return loan ? request.loanId === loan.id : request.bookId === book.id;
        });
        if (duplicate) fail(409, 'duplicate_request', 'Ya tienes una petición pendiente para este movimiento.');
        state.requests.push({
          id: randomUUID(), type: input.type, studentId: actor.id, student: actor.name,
          bookId: book.id, bookTitle: book.title, loanId: loan?.id, status: 'Pendiente',
          createdAt: schoolDate.format(clock()),
        });
      });
    },

    async resolveRequest(actor, id, input) {
      requireRole(actor, 'admin');
      if (typeof input.approve !== 'boolean') fail(400, 'invalid_decision', 'Indica si quieres aprobar o rechazar la petición.');
      return repository.update((state) => {
        const request = findRecord(state.requests, id, 'La petición');
        if (request.status !== 'Pendiente') fail(409, 'request_resolved', 'Esta petición ya fue resuelta.');
        const now = clock();
        const today = schoolDate.format(now);
        if (input.approve && request.type === 'loan') {
          const book = availableBook(state, request.bookId);
          issueLoan(state, book, { user: request.student, studentId: request.studentId, loanDate: today, dueDate: dueAfterTwoWeeks(today) }, today);
        }
        if (input.approve && request.type === 'return') {
          const loan = findRecord(state.loans, request.loanId, 'El préstamo');
          registerReturn(state, loan, today);
        }
        request.status = input.approve ? 'Aprobada' : 'Rechazada';
        const title = state.books.find((item) => item.id === request.bookId)?.title ?? request.bookTitle ?? 'Libro';
        auditEntry(state, actor, now, input.approve ? 'Aprobar petición' : 'Rechazar petición', 'petición', id, title);
      });
    },
  };
}
