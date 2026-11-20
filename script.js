const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const roleNames = { admin: "Administrador", student: "Estudiante" };
const pageRole = document.body.dataset.role;
const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" });
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Santiago" });
const dateToday = () => localDate.format(new Date());
const dateAfterDays = (date, days) => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
const formatDate = (value) => {
  if (!value) return "—";
  if (value.length === 10) return new Date(`${value}T12:00:00`).toLocaleDateString("es-CL");
  return localDate.format(new Date(value)).split("-").reverse().join("-");
};

let data = { user: null, books: [], reviews: [], requests: [], loans: [] };
let stateRequest = 0;
let renderVersion = 0;
let localApp;
const NAV_ACTIVATION_OFFSET = 48;

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("#toast-region").append(item);
  setTimeout(() => item.remove(), 3600);
}

async function api(path, method = "GET", body) {
  localApp ||= window.BibliotecaLocal.createLocalApp({ role: pageRole, seed: window.BIBLIOTECA_DATA });
  return localApp.request(path, method, body);
}

function roleAllowsPage(role) {
  return pageRole === "student" ? role === "student" : role === "admin";
}

let sectionNavigationUpdate;
function showPageError(message = "") {
  if (message) toast(message, "error");
}

function clearRenderedData() {
  renderVersion += 1;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  if (sectionNavigationUpdate) {
    window.removeEventListener("scroll", sectionNavigationUpdate);
    window.removeEventListener("resize", sectionNavigationUpdate);
    sectionNavigationUpdate = null;
  }
  document.querySelectorAll("#management-form, #inventory-body, #loans-body, #requests-body, #audit-body, #student-requests-body, #management-stats, #student-summary, #book-grid, #review-list, #student-review-list, #student-name, #review-book-filter, #student-review-book-filter")
    .forEach((region) => region.replaceChildren());
  ["ticket-id", "ticket-student", "ticket-book", "ticket-loan-date", "ticket-due-date"].forEach((id) => {
    const field = $(`#${id}`);
    if (field) field.textContent = "";
  });
  $("#management-form").onsubmit = null;
  const menuToggle = $(".menu-toggle");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Abrir menú");
  $("#main-nav").classList.remove("is-open");
}

function renderPage() {
  clearRenderedData();
  const user = data.user;
  const pageMatchesRole = Boolean(user && roleAllowsPage(user.role));
  $("#main-nav").hidden = !pageMatchesRole;
  $(".menu-toggle").hidden = !pageMatchesRole;
  document.querySelectorAll("#main-nav a").forEach((link) => { link.hidden = !pageMatchesRole; });
  $("#app-main").hidden = !pageMatchesRole;

  if (!pageMatchesRole) {
    showPageError(user ? "El perfil configurado no coincide con esta página." : "No se pudo cargar el perfil configurado para esta página.");
    return;
  }

  if ($("#student-dashboard")) {
    $("#student-dashboard").hidden = false;
    $("#student-name").textContent = user.name;
  } else {
    $("#gestion").hidden = false;
    const admin = user.role === "admin";
    document.querySelectorAll("[data-admin-only]").forEach((control) => { control.hidden = !admin; });
    $("#management-kicker").textContent = "Administración bibliotecaria";
    const emphasis = document.createElement("em");
    emphasis.textContent = "la colección.";
    $("#management-heading").replaceChildren("Gestión de ", emphasis);
    $("#management-description").textContent = "Administra ejemplares, controla préstamos y comparte opiniones sobre las lecturas.";
    $("#management-nav").textContent = "Administración";
    activateTab("inventory");
  }
  renderAll();
  setupSectionNavigation();
}

async function refreshState(applyAccess = false) {
  const request = ++stateRequest;
  const next = await api("/state").catch((error) => {
    if (request === stateRequest) throw error;
  });
  if (request !== stateRequest) return;
  if (applyAccess || data.user?.id !== next.user?.id || data.user?.role !== next.user?.role) {
    data = next;
    renderPage();
  } else {
    data = next;
    if (roleAllowsPage(data.user?.role)) renderAll();
  }
}

function displayError(error, region) {
  if (region) {
    region.textContent = error.message;
    region.hidden = false;
  } else {
    toast(error.message, "error");
  }
}

async function mutate(path, method, body, message) {
  const result = await api(path, method, body);
  try {
    await refreshState();
  } catch (error) {
    displayError(error);
  }
  toast(message);
  return result;
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
    borrowed: data.loans.filter((loan) => loan.status !== "Devuelto").length,
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
      <div class="book-card-top"><span class="book-category">${escapeHTML(book.category)}</span></div>
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
  $("#dialog-meta").textContent = [book.pages, `${book.available} ejemplares disponibles`, rating.count ? `★ ${rating.average.toFixed(1)}/5 (${rating.count} reseñas)` : "Sin valoraciones"].filter(Boolean).join(" · ");
  $(".availability-note").textContent = `Estado físico: ${book.condition || "No especificado"}. ISBN: ${book.isbn || "No registrado"}.`;
  $("#student-loan-form")?.remove();
  if (data.user?.role === "student") {
    const form = document.createElement("form");
    form.id = "student-loan-form";
    form.className = "student-loan-form";
    const dueDateField = document.createElement("label");
    dueDateField.className = "form-field";
    dueDateField.append("Fecha de devolución (máximo 14 días)");
    const dueDate = document.createElement("input");
    dueDate.type = "date";
    dueDate.name = "dueDate";
    dueDate.required = true;
    dueDate.min = dateToday();
    dueDate.max = dateAfterDays(dateToday(), 14);
    dueDate.value = dueDate.max;
    dueDateField.append(dueDate);

    const ticketField = document.createElement("label");
    ticketField.className = "ticket-option";
    const ticketRequested = document.createElement("input");
    ticketRequested.type = "checkbox";
    ticketRequested.name = "ticketRequested";
    ticketField.append(ticketRequested, document.createTextNode("Quiero un ticket físico para pegar en el libro"));

    const errorRegion = document.createElement("p");
    errorRegion.className = "form-error";
    errorRegion.setAttribute("role", "alert");
    errorRegion.hidden = true;
    const submit = document.createElement("button");
    submit.id = "student-book-request";
    submit.className = "action-button";
    submit.type = "submit";
    submit.textContent = book.available > 0 ? "Solicitar préstamo" : "Sin ejemplares disponibles";
    submit.disabled = book.available < 1;
    form.append(dueDateField, ticketField, errorRegion, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runAction(submit, async () => {
        await mutate("/requests", "POST", {
          type: "loan",
          bookId: book.id,
          dueDate: dueDate.value,
          ticketRequested: ticketRequested.checked,
        }, "Solicitud enviada. Espera la aprobación de biblioteca.");
        if (form.isConnected) $("#book-dialog").close();
      }, errorRegion);
    });
    $(".dialog-copy").append(form);
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
    .filter((loan) => loan.status !== "Devuelto"
      && (filter === "all" || loan.status === filter)
      && `${loan.user} ${loan.title}`.toLocaleLowerCase("es").includes(query));
  $("#loans-body").innerHTML = loans.map((loan) => {
    const remaining = (Date.parse(loan.dueDate) - Date.parse(dateToday())) / 86400000;
    const dueNote = remaining < 0 ? `${Math.abs(remaining)} días de atraso` : `${remaining} días restantes`;
    const returned = loan.status === "Devuelto";
    const ticket = loan.ticketId ? `<button class="table-action" type="button" data-view-ticket="${escapeHTML(loan.id)}">${escapeHTML(loan.ticketId)}</button>` : "—";
    const action = returned ? `<small>Devuelto ${formatDate(loan.returnedAt)}</small>` : `<button class="table-action" type="button" data-return-loan="${escapeHTML(loan.id)}">Registrar devolución</button>`;
    return `<tr><td><strong>${escapeHTML(loan.user)}</strong></td><td>${escapeHTML(loan.title)}</td>
      <td>${formatDate(loan.loanDate)}</td><td>${formatDate(loan.dueDate)}${returned ? "" : `<small>${dueNote}</small>`}</td>
      <td>${ticket}</td><td>${statusPill(loan.status)}</td><td>${action}</td></tr>`;
  }).join("");
  $("#loans-empty").hidden = loans.length > 0;
}

function showLoanTicket(id) {
  const loan = data.loans.find((item) => item.id === id);
  if (!loan?.ticketId) {
    toast("No hay un ticket disponible para este préstamo.", "error");
    return;
  }
  $("#ticket-id").textContent = loan.ticketId;
  $("#ticket-student").textContent = loan.user;
  $("#ticket-book").textContent = data.books.find((book) => book.id === loan.bookId)?.title || loan.bookTitle || "Libro eliminado";
  $("#ticket-loan-date").textContent = formatDate(loan.loanDate);
  $("#ticket-due-date").textContent = formatDate(loan.dueDate);
  $("#ticket-dialog").showModal();
}

function renderRequests() {
  const filter = $("#request-filter").value;
  const requests = [...data.requests].reverse().filter((request) => filter === "all" || request.status === filter);
  $("#requests-body").innerHTML = requests.map((request) => {
    const book = data.books.find((item) => item.id === request.bookId);
    const type = request.type === "loan" ? "Préstamo" : "Devolución";
    const ticketLoan = request.ticketId ? data.loans.find((loan) => loan.ticketId === request.ticketId) : null;
    const ticket = ticketLoan
      ? `<div class="row-actions"><span>${escapeHTML(request.ticketId)}</span><button class="table-action" type="button" data-view-ticket="${escapeHTML(ticketLoan.id)}">Ver</button></div>`
      : request.ticketRequested ? `<small>${request.status === "Pendiente" ? "Se genera al aprobar" : "No generado"}</small>` : "—";
    const action = request.status === "Pendiente" ? `<div class="row-actions"><button type="button" data-approve-request="${escapeHTML(request.id)}">Aprobar</button><button type="button" class="danger-action" data-reject-request="${escapeHTML(request.id)}">Rechazar</button></div>` : "—";
    return `<tr><td>${escapeHTML(request.student)}</td><td>${escapeHTML(book?.title || request.bookTitle || "Libro eliminado")}</td><td>${type}</td><td>${formatDate(request.createdAt)}</td><td>${formatDate(request.dueDate)}</td><td>${ticket}</td><td>${statusPill(request.status)}</td><td>${action}</td></tr>`;
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
    ...requests.map((item) => ({ item, when: item.createdAt, dueDate: item.dueDate, ticketId: item.ticketId, ticketRequested: item.ticketRequested, label: item.type === "loan" ? "Solicitud de préstamo" : "Solicitud de devolución" })),
    ...loans.map((item) => ({ item, when: item.loanDate, dueDate: item.dueDate, ticketId: item.ticketId, label: "Préstamo", returnable: item.status !== "Devuelto" })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  $("#student-requests-body").innerHTML = rows.map(({ item, when, dueDate, ticketId, ticketRequested, label, returnable }) => {
    const book = data.books.find((entry) => entry.id === item.bookId);
    const returnPending = requests.some((request) => request.type === "return" && request.loanId === item.id && request.status === "Pendiente");
    const action = returnable && !returnPending ? `<button class="table-action" data-student-return="${escapeHTML(item.id)}" type="button">Solicitar devolución</button>` : "—";
    const ticket = ticketId
      ? escapeHTML(ticketId)
      : ticketRequested ? (item.status === "Pendiente" ? "Al aprobar" : "No generado") : "—";
    return `<tr><td>${escapeHTML(book?.title || item.bookTitle || "Libro eliminado")}</td><td>${label}</td><td>${formatDate(when)}</td><td>${formatDate(dueDate)}</td><td>${ticket}</td><td>${statusPill(item.status)}</td><td>${action}</td></tr>`;
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
  const version = renderVersion;
  const empty = $("#audit-empty");
  empty.hidden = false;
  empty.textContent = "Cargando historial…";
  $("#audit-body").replaceChildren();
  try {
    const { entries } = await api("/audit");
    if (version !== renderVersion) return;
    $("#audit-body").innerHTML = entries.map(({ at, action, target, actor }) => `<tr>
      <td><time datetime="${escapeHTML(at)}">${dateTime.format(new Date(at))}</time></td>
      <td>${escapeHTML(action)}</td><td>${escapeHTML(target.label)}<small>${escapeHTML(target.id)}</small></td>
      <td>${escapeHTML(actor.name)}</td><td>${escapeHTML(roleNames[actor.role] || actor.role)}</td><td>${escapeHTML(actor.identifier || "—")}</td>
    </tr>`).join("");
    empty.textContent = "Aún no hay acciones registradas.";
    empty.hidden = entries.length > 0;
  } catch (error) {
    if (version === renderVersion) displayError(error, empty);
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
    } else if (field.type === "checkbox") {
      input = `<input name="${name}" type="checkbox" value="true" ${field.checked ? "checked" : ""}>`;
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
      const result = await onSubmit(Object.fromEntries(new FormData(form)));
      dialog.close();
      if (result?.ticketId) showLoanTicket(result.id);
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
    { name: "user", label: "Nombre del estudiante", maxlength: 100 },
    { name: "bookId", label: "Libro", type: "select", options },
    { name: "loanDate", label: "Fecha de préstamo", type: "date", value: today },
    { name: "dueDate", label: "Fecha límite de devolución", type: "date", value: due },
    { name: "ticketRequested", label: "Generar ticket de préstamo", type: "checkbox" },
  ], (values) => mutate("/loans", "POST", {
    ...values,
    ticketRequested: Boolean(values.ticketRequested),
  }, "Préstamo registrado y stock actualizado."));
}

function addReview(review) {
  const eligibleBookIds = new Set([
    ...data.requests.filter((request) => request.type === "loan").map((request) => request.bookId),
    ...data.loans.map((loan) => loan.bookId),
  ]);
  const options = data.books
    .filter((book) => data.user.role === "admin" || eligibleBookIds.has(book.id))
    .map((book) => [book.id, book.title]);
  if (review && !data.books.some((book) => book.id === review.bookId)) options.unshift([review.bookId, review.bookTitle || "Libro eliminado"]);
  if (!options.length) {
    toast(data.user.role === "student"
      ? "Primero debes solicitar un préstamo para poder reseñar un libro."
      : "No hay libros disponibles para reseñar.", "error");
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
    const ticketButton = event.target.closest("[data-view-ticket]");
    if (ticketButton) {
      showLoanTicket(ticketButton.dataset.viewTicket);
      return;
    }
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
    const ticketButton = event.target.closest("[data-view-ticket]");
    if (ticketButton) {
      showLoanTicket(ticketButton.dataset.viewTicket);
      return;
    }
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
  $("#ticket-dialog-close")?.addEventListener("click", () => $("#ticket-dialog").close());
  $("#ticket-print")?.addEventListener("click", () => window.print());
}

function setupSectionNavigation() {
  if (sectionNavigationUpdate) {
    window.removeEventListener("scroll", sectionNavigationUpdate);
    window.removeEventListener("resize", sectionNavigationUpdate);
  }
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
  sectionNavigationUpdate = () => {
    const activationPoint = $(".site-header").getBoundingClientRect().bottom + NAV_ACTIVATION_OFFSET;
    const current = sections.reduce((closest, section) => {
      const distance = Math.abs(section.getBoundingClientRect().top - activationPoint);
      return distance < closest.distance ? { section, distance } : closest;
    }, { section: sections[0], distance: Infinity }).section;
    setActive(current?.id);
  };

  setActive(sections.find((section) => `#${section.id}` === location.hash)?.id || sections[0]?.id);
  window.addEventListener("scroll", sectionNavigationUpdate, { passive: true });
  window.addEventListener("resize", sectionNavigationUpdate);
  sectionNavigationUpdate();
}

function setupPage() {
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

  refreshState(true).catch((error) => showPageError(error.message));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshState(true).catch((error) => showPageError(error.message));
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== localApp?.storageKey) return;
    refreshState(true).catch((error) => showPageError(error.message));
  });
}

$("#current-year").textContent = new Date().getFullYear();
bindUI();
setupPage();
