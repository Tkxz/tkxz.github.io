(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BibliotecaLocal = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const storageKey = "biblioteca-local-v1";
  const conditions = ["Nuevo", "Bueno", "Regular", "Deteriorado"];
  const schoolDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  });

  function failure(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
  }

  function generateId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeRut(value) {
    if (typeof value !== "string") return null;
    const parts = /^(\d{1,8}|\d{1,3}(?:\.\d{3}){1,2})-?([\dk])$/i.exec(value.trim());
    if (!parts) return null;
    const number = Number(parts[1].replaceAll(".", ""));
    if (number < 1 || number > 99999999) return null;
    let sum = 0;
    let factor = 2;
    for (let digits = number; digits > 0; digits = Math.floor(digits / 10)) {
      sum += (digits % 10) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const remainder = (11 - sum % 11) % 11;
    const verifier = remainder === 10 ? "K" : String(remainder);
    return verifier === parts[2].toUpperCase() ? `${number}-${verifier}` : null;
  }

  function normalizeIdentifier(role, identifier) {
    if (role === "student") return normalizeRut(identifier);
    if (role !== "admin" || typeof identifier !== "string") return null;
    const email = identifier.trim().toLowerCase();
    if (email.length > 254) return null;
    const [local, domain, extra] = email.split("@");
    if (extra !== undefined || !domain || local.length > 64) return null;
    if (!/^[a-z0-9_%+'-]+(?:\.[a-z0-9_%+'-]+)*$/.test(local)) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
    return email;
  }

  function publicUser({ id, identifier, role, name }) {
    return { id, identifier, role, name };
  }

  function textField(value, label, { min = 1, max = 100 } = {}) {
    if (min === 0 && value === undefined) return "";
    const text = typeof value === "string" ? value.trim() : "";
    if ((value !== undefined && typeof value !== "string") || text.length < min || text.length > max) {
      failure(400, "invalid_field", `${label} debe tener entre ${min} y ${max} caracteres.`);
    }
    return text;
  }

  function integerField(value, label, min, max) {
    const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(number) || number < min || number > max) {
      failure(400, "invalid_field", `${label} debe ser un número entero entre ${min} y ${max}.`);
    }
    return number;
  }

  function dateField(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T00:00:00Z`);
      if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value) return value;
    }
    failure(400, "invalid_date", "Indica fechas válidas para el préstamo y la devolución.");
  }

  function dueAfterTwoWeeks(today) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 14);
    return date.toISOString().slice(0, 10);
  }

  function findRecord(records, id, label) {
    const record = records.find((item) => item.id === id);
    if (!record) failure(404, "not_found", `${label} no existe.`);
    return record;
  }

  function reviewWords(text) {
    return text.normalize("NFKD").toLocaleLowerCase("es-CL")
      .replace(/[\p{M}\p{Cf}]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function checkReview(comment, expressions) {
    const normalized = ` ${reviewWords(comment)} `;
    if (expressions.some((expression) => normalized.includes(` ${reviewWords(expression)} `))) {
      failure(422, "prohibited_expression", "Revisa el texto de tu reseña y elimina las obscenidades o los insultos antes de guardarla.");
    }
  }

  function validateBook(input, books, previous) {
    const isbn = textField(input.isbn, "El ISBN", { max: 20 });
    const isbnKey = (value) => value.replace(/[\s-]+/g, "").toUpperCase();
    if (books.some((book) => book.id !== previous?.id && isbnKey(book.isbn) === isbnKey(isbn))) {
      failure(409, "duplicate_isbn", "Ya existe un libro con ese ISBN.");
    }
    const total = integerField(input.total, "El total de ejemplares", 0, 10000);
    const checkedOut = previous ? previous.total - previous.available : 0;
    if (total < checkedOut) failure(409, "insufficient_total", "El total no puede ser inferior a los ejemplares prestados.");
    if (!conditions.includes(input.condition)) failure(400, "invalid_condition", "Selecciona un estado físico válido.");
    return {
      title: textField(input.title, "El título", { max: 120 }),
      author: textField(input.author, "El autor"),
      isbn,
      publisher: textField(input.publisher, "La editorial"),
      year: integerField(input.year, "El año de publicación", 0, 2100),
      category: textField(input.category, "La categoría", { max: 50 }),
      description: textField(input.description, "La descripción", { min: 0, max: 600 }),
      total,
      available: total - checkedOut,
      condition: input.condition,
    };
  }

  function isReturned(loan) {
    return Boolean(loan.returnedAt) || loan.status === "Devuelto";
  }

  function catalogBook(book) {
    const { id, title, author, category, age, pages, cover, description, isbn, publisher, year, available, condition } = book;
    return { id, title, author, category, age, pages, cover, description, isbn, publisher, year, available, condition };
  }

  function publicLoan(loan, today) {
    const { id, user, bookId, bookTitle, loanDate, dueDate, returnedAt } = loan;
    const status = isReturned(loan) ? "Devuelto" : dueDate < today ? "Vencido" : "Activo";
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

  function requireRole(actor, ...roles) {
    if (!actor) failure(401, "authentication_required", "Inicia sesión para continuar.");
    if (!roles.includes(actor.role)) failure(403, "forbidden", "No tienes permisos para realizar esta acción.");
  }

  function auditEntry(state, actor, now, action, type, id, label, createId) {
    state.audit.push({
      id: createId(),
      at: now.toISOString(),
      action,
      target: { id, type, label },
      actor: publicUser(actor),
    });
  }

  function availableBook(state, id) {
    const book = findRecord(state.books, id, "El libro");
    if (book.available < 1) failure(409, "book_unavailable", "Este libro no tiene ejemplares disponibles.");
    return book;
  }

  function issueLoan(state, book, { user, studentId, loanDate, dueDate }, today, createId) {
    const loan = {
      id: createId(), user, studentId, bookId: book.id, bookTitle: book.title,
      loanDate, dueDate, returnedAt: null, status: dueDate < today ? "Vencido" : "Activo",
    };
    book.available -= 1;
    state.loans.push(loan);
    return loan;
  }

  function registerReturn(state, loan, today) {
    if (isReturned(loan)) failure(409, "already_returned", "Este préstamo ya fue devuelto.");
    const book = findRecord(state.books, loan.bookId, "El libro asociado al préstamo");
    book.available = Math.min(book.total, book.available + 1);
    loan.returnedAt = today;
    loan.status = "Devuelto";
    for (const request of state.requests) {
      if (request.type === "return" && request.loanId === loan.id && request.status === "Pendiente") request.status = "Aprobada";
    }
    return book;
  }

  function createLocalApp({ storage = globalThis.localStorage, seed = globalThis.BIBLIOTECA_DATA, now = () => new Date(), createId = generateId } = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("Este navegador no permite almacenamiento local. Abre la biblioteca en un navegador con localStorage habilitado.");
    }
    if (!seed || !Array.isArray(seed.initialBooks) || !Array.isArray(seed.demoAccounts) || !Array.isArray(seed.prohibitedExpressions)) {
      throw new Error("Faltan los datos locales de la biblioteca. Comprueba que data.js se haya cargado antes que local.js.");
    }

    function freshState() {
      return {
        books: structuredClone(seed.initialBooks),
        reviews: [],
        loans: [],
        requests: [],
        audit: [],
        users: structuredClone(seed.demoAccounts),
        sessionUserId: null,
      };
    }

    function readState() {
      const serialized = storage.getItem(storageKey);
      if (serialized === null) {
        const state = freshState();
        writeState(state);
        return state;
      }
      try {
        const state = JSON.parse(serialized);
        if (!state || !Array.isArray(state.books) || !Array.isArray(state.users)) throw new TypeError();
        state.reviews ||= [];
        state.loans ||= [];
        state.requests ||= [];
        state.audit ||= [];
        return state;
      } catch {
        throw new Error("Los datos guardados de la biblioteca están dañados. Exporta una copia antes de restablecer el almacenamiento local.");
      }
    }

    function writeState(state) {
      try {
        storage.setItem(storageKey, JSON.stringify(state));
      } catch (error) {
        if (error?.name === "QuotaExceededError") {
          throw new Error("El almacenamiento local está lleno. Libera espacio del navegador antes de continuar.");
        }
        throw error;
      }
    }

    function update(mutator) {
      const state = readState();
      const result = mutator(state);
      writeState(state);
      return result;
    }

    function currentUser(state) {
      return state.users.find((user) => user.id === state.sessionUserId) || null;
    }

    function reviewFields(state, actor, input, previous) {
      const book = state.books.find((item) => item.id === input.bookId);
      if (!book && (!previous || input.bookId !== previous.bookId)) failure(404, "not_found", "El libro no existe.");
      const comment = textField(input.comment, "El comentario", { min: 5, max: 600 });
      checkReview(comment, seed.prohibitedExpressions);
      if (state.reviews.some((review) => review.ownerId === actor.id && review.bookId === input.bookId && review.id !== previous?.id)) {
        failure(409, "duplicate_review", "Ya tienes una reseña de este libro. Puedes editarla.");
      }
      return {
        bookId: input.bookId,
        bookTitle: book?.title ?? previous.bookTitle,
        rating: integerField(input.rating, "La calificación", 1, 5),
        comment,
      };
    }

    function getState(actor) {
      requireRole(actor, "student", "admin");
      const state = readState();
      const today = schoolDate.format(now());
      const visibleToActor = (record) => actor.role === "admin" || record.studentId === actor.id;
      return {
        user: publicUser(actor),
        books: actor.role === "admin" ? state.books : state.books.map(catalogBook),
        loans: state.loans.filter(visibleToActor).map((loan) => publicLoan(loan, today)),
        reviews: state.reviews.map((review) => publicReview(review, actor)),
        requests: state.requests.filter(visibleToActor).map(publicRequest),
      };
    }

    function applyMutation(actor, collection, id, suffix, method, body) {
      if (collection === "books" && method === "POST" && !id) {
        requireRole(actor, "admin");
        return update((state) => {
          const current = now();
          const book = {
            ...validateBook(body, state.books),
            id: createId(), cover: "cover-1", age: "Lectura general", pages: "", registeredAt: current.toISOString(),
          };
          state.books.push(book);
          auditEntry(state, actor, current, "Crear libro", "libro", book.id, book.title, createId);
        });
      }
      if (collection === "books" && method === "PATCH" && id && !suffix) {
        requireRole(actor, "admin");
        return update((state) => {
          const book = findRecord(state.books, id, "El libro");
          Object.assign(book, validateBook(body, state.books, book));
          auditEntry(state, actor, now(), "Editar libro", "libro", book.id, book.title, createId);
        });
      }
      if (collection === "books" && method === "DELETE" && id && !suffix) {
        requireRole(actor, "admin");
        return update((state) => {
          const book = findRecord(state.books, id, "El libro");
          if (state.loans.some((loan) => loan.bookId === id && !isReturned(loan))) failure(409, "active_loans", "No puedes eliminar un libro con préstamos activos.");
          for (const record of [...state.loans, ...state.reviews, ...state.requests]) {
            if (record.bookId === id) record.bookTitle = book.title;
          }
          const current = now();
          for (const request of state.requests) {
            if (request.bookId === id && request.status === "Pendiente") {
              request.status = "Rechazada";
              auditEntry(state, actor, current, "Rechazar petición", "petición", request.id, book.title, createId);
            }
          }
          state.books = state.books.filter((record) => record.id !== id);
          auditEntry(state, actor, current, "Eliminar libro", "libro", book.id, book.title, createId);
        });
      }
      if (collection === "reviews" && method === "POST" && !id) {
        requireRole(actor, "student", "admin");
        return update((state) => {
          const fields = reviewFields(state, actor, body);
          state.reviews.push({
            ...fields, id: createId(), ownerId: actor.id, user: actor.name,
            createdAt: now().toISOString(), updatedAt: null,
          });
        });
      }
      if (collection === "reviews" && method === "PATCH" && id && !suffix) {
        requireRole(actor, "student", "admin");
        return update((state) => {
          const review = findRecord(state.reviews, id, "La reseña");
          if (review.ownerId !== actor.id) failure(403, "forbidden", "Solo puedes editar tus propias reseñas.");
          Object.assign(review, reviewFields(state, actor, body, review), { updatedAt: now().toISOString() });
        });
      }
      if (collection === "reviews" && method === "DELETE" && id && !suffix) {
        requireRole(actor, "admin");
        return update((state) => {
          const review = findRecord(state.reviews, id, "La reseña");
          const title = state.books.find((book) => book.id === review.bookId)?.title ?? review.bookTitle;
          const label = title ? `Reseña de ${review.user} sobre «${title}»` : `Reseña de ${review.user}`;
          state.reviews = state.reviews.filter((record) => record.id !== id);
          auditEntry(state, actor, now(), "Eliminar reseña", "reseña", id, label, createId);
        });
      }
      if (collection === "loans" && method === "POST" && !id) {
        requireRole(actor, "admin");
        return update((state) => {
          const book = availableBook(state, body.bookId);
          const loanDate = dateField(body.loanDate);
          const dueDate = dateField(body.dueDate);
          if (dueDate < loanDate) failure(400, "invalid_date_range", "La fecha límite debe ser igual o posterior al préstamo.");
          const studentRut = textField(body.studentRut, "El RUT", { min: 0, max: 20 });
          let student;
          if (studentRut) {
            const identifier = normalizeRut(studentRut);
            if (!identifier) failure(400, "invalid_rut", "Ingresa un RUT de estudiante válido.");
            student = state.users.find((user) => user.role === "student" && user.identifier === identifier);
            if (!student) failure(404, "student_not_found", "No existe una cuenta de estudiante con ese RUT.");
          }
          const user = student?.name ?? textField(body.user, "El nombre del solicitante");
          const current = now();
          const loan = issueLoan(state, book, { user, studentId: student?.id ?? null, loanDate, dueDate }, schoolDate.format(current), createId);
          auditEntry(state, actor, current, "Registrar préstamo", "préstamo", loan.id, book.title, createId);
        });
      }
      if (collection === "loans" && method === "POST" && id && suffix === "/return") {
        requireRole(actor, "admin");
        return update((state) => {
          const loan = findRecord(state.loans, id, "El préstamo");
          const current = now();
          const book = registerReturn(state, loan, schoolDate.format(current));
          auditEntry(state, actor, current, "Registrar devolución", "préstamo", id, book.title, createId);
        });
      }
      if (collection === "requests" && method === "POST" && !id) {
        requireRole(actor, "student");
        return update((state) => {
          if (body.type !== "loan" && body.type !== "return") failure(400, "invalid_request_type", "Selecciona un tipo de solicitud válido.");
          let book;
          let loan;
          if (body.type === "loan") {
            book = availableBook(state, body.bookId);
          } else {
            loan = findRecord(state.loans, body.loanId, "El préstamo");
            if (loan.studentId !== actor.id) failure(403, "forbidden", "Solo puedes solicitar la devolución de tus propios préstamos.");
            if (isReturned(loan)) failure(409, "already_returned", "Este préstamo ya fue devuelto.");
            book = findRecord(state.books, loan.bookId, "El libro");
          }
          const duplicate = state.requests.some((request) => {
            if (request.status !== "Pendiente" || request.type !== body.type || request.studentId !== actor.id) return false;
            return loan ? request.loanId === loan.id : request.bookId === book.id;
          });
          if (duplicate) failure(409, "duplicate_request", "Ya tienes una petición pendiente para este movimiento.");
          state.requests.push({
            id: createId(), type: body.type, studentId: actor.id, student: actor.name,
            bookId: book.id, bookTitle: book.title, loanId: loan?.id, status: "Pendiente",
            createdAt: schoolDate.format(now()),
          });
        });
      }
      if (collection === "requests" && method === "PATCH" && id && !suffix) {
        requireRole(actor, "admin");
        if (typeof body.approve !== "boolean") failure(400, "invalid_decision", "Indica si quieres aprobar o rechazar la petición.");
        return update((state) => {
          const request = findRecord(state.requests, id, "La petición");
          if (request.status !== "Pendiente") failure(409, "request_resolved", "Esta petición ya fue resuelta.");
          const current = now();
          const today = schoolDate.format(current);
          if (body.approve && request.type === "loan") {
            const book = availableBook(state, request.bookId);
            issueLoan(state, book, { user: request.student, studentId: request.studentId, loanDate: today, dueDate: dueAfterTwoWeeks(today) }, today, createId);
          }
          if (body.approve && request.type === "return") {
            const loan = findRecord(state.loans, request.loanId, "El préstamo");
            registerReturn(state, loan, today);
          }
          request.status = body.approve ? "Aprobada" : "Rechazada";
          const title = state.books.find((item) => item.id === request.bookId)?.title ?? request.bookTitle ?? "Libro";
          auditEntry(state, actor, current, body.approve ? "Aprobar petición" : "Rechazar petición", "petición", id, title, createId);
        });
      }
      failure(404, "NOT_FOUND", "No se encontró lo solicitado.");
    }

    async function request(path, method = "GET", body, actorId) {
      if (method === "POST" && path === "/login") {
        const { role, identifier, password } = body || {};
        if (role !== "student" && role !== "admin") failure(400, "INVALID_ROLE", "Selecciona un rol válido.");
        const normalized = normalizeIdentifier(role, identifier);
        if (!normalized) failure(401, "BAD_CREDENTIALS", "Identificador o contraseña incorrectos.");
        const state = readState();
        const user = state.users.find((account) => account.role === role && account.identifier === normalized && account.password === password);
        if (!user) failure(401, "BAD_CREDENTIALS", "Identificador o contraseña incorrectos.");
        state.sessionUserId = user.id;
        writeState(state);
        return { user: publicUser(user) };
      }
      if (method === "POST" && path === "/logout") {
        update((state) => { state.sessionUserId = null; });
        return;
      }

      const state = readState();
      const actor = currentUser(state);
      requireRole(actor, "student", "admin");
      if (actorId !== undefined && actorId !== actor.id) failure(409, "SESSION_CHANGED", "La sesión cambió. Revisa el usuario activo antes de continuar.");
      if (method === "GET" && path === "/state") return getState(actor);
      if (method === "GET" && path === "/audit") {
        requireRole(actor, "admin");
        return { entries: [...state.audit].reverse() };
      }

      const match = /^\/(books|reviews|loans|requests)(?:\/([^/]+)(\/return)?)?$/.exec(path);
      if (!match) failure(404, "NOT_FOUND", "No se encontró lo solicitado.");
      let id;
      try {
        id = match[2] ? decodeURIComponent(match[2]) : undefined;
      } catch {
        failure(400, "invalid_id", "El identificador no es válido.");
      }
      return applyMutation(actor, match[1], id, match[3] || "", method, body);
    }

    return { request, storageKey };
  }

  return { createLocalApp, normalizeRut, storageKey };
});
