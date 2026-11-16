const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const roleNames = { admin: "Administrador", student: "Estudiante", teacher: "Profesor" };
const pageRole = document.body.dataset.role;
const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" });
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Santiago" });
const dateToday = () => localDate.format(new Date());
const formatDate = (value) => {
  if (!value) return "—";
  if (value.length === 10) return new Date(`${value}T12:00:00`).toLocaleDateString("es-CL");
  return localDate.format(new Date(value)).split("-").reverse().join("-");
};

let data = { user: null, books: [], reviews: [], requests: [], loans: [] };
let stateRequest = 0;
let sessionVersion = 0;
let sessionChanging = false;

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("#toast-region").append(item);
  setTimeout(() => item.remove(), 3600);
}

async function api(path, method = "GET", body, actorId) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (actorId) headers["X-Biblioteca-Actor"] = actorId;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("No se pudo conectar con la biblioteca. Comprueba que el servidor esté en ejecución.");
  }
  if (response.status === 204) return;
  const result = await response.json().catch(() => {
    throw new Error("La biblioteca devolvió una respuesta inesperada.");
  });
  if (!response.ok) {
    const error = new Error(result.message || "No se pudo completar la operación.");
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result;
}

function roleAllowsPage(role) {
  return pageRole === "student" ? role === "student" : role === "admin" || role === "teacher";
}

let sectionObserver;
function showLoginMessage(message = "") {
  const region = $("#login-error");
  region.textContent = message;
  region.hidden = !message;
}

function clearRenderedSession() {
  sessionVersion += 1;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  document.querySelectorAll("#management-form, #inventory-body, #loans-body, #requests-body, #audit-body, #student-requests-body, #management-stats, #student-summary, #book-grid, #review-list, #student-review-list, #student-name, #review-book-filter, #student-review-book-filter")
    .forEach((region) => region.replaceChildren());
  $("#management-form").onsubmit = null;
  const menuToggle = $(".menu-toggle");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Abrir menú");
  $("#main-nav").classList.remove("is-open");
}

function setPageAccess() {
  clearRenderedSession();
  const user = data.user;
  const authorized = Boolean(user && roleAllowsPage(user.role));
  $("#login-gate").hidden = authorized;
  $("#session-nav").hidden = !user;
  $("#main-nav").hidden = !user;
  $(".menu-toggle").hidden = !user;
  document.querySelectorAll("#main-nav a").forEach((link) => { link.hidden = !authorized; });
  $("#app-main").hidden = !authorized;
  $("#account-name").textContent = user?.name || "";
  $("#login-form").hidden = Boolean(user) && !authorized;

  if (!authorized) {
    sectionObserver?.disconnect();
    showLoginMessage(user ? "Ya hay una sesión de otro perfil. Ciérrala para entrar en este panel." : "");
    return;
  }

  showLoginMessage();
  if ($("#student-dashboard")) {
    $("#student-dashboard").hidden = false;
    $("#student-name").textContent = user.name;
  } else {
    $("#gestion").hidden = false;
    const admin = user.role === "admin";
    document.querySelectorAll("[data-admin-only]").forEach((control) => { control.hidden = !admin; });
    $("#management-kicker").textContent = admin ? "Administración bibliotecaria" : "Espacio para profesores";
    const emphasis = document.createElement("em");
    emphasis.textContent = admin ? "la colección." : "lectores.";
    $("#management-heading").replaceChildren(admin ? "Gestión de " : "Opiniones de ", emphasis);
    $("#management-description").textContent = admin
      ? "Administra ejemplares, controla préstamos y comparte opiniones sobre las lecturas."
      : "Consulta y comparte reseñas de los libros de la biblioteca.";
    $("#management-nav").textContent = admin ? "Administración" : "Reseñas";
    activateTab(admin ? "inventory" : "reviews");
  }
  renderAll();
  setupSectionNavigation();
}

function endSession(message = "") {
  stateRequest += 1;
  data = { user: null, books: [], reviews: [], requests: [], loans: [] };
  setPageAccess();
  showLoginMessage(message);
}

async function refreshState(applyAccess = false) {
  const request = ++stateRequest;
  const next = await api("/state").catch((error) => {
    if (request === stateRequest) throw error;
  });
  if (request !== stateRequest) return;
  if (applyAccess || data.user?.id !== next.user?.id || data.user?.role !== next.user?.role) {
    data = next;
    setPageAccess();
  } else {
    data = next;
    if (roleAllowsPage(data.user?.role)) renderAll();
  }
}

function displayError(error, region) {
  if (error.status === 401) {
    endSession("La sesión terminó. Vuelve a iniciar sesión.");
  } else if (error.code === "SESSION_CHANGED") {
    endSession(error.message);
    refreshState().catch((refreshError) => {
      if (refreshError.status !== 401) showLoginMessage(refreshError.message);
    });
    toast(error.message, "error");
  } else if (region) {
    region.textContent = error.message;
    region.hidden = false;
  } else {
    toast(error.message, "error");
  }
}

async function mutate(path, method, body, message) {
  await api(path, method, body, data.user.id);
  try {
    await refreshState();
  } catch (error) {
    displayError(error);
  }
  toast(message);
}

async function runAction(button, action, errorRegion) {
  button.disabled = true;
  if (errorRegion) errorRegion.hidden = true;
  try {
    await action();
  } catch (error) {
    displayError(error, errorRegion);
  } finally {
    button.disabled = false;
  }
}

function bookStats() {
  const total = data.books.reduce((sum, book) => sum + book.total, 0);
  const available = data.books.reduce((sum, book) => sum + book.available, 0);
  return {
    available,
    borrowed: total - available,
    low: data.books.filter((book) => book.available === 1).length,
    out: data.books.filter((book) => book.available === 0).length,
  };
}

function renderStats() {
  const stats = bookStats();
  $("#management-stats").innerHTML = [
    ["Títulos registrados", data.books.length, "Colección"], ["Ejemplares disponibles", stats.available, "En estantería"],
    ["Ejemplares prestados", stats.borrowed, "En circulación"], ["Bajo stock", stats.low, "Una unidad disponible"], ["Sin disponibilidad", stats.out, "Agotados"],
  ].map(([label, value, note]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
}

function ratingSummary(bookId) {
  const reviews = data.reviews.filter((review) => review.bookId === bookId);
  return { count: reviews.length, average: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0 };
}

function renderCatalog(resetScroll = false) {
  const grid = $("#book-grid");
  const query = $("#book-search").value.trim().toLocaleLowerCase("es");
  const selected = $(".filter-chip.selected")?.dataset.category || "Todos";
  const visible = data.books.filter((book) => (selected === "Todos" || book.category === selected) && `${book.title} ${book.author} ${book.category} ${book.isbn}`.toLocaleLowerCase("es").includes(query));
  grid.innerHTML = visible.map((book) => {
    const rating = ratingSummary(book.id);
    return `<article class="book-card">
      <div class="book-card-top"><span class="book-category">${escapeHTML(book.category)}</span><span class="book-age">${escapeHTML(book.age || "")}</span></div>
      <button class="book-cover cover-art ${escapeHTML(book.cover || "cover-1")}" type="button" data-book="${escapeHTML(book.id)}" aria-label="Ver detalles de ${escapeHTML(book.title)}"><span class="cover-title">${escapeHTML(book.title)}</span><span class="cover-author">${escapeHTML(book.author)}</span></button>
      <div class="book-info"><div><h3>${escapeHTML(book.title)}</h3><p>${escapeHTML(book.author)} · ${book.available} disponibles</p><p class="catalog-rating">${rating.count ? `★ ${rating.average.toFixed(1)} (${rating.count} reseñas)` : "Sin valoraciones"}</p></div>
      <button class="book-arrow" type="button" data-book="${escapeHTML(book.id)}" aria-label="Más información de ${escapeHTML(book.title)}">↗</button></div></article>`;
  }).join("");
  const scroll = $("#catalog-scroll");
  scroll.hidden = visible.length === 0;
  if (resetScroll) scroll.scrollTop = 0;
  $("#empty-state").hidden = visible.length > 0;
  $("#results-count").textContent = `Mostrando ${visible.length} ${visible.length === 1 ? "libro" : "libros"}`;
  const totalCount = $(".filter-chip[data-category='Todos'] span");
  if (totalCount) totalCount.textContent = data.books.length;
}

function showBookDetails(id) {
  const book = data.books.find((item) => item.id === id);
  if (!book) return;
  const cover = $("#dialog-cover");
  cover.className = `dialog-cover cover-art ${book.cover || "cover-1"}`;
  cover.innerHTML = `<span class="cover-title">${escapeHTML(book.title)}</span><span class="cover-author">${escapeHTML(book.author)}</span>`;
  $("#dialog-category").textContent = book.category;
  $("#dialog-title").textContent = book.title;
  $("#dialog-author").textContent = `Por ${book.author}`;
  $("#dialog-description").textContent = book.description || "Sin descripción disponible.";
  const rating = ratingSummary(book.id);
  $("#dialog-meta").textContent = [book.age, book.pages, `${book.available} ejemplares disponibles`, rating.count ? `★ ${rating.average.toFixed(1)}/5 (${rating.count} reseñas)` : "Sin valoraciones"].filter(Boolean).join(" · ");
  $(".availability-note").textContent = `Estado físico: ${book.condition || "No especificado"}. ISBN: ${book.isbn || "No registrado"}.`;
  $("#student-book-request")?.remove();
  $("#book-request-error")?.remove();
  if (data.user?.role === "student") {
    const action = document.createElement("button");
    action.id = "student-book-request";
    action.className = "action-button";
    action.type = "button";
    action.textContent = book.available > 0 ? "Solicitar préstamo" : "Sin ejemplares disponibles";
    action.disabled = book.available < 1;
    const errorRegion = document.createElement("p");
    errorRegion.id = "book-request-error";
    errorRegion.className = "form-error";
    errorRegion.setAttribute("role", "alert");
    errorRegion.hidden = true;
    action.addEventListener("click", () => runAction(action, async () => {
      await mutate("/requests", "POST", { type: "loan", bookId: book.id }, "Solicitud enviada. Espera la aprobación de biblioteca.");
      if (action.isConnected) $("#book-dialog").close();
    }, errorRegion));
    $(".dialog-copy").append(errorRegion, action);
  }
  $("#book-dialog").showModal();
}

function renderInventory() {
  const query = $("#inventory-search").value.trim().toLocaleLowerCase("es");
  const filter = $("#inventory-filter").value;
  const books = data.books.filter((book) => {
    const availability = { available: book.available > 0, low: book.available === 1, out: book.available === 0, all: true };
    return availability[filter] && `${book.title} ${book.author} ${book.isbn}`.toLocaleLowerCase("es").includes(query);
  });
  $("#inventory-body").innerHTML = books.map((book) => `<tr>
    <td><strong>${escapeHTML(book.title)}</strong><small>${escapeHTML(book.author)}</small></td>
    <td>${escapeHTML(book.isbn || "—")}</td><td>${book.total}</td>
    <td><span class="stock-number ${book.available === 0 ? "danger" : book.available === 1 ? "warning" : ""}">${book.available}</span></td>
    <td>${book.total - book.available}</td><td>${escapeHTML(book.condition || "—")}</td>
    <td><div class="row-actions"><button type="button" data-edit-book="${escapeHTML(book.id)}">Editar</button><button type="button" class="danger-action" data-delete-book="${escapeHTML(book.id)}">Eliminar</button></div></td>
    </tr>`).join("");
  $("#inventory-empty").hidden = books.length > 0;
}

function statusPill(status) {
  const style = { Rechazada: "overdue", Vencido: "overdue", Aprobada: "returned", Devuelto: "returned" };
  return `<span class="status-pill ${style[status] || "active"}">${escapeHTML(status)}</span>`;
}

function renderLoans() {
  const query = $("#loan-search").value.trim().toLocaleLowerCase("es");
  const filter = $("#loan-filter").value;
  const loans = [...data.loans].reverse().map((loan) => ({ ...loan, title: data.books.find((book) => book.id === loan.bookId)?.title || loan.bookTitle || "Libro eliminado" }))
    .filter((loan) => (filter === "all" || loan.status === filter) && `${loan.user} ${loan.title}`.toLocaleLowerCase("es").includes(query));
  $("#loans-body").innerHTML = loans.map((loan) => {
    const remaining = (Date.parse(loan.dueDate) - Date.parse(dateToday())) / 86400000;
    const dueNote = remaining < 0 ? `${Math.abs(remaining)} días de atraso` : `${remaining} días restantes`;
    const returned = loan.status === "Devuelto";
    const action = returned ? `<small>Devuelto ${formatDate(loan.returnedAt)}</small>` : `<button class="table-action" type="button" data-return-loan="${escapeHTML(loan.id)}">Registrar devolución</button>`;
    return `<tr><td><strong>${escapeHTML(loan.user)}</strong></td><td>${escapeHTML(loan.title)}</td>
      <td>${formatDate(loan.loanDate)}</td><td>${formatDate(loan.dueDate)}${returned ? "" : `<small>${dueNote}</small>`}</td>
      <td>${statusPill(loan.status)}</td><td>${action}</td></tr>`;
  }).join("");
  $("#loans-empty").hidden = loans.length > 0;
}

function renderRequests() {
  const filter = $("#request-filter").value;
  const requests = [...data.requests].reverse().filter((request) => filter === "all" || request.status === filter);
  $("#requests-body").innerHTML = requests.map((request) => {
    const book = data.books.find((item) => item.id === request.bookId);
    const type = request.type === "loan" ? "Préstamo" : "Devolución";
    const action = request.status === "Pendiente" ? `<div class="row-actions"><button type="button" data-approve-request="${escapeHTML(request.id)}">Aprobar</button><button type="button" class="danger-action" data-reject-request="${escapeHTML(request.id)}">Rechazar</button></div>` : "—";
    return `<tr><td>${escapeHTML(request.student)}</td><td>${escapeHTML(book?.title || request.bookTitle || "Libro eliminado")}</td><td>${type}</td><td>${formatDate(request.createdAt)}</td><td>${statusPill(request.status)}</td><td>${action}</td></tr>`;
  }).join("");
  $("#requests-empty").hidden = requests.length > 0;
  $("#pending-request-count").textContent = data.requests.filter((request) => request.status === "Pendiente").length;
}

function renderStudentPanel() {
  const { loans, requests } = data;
  $("#student-summary").innerHTML = [
    ["Préstamos activos", loans.filter((loan) => loan.status !== "Devuelto").length, "Libros en tu poder"],
    ["Peticiones pendientes", requests.filter((request) => request.status === "Pendiente").length, "En revisión"],
    ["Historial", loans.length, "Préstamos registrados"],
  ].map(([label, count, note]) => `<article class="stat-card"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join("");

  const rows = [
    ...requests.map((item) => ({ item, when: item.createdAt, label: item.type === "loan" ? "Solicitud de préstamo" : "Solicitud de devolución" })),
    ...loans.map((item) => ({ item, when: item.loanDate, label: "Préstamo", returnable: item.status !== "Devuelto" })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  $("#student-requests-body").innerHTML = rows.map(({ item, when, label, returnable }) => {
    const book = data.books.find((entry) => entry.id === item.bookId);
    const returnPending = requests.some((request) => request.type === "return" && request.loanId === item.id && request.status === "Pendiente");
    const action = returnable && !returnPending ? `<button class="table-action" data-student-return="${escapeHTML(item.id)}" type="button">Solicitar devolución</button>` : "—";
    return `<tr><td>${escapeHTML(book?.title || item.bookTitle || "Libro eliminado")}</td><td>${label}</td><td>${formatDate(when)}</td><td>${statusPill(item.status)}</td><td>${action}</td></tr>`;
  }).join("");
  $("#student-requests-empty").hidden = rows.length > 0;
}

const reviewPrefix = pageRole === "student" ? "student-" : "";
const reviewControl = (name) => $(`#${reviewPrefix}${name}`);

function renderReviews() {
  const select = reviewControl("review-book-filter");
  const previous = select.value;
  const bookNames = new Map(data.reviews.map((review) => [review.bookId, review.bookTitle || "Libro eliminado"]));
  data.books.forEach((book) => { bookNames.set(book.id, book.title); });
  select.replaceChildren(new Option("Todos los libros", "all"), ...[...bookNames].map(([id, title]) => new Option(title, id)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;

  const bookFilter = select.value;
  const sort = reviewControl("review-sort").value;
  const reviews = data.reviews.filter((review) => bookFilter === "all" || review.bookId === bookFilter);
  reviews.sort((a, b) => {
    const ratingOrder = sort === "highest" ? b.rating - a.rating : sort === "lowest" ? a.rating - b.rating : 0;
    return ratingOrder || b.createdAt.localeCompare(a.createdAt);
  });
  reviewControl("review-list").innerHTML = reviews.map((review) => {
    const edit = review.own ? `<button type="button" data-edit-review="${escapeHTML(review.id)}">Editar</button>` : "";
    const moderate = data.user.role === "admin" ? `<button type="button" class="danger-action" data-delete-review="${escapeHTML(review.id)}" aria-label="Eliminar reseña de ${escapeHTML(review.user)}">Eliminar</button>` : "";
    return `<article class="review-card">
      <div class="review-top"><div><strong>${escapeHTML(review.user)}</strong><small>${escapeHTML(bookNames.get(review.bookId))}</small></div>
      <span class="review-stars" aria-label="${review.rating} de 5 estrellas">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span></div>
      <p>${escapeHTML(review.comment)}</p>
      <div class="review-bottom"><small>${formatDate(review.updatedAt || review.createdAt)}${review.updatedAt ? " · Editada" : ""}</small>
      <div class="row-actions">${edit}${moderate}</div></div></article>`;
  }).join("");
  const empty = reviewControl("reviews-empty");
  empty.hidden = reviews.length > 0;
  empty.textContent = bookFilter === "all" ? "Aún no hay reseñas publicadas." : "No hay reseñas para el libro seleccionado.";
  reviewControl("review-reset").disabled = bookFilter === "all" && sort === "newest";
}

function renderAll() {
  if (data.user.role === "student") {
    renderCatalog();
    renderStudentPanel();
  }
  if (data.user.role === "admin") {
    renderStats();
    renderInventory();
    renderLoans();
    renderRequests();
  }
  renderReviews();
}

async function loadHistory() {
  if (data.user?.role !== "admin") return;
  const session = sessionVersion;
  const empty = $("#audit-empty");
  empty.hidden = false;
  empty.textContent = "Cargando historial…";
  $("#audit-body").replaceChildren();
  try {
    const { entries } = await api("/audit");
    if (session !== sessionVersion) return;
    $("#audit-body").innerHTML = entries.map(({ at, action, target, actor }) => `<tr>
      <td><time datetime="${escapeHTML(at)}">${dateTime.format(new Date(at))}</time></td>
      <td>${escapeHTML(action)}</td><td>${escapeHTML(target.label)}<small>${escapeHTML(target.id)}</small></td>
      <td>${escapeHTML(actor.name)}</td><td>${escapeHTML(roleNames[actor.role] || actor.role)}</td><td>${escapeHTML(actor.identifier)}</td>
    </tr>`).join("");
    empty.textContent = "Aún no hay acciones registradas.";
    empty.hidden = entries.length > 0;
  } catch (error) {
    if (session === sessionVersion) displayError(error, empty);
  }
}

function activateTab(name) {
  const next = $(`.management-tab[data-panel="${name}"]`);
  if (!next || next.hidden) return;
  document.querySelectorAll(".management-tab").forEach((tab) => {
    const active = tab === next;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".management-panel").forEach((panel) => {
    const active = panel.id === `panel-${name}`;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  if (name === "audit") loadHistory();
}

function openForm(title, fields, onSubmit) {
  const dialog = $("#management-dialog");
  const form = $("#management-form");
  $("#management-dialog-title").textContent = title;
  form.innerHTML = fields.map((field) => {
    const value = field.value ?? "";
    const required = field.required === false ? "" : "required";
    const name = escapeHTML(field.name);
    let input;
    if (field.type === "select") {
      input = `<select name="${name}" ${required}>${field.options.map(([key, label]) =>
        `<option value="${escapeHTML(key)}" ${String(value) === String(key) ? "selected" : ""}>${escapeHTML(label)}</option>`).join("")}</select>`;
    } else if (field.type === "textarea") {
      input = `<textarea name="${name}" maxlength="${field.maxlength || 1000}" ${required}>${escapeHTML(value)}</textarea>`;
    } else {
      input = `<input name="${name}" type="${field.type || "text"}" value="${escapeHTML(value)}"
        ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""}
        ${field.maxlength ? `maxlength="${field.maxlength}"` : ""} ${required}>`;
    }
    return `<label class="form-field">${escapeHTML(field.label)}${input}</label>`;
  }).join("") + `<p class="form-error" id="management-form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="secondary-button" type="button" id="cancel-management">Cancelar</button><button class="action-button" type="submit">Guardar</button></div>`;

  $("#cancel-management").addEventListener("click", () => dialog.close());
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    const errorRegion = $("#management-form-error");
    const cancel = $("#cancel-management");
    const close = $("#management-dialog-close");
    submit.disabled = cancel.disabled = close.disabled = true;
    errorRegion.hidden = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      dialog.close();
    } catch (error) {
      displayError(error, errorRegion);
    } finally {
      submit.disabled = cancel.disabled = close.disabled = false;
    }
  };
  dialog.showModal();
}

function bookFields(book = {}) {
  return [
    { name: "title", label: "Título", value: book.title, maxlength: 120 },
    { name: "author", label: "Autor", value: book.author, maxlength: 100 },
    { name: "isbn", label: "ISBN", value: book.isbn, maxlength: 20 },
    { name: "publisher", label: "Editorial", value: book.publisher, maxlength: 100 },
    { name: "year", label: "Año de publicación", type: "number", value: book.year ?? new Date().getFullYear(), min: 0, max: 2100 },
    { name: "category", label: "Categoría", value: book.category || "Narrativa", maxlength: 50 },
    { name: "description", label: "Descripción", type: "textarea", value: book.description, required: false, maxlength: 600 },
    { name: "total", label: "Cantidad total de ejemplares", type: "number", value: book.total ?? 1, min: 0, max: 10000 },
    { name: "condition", label: "Estado físico", type: "select", value: book.condition || "Bueno", options: [["Nuevo", "Nuevo"], ["Bueno", "Bueno"], ["Regular", "Regular"], ["Deteriorado", "Deteriorado"]] },
  ];
}

function addOrEditBook(book) {
  openForm(book ? "Editar libro" : "Registrar nuevo libro", bookFields(book), (values) => {
    const path = book ? `/books/${encodeURIComponent(book.id)}` : "/books";
    return mutate(path, book ? "PATCH" : "POST", values, book ? "Libro actualizado." : "Libro registrado.");
  });
}

function addLoan() {
  const options = data.books.filter((book) => book.available > 0).map((book) => [book.id, `${book.title} (${book.available} disponibles)`]);
  if (!options.length) {
    toast("No hay ejemplares disponibles para prestar.", "error");
    return;
  }
  const today = dateToday();
  const due = new Date(Date.parse(today) + 14 * 86400000).toISOString().slice(0, 10);
  openForm("Registrar préstamo", [
    { name: "studentRut", label: "RUT si es un estudiante con cuenta", maxlength: 20, required: false },
    { name: "user", label: "Nombre del solicitante si no ingresas RUT", maxlength: 100, required: false },
    { name: "bookId", label: "Libro", type: "select", options },
    { name: "loanDate", label: "Fecha de préstamo", type: "date", value: today },
    { name: "dueDate", label: "Fecha límite de devolución", type: "date", value: due },
  ], (values) => mutate("/loans", "POST", values, "Préstamo registrado y stock actualizado."));
}

function addReview(review) {
  const options = data.books.map((book) => [book.id, book.title]);
  if (review && !data.books.some((book) => book.id === review.bookId)) options.unshift([review.bookId, review.bookTitle || "Libro eliminado"]);
  if (!options.length) {
    toast("No hay libros disponibles para reseñar.", "error");
    return;
  }
  openForm(review ? "Editar reseña" : "Publicar reseña", [
    { name: "bookId", label: "Libro", type: "select", value: review?.bookId || options[0][0], options },
    { name: "rating", label: "Calificación", type: "select", value: review?.rating || 5, options: [[1, "1 estrella"], [2, "2 estrellas"], [3, "3 estrellas"], [4, "4 estrellas"], [5, "5 estrellas"]] },
    { name: "comment", label: "Comentario", type: "textarea", value: review?.comment, maxlength: 600 },
  ], (values) => {
    const path = review ? `/reviews/${encodeURIComponent(review.id)}` : "/reviews";
    return mutate(path, review ? "PATCH" : "POST", values, review ? "Reseña actualizada." : "Reseña publicada.");
  });
}

function bindUI() {
  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("selected")));
  });
  $(".filter-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const previous = $(".filter-chip.selected");
    previous?.classList.remove("selected");
    previous?.setAttribute("aria-pressed", "false");
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    renderCatalog(true);
  });
  $("#book-search")?.addEventListener("input", () => renderCatalog(true));
  $("#book-grid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-book]");
    if (button) showBookDetails(button.dataset.book);
  });
  $("#book-dialog .dialog-close")?.addEventListener("click", () => $("#book-dialog").close());
  $("#book-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $(".management-tabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-panel]");
    if (tab) activateTab(tab.dataset.panel);
  });

  $("#add-book")?.addEventListener("click", () => addOrEditBook());
  $("#inventory-body")?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-book]");
    const remove = event.target.closest("[data-delete-book]");
    const book = data.books.find(({ id }) => id === (edit?.dataset.editBook || remove?.dataset.deleteBook));
    if (!book) return;
    if (edit) addOrEditBook(book);
    if (remove && confirm(`¿Eliminar el registro de «${book.title}»?`)) {
      runAction(remove, () => mutate(`/books/${encodeURIComponent(book.id)}`, "DELETE", undefined, "Libro eliminado."));
    }
  });
  $("#inventory-search")?.addEventListener("input", renderInventory);
  $("#inventory-filter")?.addEventListener("change", renderInventory);
  $("#add-loan")?.addEventListener("click", addLoan);
  $("#loans-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-return-loan]");
    if (button && confirm("¿Confirmar la devolución de este ejemplar?")) {
      runAction(button, () => mutate(`/loans/${encodeURIComponent(button.dataset.returnLoan)}/return`, "POST", undefined, "Devolución registrada. Inventario actualizado."));
    }
  });
  $("#loan-search")?.addEventListener("input", renderLoans);
  $("#loan-filter")?.addEventListener("change", renderLoans);

  $("#student-requests-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-student-return]");
    if (button) runAction(button, () => mutate("/requests", "POST", { type: "return", loanId: button.dataset.studentReturn }, "Petición de devolución enviada."));
  });
  $("#requests-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-approve-request], [data-reject-request]");
    if (!button) return;
    const approve = Boolean(button.dataset.approveRequest);
    const id = button.dataset.approveRequest || button.dataset.rejectRequest;
    runAction(button, () => mutate(`/requests/${encodeURIComponent(id)}`, "PATCH", { approve }, approve ? "Petición aprobada." : "Petición rechazada."));
  });
  $("#request-filter")?.addEventListener("change", renderRequests);

  $(`#${reviewPrefix}add-review`).addEventListener("click", () => addReview());
  reviewControl("review-book-filter").addEventListener("change", renderReviews);
  reviewControl("review-sort").addEventListener("change", renderReviews);
  reviewControl("review-reset").addEventListener("click", () => {
    reviewControl("review-book-filter").value = "all";
    reviewControl("review-sort").value = "newest";
    renderReviews();
    reviewControl("review-book-filter").focus();
  });
  reviewControl("review-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-review]");
    const remove = event.target.closest("[data-delete-review]");
    const review = data.reviews.find(({ id }) => id === (edit?.dataset.editReview || remove?.dataset.deleteReview));
    if (!review) return;
    if (edit && review.own) addReview(review);
    if (remove && data.user.role === "admin" && confirm(`¿Eliminar la reseña de ${review.user}?`)) {
      runAction(remove, () => mutate(`/reviews/${encodeURIComponent(review.id)}`, "DELETE", undefined, "Reseña eliminada."));
    }
  });
  $("#management-dialog-close").addEventListener("click", () => $("#management-dialog").close());
  $("#management-dialog").addEventListener("cancel", (event) => {
    if ($("#management-dialog-close").disabled) event.preventDefault();
  });
}

function setupSectionNavigation() {
  sectionObserver?.disconnect();
  const links = [...document.querySelectorAll(".main-nav .nav-link[href^='#']:not([hidden])")];
  const sections = links.map((link) => $(link.getAttribute("href"))).filter((section) => section && !section.hidden);

  const setActive = (id) => {
    links.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  links.forEach((link) => {
    link.onclick = () => setActive(link.hash.slice(1));
  });
  setActive(sections.find((section) => `#${section.id}` === location.hash)?.id || sections[0]?.id);
  if (sections.length <= 1 || !("IntersectionObserver" in window)) return;

  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActive(visible.target.id);
  }, { rootMargin: "-18% 0px -65% 0px", threshold: [0, 0.15, 0.35, 0.6] });
  sections.forEach((section) => sectionObserver.observe(section));
}

function setupSession() {
  const login = $("#login-form");
  const logout = $("#logout");
  const role = login.elements.role;
  const identifier = login.elements.identifier;
  const password = login.elements.password;
  const submit = login.querySelector('[type="submit"]');

  function updateIdentifierLabel() {
    const fields = {
      student: ["RUT", "12.345.678-5", "text"],
      teacher: ["Dirección de Gmail", "nombre@gmail.com", "email"],
      admin: ["Correo electrónico", "", "email"],
    };
    const [label, placeholder, type] = fields[role.value];
    $("#login-identifier-label").textContent = label;
    identifier.type = type;
    identifier.placeholder = placeholder;
  }
  role.addEventListener("change", () => {
    identifier.value = "";
    password.value = "";
    showLoginMessage();
    updateIdentifierLabel();
  });
  updateIdentifierLabel();
  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sessionChanging) return;
    const credentials = Object.fromEntries(new FormData(login));
    credentials.identifier = credentials.identifier.trim();
    sessionChanging = true;
    submit.disabled = true;
    showLoginMessage();
    try {
      await api("/login", "POST", credentials);
      password.value = "";
      await refreshState(true);
    } catch (error) {
      password.value = "";
      showLoginMessage(error.message);
    } finally {
      sessionChanging = false;
      submit.disabled = false;
    }
  });
  logout.addEventListener("click", async () => {
    if (sessionChanging) return;
    sessionChanging = true;
    logout.disabled = true;
    try {
      await api("/logout", "POST");
      endSession();
      login.reset();
      updateIdentifierLabel();
      identifier.focus();
    } catch (error) {
      displayError(error);
    } finally {
      sessionChanging = false;
      logout.disabled = false;
    }
  });

  const menuToggle = $(".menu-toggle");
  const mainNav = $("#main-nav");
  function showMenu(open) {
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    mainNav.classList.toggle("is-open", open);
  }
  menuToggle.addEventListener("click", () => showMenu(menuToggle.getAttribute("aria-expanded") !== "true"));
  mainNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) showMenu(false);
  });

  submit.disabled = true;
  refreshState(true).catch((error) => {
    endSession(error.status === 401 ? "" : error.message);
  }).finally(() => { submit.disabled = false; });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshState(true).catch((error) => endSession(error.status === 401 ? "" : error.message));
  });
}

$("#current-year").textContent = new Date().getFullYear();
bindUI();
setupSession();
