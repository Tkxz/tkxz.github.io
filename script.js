const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const bookCoverArtworks = {};
const googleBookCoverCacheKey = "biblioteca-google-book-covers-v1";
const googleBookCoverCache = new Map();
const googleBookCoverPending = new Map();
let googleBookCoverFlushScheduled = false;
let googleBookCoverRequestNumber = 0;
try {
  const savedGoogleCovers = JSON.parse(localStorage.getItem(googleBookCoverCacheKey) || "{}");
  Object.entries(savedGoogleCovers).forEach(([isbn, cover]) => googleBookCoverCache.set(isbn, cover));
} catch (error) {}

const normalizeBookISBN = (value) => String(value || "").replace(/^ISBN:?/i, "").replace(/[^0-9x]/gi, "").toUpperCase();
const localCoverArtworkForBook = (book) => globalThis.BIBLIOTECA_BOOK_COVERS?.[book?.id] || "";
const googleBookCoverForBook = () => null;
const coverArtworkForBook = (book) => localCoverArtworkForBook(book);
const googleBooksInfoURLForBook = () => "";

function persistGoogleBookCoverCache() {
  try {
    localStorage.setItem(googleBookCoverCacheKey, JSON.stringify(Object.fromEntries([...googleBookCoverCache].slice(-600))));
  } catch (error) {}
}

function googleBookURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    const trustedHost = url.hostname === "books.google.com" || url.hostname.endsWith(".books.googleusercontent.com");
    return url.protocol === "https:" && trustedHost ? url.href : "";
  } catch (error) {
    return "";
  }
}

function flushGoogleBookCoverQueue() {
  googleBookCoverFlushScheduled = false;
  const batch = [...googleBookCoverPending.entries()];
  googleBookCoverPending.clear();
  if (!batch.length) return;

  const callbackName = `__bibliotecaGoogleCovers${++googleBookCoverRequestNumber}`;
  const request = document.createElement("script");
  const params = new URLSearchParams({
    bibkeys: batch.map(([isbn]) => `ISBN:${isbn}`).join(","),
    jscmd: "viewapi",
    callback: callbackName,
  });
  let settled = false;
  const finish = (payload, successful) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    request.remove();
    delete window[callbackName];
    const googleBooks = payload?.books || {};
    for (const [isbn, waiters] of batch) {
      let match = Object.entries(googleBooks).find(([key, value]) => normalizeBookISBN(key) === isbn || normalizeBookISBN(value?.bib_key) === isbn)?.[1];
      const result = match ? {
        thumbnailUrl: googleBookURL(match.thumbnail_url),
        infoUrl: googleBookURL(match.info_url),
      } : null;
      if (successful) googleBookCoverCache.set(isbn, result?.thumbnailUrl || result?.infoUrl ? result : null);
      waiters.forEach((resolve) => resolve(successful ? result : null));
    }
    if (successful) persistGoogleBookCoverCache();
  };
  const timeoutId = setTimeout(() => finish(null, false), 9000);
  window[callbackName] = (payload) => finish(payload, true);
  request.onerror = () => finish(null, false);
  request.src = `https://books.google.com/books?${params.toString()}`;
  document.head.appendChild(request);
}

function requestGoogleBookCover(book) {
  const isbn = normalizeBookISBN(book?.isbn);
  if (!isbn || globalThis.BIBLIOTECA_REJECTED_BOOK_ISBNS?.includes(isbn) || googleBookCoverCache.has(isbn)) return Promise.resolve(googleBookCoverForBook(book));
  return new Promise((resolve) => {
    const waiters = googleBookCoverPending.get(isbn) || [];
    waiters.push(resolve);
    googleBookCoverPending.set(isbn, waiters);
    if (googleBookCoverFlushScheduled) return;
    googleBookCoverFlushScheduled = true;
    setTimeout(flushGoogleBookCoverQueue, 0);
  });
}

async function loadGoogleBookCovers(books) {
  return false;
}

function updateGoogleBooksLink(book) {
  const link = $("#google-books-link");
  if (!link) return;
  const url = googleBooksInfoURLForBook(book);
  link.href = url || "#";
  link.hidden = !url;
}

function refreshOpenGoogleBooksLink() {
  const dialog = $("#book-dialog");
  if (!dialog?.open) return;
  const book = data.books.find((item) => String(item.id) === String(dialog.dataset.bookId));
  if (!book) return;
  updateGoogleBooksLink(book);
  const cover = $("#dialog-cover");
  const imageMarkup = bookCoverImageMarkup(book, "dialog-cover-image");
  if (cover && imageMarkup) {
    cover.className = "dialog-cover dialog-cover-photo";
    cover.innerHTML = imageMarkup;
  }
}

function bookCoverImageMarkup(book, className) {
  const source = localCoverArtworkForBook(book);
  if (!source) return "";
  const url = escapeHTML(source);
  // En tarjetas y detalle, un fondo difuminado de la propia portada rellena el espacio sobrante
  // (portadas cuadradas o de proporción distinta) sin recortar ni deformar la imagen.
  const backdrop = /^(book-cover-image|dialog-cover-image|inventory-detail-cover-image|mobile-shelf-cover)$/.test(className)
    ? `<span class="cover-backdrop" style="background-image:url('${url}')" aria-hidden="true"></span>` : "";
  return `${backdrop}<img class="${className}" src="${url}" alt="" loading="lazy" decoding="async" data-book-cover-image="true">`;
}
document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.dataset.bookCoverImage) return;
  image.parentElement?.querySelector(".cover-backdrop")?.remove();
  image.remove();
}, true);
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
const formatDateLabel = (value) => value
  ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`))
  : "Seleccionar fecha";
const dateAsISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatDate = (value) => {
  if (!value) return "—";
  if (value.length === 10) return new Date(`${value}T12:00:00`).toLocaleDateString("es-CL");
  return localDate.format(new Date(value)).split("-").reverse().join("-");
};
const isLateReturn = (loan) => {
  if (!loan.returnedAt || !loan.dueDate) return false;
  const returnDate = loan.returnedAt.length === 10
    ? loan.returnedAt
    : localDate.format(new Date(loan.returnedAt));
  return returnDate > loan.dueDate;
};

let activeDatePicker = null;
let activeSelectPicker = null;
let datePickerDismissalInstalled = false;
let datePickerInstance = 0;
const datePickerInstances = new WeakMap();
const selectPickerInstances = new WeakMap();

function closeDatePicker(returnFocus = false) {
  if (!activeDatePicker) return;
  const { control, popup, trigger } = activeDatePicker;
  if (activeDatePicker.topLayerOpen) popup.hidePopover();
  popup.hidden = true;
  control.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  activeDatePicker = null;
  if (returnFocus) trigger.focus();
}

function closeSelectPicker(returnFocus = false) {
  if (!activeSelectPicker) return;
  const { control, popup, trigger, topLayerOpen } = activeSelectPicker;
  if (topLayerOpen) popup.hidePopover();
  popup.hidden = true;
  control.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  activeSelectPicker = null;
  if (returnFocus) trigger.focus();
}

function installPickerDismissal() {
  if (datePickerDismissalInstalled) return;
  document.addEventListener("pointerdown", (event) => {
    if (activeDatePicker && !activeDatePicker.control.contains(event.target)) closeDatePicker();
    if (activeSelectPicker && !activeSelectPicker.control.contains(event.target)) closeSelectPicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (activeSelectPicker) {
      event.preventDefault();
      event.stopPropagation();
      closeSelectPicker(true);
    } else if (activeDatePicker) {
      event.preventDefault();
      event.stopPropagation();
      closeDatePicker(true);
    }
  });
  datePickerDismissalInstalled = true;
}

function renderDatePicker(state) {
  const { input, popup, month } = state;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const min = input.dataset.minDate || "";
  const max = input.dataset.maxDate || "";
  const monthLabel = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(firstDay);
  const heading = popup.querySelector(".calendar-month");
  heading.textContent = monthLabel.charAt(0).toLocaleUpperCase("es-CL") + monthLabel.slice(1);
  popup.setAttribute("aria-labelledby", heading.id);
  popup.querySelector(".calendar-grid").replaceChildren();

  const previousMonth = new Date(year, monthIndex, 0);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  popup.querySelector("[data-calendar-prev]").disabled = Boolean(min && dateAsISO(previousMonth) < min);
  popup.querySelector("[data-calendar-next]").disabled = Boolean(max && dateAsISO(nextMonth) > max);

  const grid = popup.querySelector(".calendar-grid");
  const leadingDays = (firstDay.getDay() + 6) % 7;
  for (let blank = 0; blank < leadingDays; blank += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-empty";
    emptyCell.setAttribute("aria-hidden", "true");
    grid.append(emptyCell);
  }

  const today = dateToday();
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, monthIndex, day);
    const value = dateAsISO(date);
    const button = document.createElement("button");
    button.className = "calendar-day";
    button.type = "button";
    button.textContent = String(day);
    button.dataset.calendarDate = value;
    button.setAttribute("aria-label", formatDateLabel(value));
    button.setAttribute("aria-pressed", String(value === input.value));
    button.disabled = Boolean((min && value < min) || (max && value > max));
    if (value === today) button.classList.add("is-today");
    if (value === input.value) button.classList.add("is-selected");
    grid.append(button);
  }

  const trailingDays = (7 - (leadingDays + lastDay.getDate()) % 7) % 7;
  for (let blank = 0; blank < trailingDays; blank += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-empty";
    emptyCell.setAttribute("aria-hidden", "true");
    grid.append(emptyCell);
  }
  const todayButton = popup.querySelector("[data-calendar-today]");
  todayButton.disabled = Boolean((min && today < min) || (max && today > max));
  todayButton.setAttribute("aria-label", `Elegir hoy, ${formatDateLabel(today)}`);
  popup.querySelector(".calendar-caption").textContent = min || max
    ? `Fechas disponibles${min ? ` desde ${formatDateLabel(min)}` : ""}${max ? ` hasta ${formatDateLabel(max)}` : ""}`
    : "Selecciona una fecha";
}

function updateDatePickerBounds(input, min, max) {
  input.dataset.minDate = min || "";
  input.dataset.maxDate = max || "";
  if (min && input.value < min) input.value = min;
  if (max && input.value > max) input.value = max;
  const picker = datePickerInstances.get(input);
  if (!picker) return;
  picker.updateTrigger();
  if (activeDatePicker === picker.state && input.value) {
    const [year, month] = input.value.split("-").map(Number);
    picker.state.month = new Date(year, month - 1, 1);
    renderDatePicker(picker.state);
    positionDatePicker(picker.state);
  }
}

function positionDatePicker(state) {
  positionPickerPopover(state.control, state.trigger, state.popup);
}

function positionPickerPopover(control, trigger, popup) {
  const controlRect = control.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const left = Math.max(12, Math.min(triggerRect.left, innerWidth - popupRect.width - 12));
  const roomBelow = innerHeight - triggerRect.bottom;
  const roomAbove = triggerRect.top;
  const above = roomBelow < popupRect.height + 12 && roomAbove > popupRect.height + 12;
  const preferredTop = above
    ? triggerRect.top - popupRect.height - 8
    : triggerRect.bottom + 8;
  const top = Math.max(12, Math.min(preferredTop, innerHeight - popupRect.height - 12));
  const topLayer = typeof popup.showPopover === "function";
  popup.style.left = `${topLayer ? left : left - controlRect.left}px`;
  popup.style.top = `${topLayer ? top : top - controlRect.top}px`;
}

function attachDatePicker(input) {
  if (input.dataset.customCalendar === "true") return;
  input.dataset.customCalendar = "true";
  input.dataset.minDate = input.min;
  input.dataset.maxDate = input.max;
  input.required = false;
  input.type = "hidden";

  const control = document.createElement("span");
  control.className = "date-picker-control";
  input.parentNode.insertBefore(control, input);
  control.append(input);

  const trigger = document.createElement("button");
  trigger.className = "date-picker-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="date-picker-label"></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M7.5 3.5v3M16.5 3.5v3M4 9.5h16"></path></svg>`;
  control.append(trigger);

  const popup = document.createElement("div");
  popup.className = "calendar-popover";
  popup.setAttribute("popover", "manual");
  if (typeof popup.showPopover === "function") popup.classList.add("is-top-layer");
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.innerHTML = `<div class="calendar-header">
      <button type="button" class="calendar-nav" data-calendar-prev aria-label="Mes anterior">‹</button>
      <h3 class="calendar-month"></h3>
      <button type="button" class="calendar-nav" data-calendar-next aria-label="Mes siguiente">›</button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="calendar-grid"></div>
    <div class="calendar-footer"><span class="calendar-caption"></span><button type="button" data-calendar-today>Hoy</button></div>`;
  popup.querySelector(".calendar-month").id = `calendar-month-${++datePickerInstance}`;
  control.append(popup);

  const updateTrigger = () => {
    const label = formatDateLabel(input.value);
    trigger.querySelector(".date-picker-label").textContent = label;
    trigger.setAttribute("aria-label", `${input.closest("label")?.childNodes[0]?.textContent.trim() || "Fecha"}: ${label}`);
  };
  const getInitialMonth = () => {
    const value = input.value || input.dataset.minDate || dateToday();
    const [year, month] = value.split("-").map(Number);
    return new Date(year, month - 1, 1);
  };
  const state = { input, control, trigger, popup, month: getInitialMonth(), topLayerOpen: false };
  updateTrigger();
  datePickerInstances.set(input, { state, updateTrigger });

  trigger.addEventListener("click", () => {
    if (activeDatePicker?.trigger === trigger) {
      closeDatePicker();
      return;
    }
    closeSelectPicker();
    closeDatePicker();
    activeDatePicker = state;
    state.month = getInitialMonth();
    renderDatePicker(state);
    popup.hidden = false;
    if (typeof popup.showPopover === "function") {
      popup.showPopover();
      state.topLayerOpen = true;
    }
    control.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    positionDatePicker(state);
    (popup.querySelector(`[data-calendar-date="${input.value}"]:not(:disabled)`)
      || popup.querySelector(".calendar-day:not(:disabled)"))?.focus();
  });

  popup.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.hasAttribute("data-calendar-prev")) {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      renderDatePicker(state);
      positionDatePicker(state);
      popup.querySelector("[data-calendar-prev]").focus();
    } else if (button.hasAttribute("data-calendar-next")) {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      renderDatePicker(state);
      positionDatePicker(state);
      popup.querySelector("[data-calendar-next]").focus();
    } else {
      input.value = button.dataset.calendarDate || dateToday();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      updateTrigger();
      closeDatePicker(true);
    }
  });

  installPickerDismissal();
}

function refreshCustomSelect(select) {
  const instance = selectPickerInstances.get(select);
  if (!instance) return;
  if (instance.rating) {
    instance.update();
    return;
  }
  const selected = select.selectedOptions[0];
  const label = selected?.textContent.trim() || "Seleccionar una opción";
  instance.label.textContent = label;
  instance.trigger.setAttribute("aria-label", `${instance.name}: ${label}`);
  instance.trigger.disabled = select.disabled;
}

function attachRatingPicker(select) {
  if (selectPickerInstances.has(select)) return;
  select.required = false;
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const control = document.createElement("span");
  control.className = "rating-picker-control";
  select.parentNode.insertBefore(control, select);
  control.append(select);
  const group = document.createElement("div");
  group.className = "rating-picker";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", select.closest("label")?.childNodes[0]?.textContent.trim() || "Calificación");
  const stars = document.createElement("div");
  stars.className = "rating-stars";
  const feedback = document.createElement("span");
  feedback.className = "rating-feedback";
  feedback.setAttribute("aria-live", "polite");
  group.append(stars, feedback);
  control.append(group);

  let activePointerId = null;
  let startingRating = null;
  let dragChangedRating = false;
  let suppressDragClick = false;
  let ratingCommitted = false;
  const setRating = (value) => {
    ratingCommitted = true;
    select.value = String(value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const buttons = [...select.options].map((option) => {
    const value = Number(option.value);
    const button = document.createElement("button");
    button.className = "rating-star";
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.ratingValue = String(value);
    button.setAttribute("aria-label", option.textContent.trim());
    button.addEventListener("click", (event) => {
      if (suppressDragClick && event.detail > 0) {
        suppressDragClick = false;
        return;
      }
      setRating(value);
    });
    stars.append(button);
    return button;
  });
  const instance = { select, group, buttons, feedback };
  const updateRatingPicker = (preview = null) => {
    const selected = Number(select.value);
    const shown = Number(preview ?? selected);
    buttons.forEach((button) => {
      const value = Number(button.dataset.ratingValue);
      button.textContent = value <= shown ? "★" : "☆";
      button.classList.toggle("is-lit", value <= shown);
      button.setAttribute("aria-checked", String(value === selected));
      button.tabIndex = value === selected ? 0 : -1;
      button.disabled = select.disabled;
    });
    feedback.textContent = `${shown} ${shown === 1 ? "estrella" : "estrellas"}`;
  };
  const updateFromPointer = (event) => {
    if (event.pointerId !== activePointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-rating-value]");
    if (!target || !group.contains(target)) return;
    const value = Number(target.dataset.ratingValue);
    if (value !== startingRating) dragChangedRating = true;
    setRating(value);
  };
  const finishPointer = (event) => {
    if (event.pointerId !== activePointerId) return;
    if (event.type === "pointerup") updateFromPointer(event);
    suppressDragClick = event.type === "pointerup" && dragChangedRating;
    activePointerId = null;
    document.removeEventListener("pointermove", updateFromPointer);
    document.removeEventListener("pointerup", finishPointer);
    document.removeEventListener("pointercancel", finishPointer);
    if (suppressDragClick) window.setTimeout(() => { suppressDragClick = false; }, 80);
  };
  group.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-rating-value]");
    if (!button || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    activePointerId = event.pointerId;
    startingRating = Number(button.dataset.ratingValue);
    dragChangedRating = false;
    setRating(startingRating);
    document.addEventListener("pointermove", updateFromPointer);
    document.addEventListener("pointerup", finishPointer);
    document.addEventListener("pointercancel", finishPointer);
  });
  group.addEventListener("pointerover", (event) => {
    const button = event.target.closest("[data-rating-value]");
    if (button && !ratingCommitted) updateRatingPicker(Number(button.dataset.ratingValue));
  });
  group.addEventListener("pointerleave", () => updateRatingPicker());
  group.addEventListener("focusin", (event) => {
    const button = event.target.closest("[data-rating-value]");
    if (button && !ratingCommitted) updateRatingPicker(Number(button.dataset.ratingValue));
  });
  group.addEventListener("focusout", (event) => {
    if (!group.contains(event.relatedTarget)) updateRatingPicker();
  });
  group.addEventListener("keydown", (event) => {
    const current = Number(event.target.closest("[data-rating-value]")?.dataset.ratingValue);
    if (!current) return;
    const values = buttons.map((button) => Number(button.dataset.ratingValue));
    const next = event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(Math.max(...values), current + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(Math.min(...values), current - 1)
      : event.key === "Home" ? Math.min(...values)
      : event.key === "End" ? Math.max(...values)
      : null;
    if (next === null) return;
    event.preventDefault();
    const button = buttons.find((item) => Number(item.dataset.ratingValue) === next);
    button?.click();
    button?.focus();
  });
  selectPickerInstances.set(select, { rating: true, update: updateRatingPicker });
  select.addEventListener("change", () => updateRatingPicker());
  updateRatingPicker();
}

function attachCustomSelect(select) {
  if (select.hasAttribute("data-rating-picker")) {
    attachRatingPicker(select);
    return;
  }
  if (selectPickerInstances.has(select)) return;
  const name = select.getAttribute("aria-label")
    || select.closest("label")?.childNodes[0]?.textContent.trim()
    || "Seleccionar una opción";
  select.required = false;
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const control = document.createElement("span");
  control.className = "custom-select-control";
  select.parentNode.insertBefore(control, select);
  control.append(select);

  const trigger = document.createElement("button");
  trigger.className = "custom-select-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="custom-select-label"></span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5"></path></svg>`;
  control.append(trigger);

  const popup = document.createElement("div");
  popup.className = "custom-select-popover";
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", `${name}: opciones`);
  popup.setAttribute("popover", "manual");
  if (typeof popup.showPopover === "function") popup.classList.add("is-top-layer");
  popup.hidden = true;
  control.append(popup);

  const instance = { select, control, trigger, popup, name, label: trigger.querySelector(".custom-select-label"), topLayerOpen: false };
  selectPickerInstances.set(select, { ...instance, rating: false });
  const refresh = () => refreshCustomSelect(select);
  const renderOptions = () => {
    popup.replaceChildren();
    [...select.options].forEach((option) => {
      const button = document.createElement("button");
      button.className = "select-option";
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.selected));
      button.disabled = option.disabled;
      button.dataset.selectValue = option.value;
      button.textContent = option.textContent.trim();
      popup.append(button);
    });
  };
  trigger.addEventListener("click", () => {
    if (activeSelectPicker?.trigger === trigger) {
      closeSelectPicker();
      return;
    }
    closeDatePicker();
    closeSelectPicker();
    renderOptions();
    popup.hidden = false;
    if (typeof popup.showPopover === "function") {
      popup.showPopover();
      instance.topLayerOpen = true;
    }
    control.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    activeSelectPicker = instance;
    positionPickerPopover(control, trigger, popup);
    const selected = popup.querySelector('[aria-selected="true"]:not(:disabled)')
      || popup.querySelector(".select-option:not(:disabled)");
    selected?.focus();
    selected?.scrollIntoView({ block: "nearest" });
  });
  popup.addEventListener("click", (event) => {
    const option = event.target.closest(".select-option");
    if (!option || option.disabled) return;
    select.value = option.dataset.selectValue;
    closeSelectPicker(true);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  popup.addEventListener("keydown", (event) => {
    const options = [...popup.querySelectorAll(".select-option:not(:disabled)")];
    const current = options.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, current + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next !== null) {
      event.preventDefault();
      options[next]?.focus();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      instance.searchTerm = `${instance.searchTerm || ""}${event.key}`.toLocaleLowerCase("es");
      window.clearTimeout(instance.searchTimer);
      instance.searchTimer = window.setTimeout(() => { instance.searchTerm = ""; }, 700);
      const start = Math.max(0, current + 1);
      const orderedOptions = [...options.slice(start), ...options.slice(0, start)];
      const match = orderedOptions.find((option) => option.textContent.trim().toLocaleLowerCase("es").includes(instance.searchTerm));
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  });
  control.addEventListener("focusout", (event) => {
    if (activeSelectPicker === instance && !control.contains(event.relatedTarget)) closeSelectPicker();
  });
  select.addEventListener("change", refresh);
  selectPickerInstances.set(select, { ...instance, rating: false, refresh });
  refresh();
  installPickerDismissal();
}

let data = { user: null, books: [], reviews: [], requests: [], loans: [] };
let auditEntries = [];
let stateRequest = 0;
let renderVersion = 0;
let studentActivityMode = "history";
let selectedSummaryPanel = "read";
let studentPanelInitialized = false;
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
  if (!message) return;
  toast(message, "error");
  const loader = $("#page-loading");
  if (loader && !loader.hidden) {
    loader.querySelector(".loading-layout").hidden = true;
    const error = loader.querySelector(".loading-error");
    error.textContent = message;
    error.hidden = false;
    loader.setAttribute("aria-busy", "false");
  }
}

function clearRenderedData() {
  renderVersion += 1;
  studentPanelInitialized = false;
  selectedSummaryPanel = "read";
  studentActivityMode = "history";
  auditEntries = [];
  closeDatePicker();
  closeSelectPicker();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  if (sectionNavigationUpdate) {
    window.removeEventListener("scroll", sectionNavigationUpdate);
    window.removeEventListener("resize", sectionNavigationUpdate);
    window.removeEventListener("hashchange", sectionNavigationUpdate);
    window.removeEventListener("popstate", sectionNavigationUpdate);
    sectionNavigationUpdate = null;
  }
  document.querySelectorAll("#management-form, #inventory-body, #loans-body, #requests-body, #audit-body, #student-requests-body, #management-stats, #student-summary, #book-grid, #review-list, #student-review-list, #student-name, #review-book-filter")
    .forEach((region) => region.replaceChildren());
  if ($("#student-read-books")) $("#student-read-books").hidden = true;
  if ($("#student-activity")) $("#student-activity").hidden = true;
  if ($("#student-request-details")) $("#student-request-details").hidden = true;
  ["ticket-id", "ticket-student", "ticket-book", "ticket-loan-date", "ticket-due-date", "ticket-returned-at", "ticket-return-status", "ticket-comment"].forEach((id) => {
    const field = $(`#${id}`);
    if (field) field.textContent = "";
  });
  $("#ticket-returned-field").hidden = true;
  $("#ticket-return-status-field").hidden = true;
  $("#ticket-returned-at")?.classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-return-status")?.classList.remove("return-date--late", "return-date--on-time");
  const ticketCommentField = $("#ticket-comment-field");
  if (ticketCommentField) ticketCommentField.hidden = true;
  [
    ["ticket-heading", "Ticket de préstamo"],
    ["ticket-student-label", "Estudiante"],
    ["ticket-book-label", "Libro"],
    ["ticket-loan-date-label", "Fecha de préstamo"],
    ["ticket-due-date-label", "Fecha de devolución"],
  ].forEach(([id, value]) => {
    const field = $(`#${id}`);
    if (field) field.textContent = value;
  });
  $("#management-form").onsubmit = null;
  const menuToggle = $(".menu-toggle");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Abrir menú de navegación");
  $("#main-nav").classList.remove("is-open");
}

function renderPage() {
  clearRenderedData();
  const user = data.user;
  const pageMatchesRole = Boolean(user && roleAllowsPage(user.role));
  $("#main-nav").hidden = !pageMatchesRole;
  $(".menu-toggle").hidden = !pageMatchesRole;
  document.querySelectorAll("#main-nav a").forEach((link) => { link.hidden = !pageMatchesRole; });
  $("#app-main").hidden = false;

  if (!pageMatchesRole) {
    showPageError(user ? "El perfil configurado no coincide con esta página." : "No se pudo cargar el perfil configurado para esta página.");
    return;
  }
  const pageLoading = $("#page-loading");
  if (pageLoading) pageLoading.hidden = true;

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

function animateStatValue(element, target) {
  const previous = Number(element.textContent || 0);
  element.dataset.value = String(target);
  if (previous === target) {
    element.textContent = target;
    return;
  }
  const card = element.closest(".stat-card");
  if (card) {
    const direction = target > previous ? "is-increasing" : "is-decreasing";
    card.classList.remove("is-updating", "is-increasing", "is-decreasing");
    void card.offsetWidth;
    card.classList.add("is-updating", direction);
    window.clearTimeout(card.highlightTimer);
    card.highlightTimer = window.setTimeout(() => card.classList.remove("is-updating", "is-increasing", "is-decreasing"), previous === 0 ? 2050 : 1350);
  }
  if (element.counterFrame) cancelAnimationFrame(element.counterFrame);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now() + (previous === 0 ? 180 : 0);
  const duration = reducedMotion ? 1050 : previous === 0 ? 1650 : 1050;
  const tick = (now) => {
    const progress = Math.max(0, Math.min((now - startedAt) / duration, 1));
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = Math.round(previous + (target - previous) * eased);
    if (progress < 1) element.counterFrame = requestAnimationFrame(tick);
    else element.counterFrame = null;
  };
  element.counterAnimation?.cancel();
  if (!reducedMotion) {
    element.counterAnimation = element.animate?.([
      { opacity: .55, transform: "translateY(7px) scale(.86)" },
      { opacity: 1, transform: "translateY(0) scale(1.05)", offset: .72 },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  element.counterFrame = requestAnimationFrame(tick);
}

function renderStats() {
  const stats = bookStats();
  const metrics = [
    ["titles", "Títulos registrados", data.books.length, "Colección"],
    ["available", "Ejemplares disponibles", stats.available, "En estantería"],
    ["borrowed", "Ejemplares prestados", stats.borrowed, "En circulación"],
    ["low", "Bajo stock", stats.low, "Una unidad disponible"],
    ["out", "Sin disponibilidad", stats.out, "Agotados"],
  ];
  const container = $("#management-stats");
  if (!container.querySelector("[data-stat-key]")) {
    container.innerHTML = metrics.map(([key, label, , note]) => `<article class="stat-card" data-stat-key="${key}"><span>${label}</span><strong class="stat-value" data-value="0">0</strong><small>${note}</small></article>`).join("");
  }
  metrics.forEach(([key, , value]) => {
    const card = container.querySelector(`[data-stat-key="${key}"]`);
    const number = card?.querySelector(".stat-value");
    if (number) animateStatValue(number, value);
  });
}

function ratingSummary(bookId) {
  const reviews = data.reviews.filter((review) => review.bookId === bookId);
  return { count: reviews.length, average: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0 };
}

function renderBookReviews(bookId, showAll = false) {
  const allReviews = data.reviews
    .filter((review) => review.bookId === bookId)
    .sort((a, b) => b.rating - a.rating || (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const reviews = showAll ? allReviews : allReviews.slice(0, 3);
  const viewAllButton = $("#dialog-view-all-reviews");
  if (viewAllButton) {
    viewAllButton.dataset.bookId = bookId;
    viewAllButton.hidden = showAll;
    viewAllButton.disabled = allReviews.length === 0;
  }

  $("#dialog-review-list").innerHTML = reviews.map((review) => `
    <article class="dialog-review-card">
      <div class="dialog-review-top">
        <strong>${escapeHTML(review.user)}</strong>
        <span class="review-stars" aria-label="${review.rating} de 5 estrellas">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>
      </div>
      <p>${escapeHTML(review.comment)}</p>
      <small>${formatDate(review.updatedAt || review.createdAt)}${review.updatedAt ? " · Editada" : ""}</small>
    </article>
  `).join("");
  $("#dialog-reviews-empty").hidden = reviews.length > 0;
}

function primaryCategory(category) {
  return String(category || "").split("/")[0].trim();
}

const catalogFilterCategories = [
  "Cuentos y leyendas",
  "Divulgación",
  "Literatura Infantil",
  "Misterio y fantasía",
  "Narrativa",
  "Poesía",
  "Teatro",
];

function catalogFilterCategory(book) {
  const category = primaryCategory(book.category).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  if (/^(teatro|artes escenicas)/.test(category)) return "Teatro";
  if (/^(poesia|prosa poetica)/.test(category)) return "Poesía";
  if (/^(cuento|folclore|leyenda|mito|fabula)/.test(category)) return "Cuentos y leyendas";
  if (/infantil/.test(category)) return "Literatura Infantil";
  if (/^(divulgacion|biografia|ecologia|educacion|ensayo|filosofia|geografia|historia|naturaleza|no ficcion|referencia|religion)/.test(category)) return "Divulgación";
  if (/misterio|fantasia|ciencia ficcion|policial|aventura/.test(category)) return "Misterio y fantasía";
  return "Narrativa";
}

function renderCategoryFilters() {
  const filterList = $(".filter-list");
  if (!filterList) return;

  const selected = filterList.querySelector(".filter-chip.selected")?.dataset.category || "Todos";
  const counts = new Map(catalogFilterCategories.map((category) => [category, 0]));
  data.books.forEach((book) => {
    const category = catalogFilterCategory(book);
    counts.set(category, counts.get(category) + 1);
  });

  filterList.innerHTML = [
    `<button class="filter-chip${selected === "Todos" ? " selected" : ""}" type="button" data-category="Todos" aria-pressed="${selected === "Todos"}">Todos <span>${data.books.length}</span></button>`,
    ...catalogFilterCategories.map((category) => {
      const count = counts.get(category);
      return `<button class="filter-chip${selected === category ? " selected" : ""}" type="button" data-category="${escapeHTML(category)}" aria-pressed="${selected === category}">${escapeHTML(category)} <span>${count}</span></button>`;
    }),
  ].join("");

  if (selected !== "Todos" && !counts.has(selected)) {
    const todos = filterList.querySelector("[data-category='Todos']");
    filterList.querySelector(".selected")?.classList.remove("selected");
    todos?.classList.add("selected");
    todos?.setAttribute("aria-pressed", "true");
  }

  requestAnimationFrame(() => {
    const active = filterList.querySelector(".filter-chip.selected");
    if (!active) return;
    const listRect = filterList.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.right > listRect.right) filterList.scrollLeft += activeRect.right - listRect.right + 8;
    if (activeRect.left < listRect.left) filterList.scrollLeft -= listRect.left - activeRect.left + 8;
  });
}

const BOOKS_PER_PAGE = 15;
let catalogPage = 1;
let selectedInventoryBookId = null;

function updateBookPagination(containerSelector, statusSelector, currentPage, totalItems) {
  const pageCount = Math.max(1, Math.ceil(totalItems / BOOKS_PER_PAGE));
  const page = Math.min(currentPage, pageCount);
  const pagination = $(containerSelector);
  pagination.hidden = pageCount <= 1;
  $(statusSelector).textContent = `Página ${page} de ${pageCount}`;
  pagination.querySelector('[data-page="previous"]').disabled = page === 1;
  pagination.querySelector('[data-page="next"]').disabled = page === pageCount;
  return { page, start: (page - 1) * BOOKS_PER_PAGE };
}

function renderMobileMyBooks() {
  const section = $("#mobile-my-books");
  const list = $("#mobile-my-books-list");
  if (!section || !list) return [];
  const requested = data.requests
    .filter((item) => item.type === "loan" && (item.status === "Pendiente"
      || (item.status === "Aprobada" && !data.loans.some((loan) => item.ticketId && loan.ticketId === item.ticketId))))
    .map((item) => ({
      book: data.books.find((book) => book.id === item.bookId),
      title: item.bookTitle,
      status: item.status === "Aprobada" ? "Listo para retirar" : "Solicitud pendiente",
      date: item.dueDate || item.createdAt,
      dateLabel: item.status === "Aprobada" ? "Próximo retiro" : "Solicitud enviada",
      icon: item.status === "Aprobada" ? "✓" : "◷",
    }));
  const borrowed = data.loans
    .filter((item) => item.status !== "Devuelto")
    .map((item) => ({
      book: data.books.find((book) => book.id === item.bookId),
      title: item.bookTitle,
      status: item.status === "Vencido" ? "Devolución pendiente" : "Préstamo activo",
      date: item.dueDate || item.loanDate,
      dateLabel: item.status === "Vencido" ? "Fecha de devolución" : "Próxima devolución",
      icon: item.status === "Vencido" ? "!" : "↗",
    }));
  const items = [...requested, ...borrowed]
    .filter((item) => item.title || item.book)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  list.innerHTML = items.length ? items.map(({ book, title, status, date, dateLabel, icon }) => `
    <article class="mobile-my-book-card${status === "Listo para retirar" ? " is-ready" : ""}">
      <div class="mobile-my-book-copy">
        <div class="mobile-my-book-status"><span aria-hidden="true">${icon}</span>${status}</div>
        <h4>${escapeHTML(book?.title || title || "Libro")}</h4>
        <p>${escapeHTML(book?.author || "Biblioteca escolar")}</p>
        ${date ? `<small><strong>${escapeHTML(dateLabel)}</strong> · ${escapeHTML(formatDate(String(date).slice(0, 10)))}</small>` : ""}
      </div>
      ${book ? (bookCoverImageMarkup(book, "mobile-my-book-cover") || `<span class="mobile-my-book-cover-fallback cover-art ${escapeHTML(book.cover || "cover-1")}" aria-hidden="true"></span>`) : ""}
    </article>`).join("") : '<p class="mobile-my-books-empty">Aún no tienes libros en seguimiento. Encuentra tu próxima lectura.</p>';
  section.hidden = false;
  return items.map((item) => item.book).filter(Boolean);
}

function renderMobileBookShelves(books) {
  const shelves = $("#mobile-book-shelves");
  if (!shelves) return;
  const readBookIds = new Set(getReadBooks().map((book) => book.id));
  const mobileShelfGroups = [
    ["Cuentos y leyendas", ["Cuentos y leyendas"]],
    ["Narrativa y aventuras", ["Narrativa", "Misterio y fantasía"]],
    ["Literatura Infantil", ["Literatura Infantil"]],
    ["Divulgación", ["Divulgación"]],
    ["Poesía", ["Poesía"]],
    ["Teatro", ["Teatro"]],
  ];
  shelves.innerHTML = mobileShelfGroups.map(([label, categories]) => {
    const booksInCategory = books.filter((book) => categories.includes(catalogFilterCategory(book)));
    if (!booksInCategory.length) return "";
    return `<section class="mobile-book-shelf" aria-label="${escapeHTML(label)}">
      <div class="mobile-shelf-heading"><h3>${escapeHTML(label)}<small>${booksInCategory.length} ${booksInCategory.length === 1 ? "título" : "títulos"}</small></h3><div class="mobile-shelf-controls"><button type="button" data-shelf-scroll="-1" aria-label="Desplazar ${escapeHTML(label)} hacia la izquierda">‹</button><button type="button" data-shelf-scroll="1" aria-label="Desplazar ${escapeHTML(label)} hacia la derecha">›</button></div></div>
      <div class="mobile-shelf-scroll">${booksInCategory.map((book) => {
        const shelfCover = bookCoverImageMarkup(book, "mobile-shelf-cover");
        const image = shelfCover ? `<span class="mobile-shelf-frame">${shelfCover}</span>` : "";
        const fallback = `<span class="mobile-shelf-cover-fallback cover-art ${escapeHTML(book.cover || "cover-1")}" aria-hidden="true"><span class="cover-title">${escapeHTML(book.title)}</span></span>`;
        const availability = book.available > 0 ? "Disponible" : "Lista de espera";
        return `<button class="mobile-book-tile${readBookIds.has(book.id) ? " is-read" : ""}" type="button" data-book="${escapeHTML(book.id)}" aria-label="Ver ${escapeHTML(book.title)} de ${escapeHTML(book.author)}">
          ${image || fallback}<strong>${escapeHTML(book.title)}</strong><span>${escapeHTML(book.author)}</span><small class="mobile-tile-availability${book.available > 0 ? " is-available" : " is-waiting"}">${availability}</small>
        </button>`;
      }).join("")}</div>
    </section>`;
  }).join("");
}

function renderCatalog(resetScroll = false) {
  const grid = $("#book-grid");
  if (!grid) return;
  const query = $("#book-search").value.trim().toLocaleLowerCase("es");
  const selected = $(".filter-chip.selected")?.dataset.category || "Todos";
  const availableOnly = Boolean($("#available-only")?.checked);
  const readBookIds = new Set(getReadBooks().map((book) => book.id));
  const visible = data.books.filter((book) =>
    (selected === "Todos" || catalogFilterCategory(book) === selected)
    && (!availableOnly || book.available > 0)
    && `${book.title} ${book.author} ${book.category} ${book.isbn}`.toLocaleLowerCase("es").includes(query)
  );
  if (resetScroll) catalogPage = 1;
  const pagination = updateBookPagination("#catalog-pagination", "#catalog-page-status", catalogPage, visible.length);
  catalogPage = pagination.page;
  const pageBooks = visible.slice(pagination.start, pagination.start + BOOKS_PER_PAGE);
  grid.innerHTML = pageBooks.map((book) => {
    const rating = ratingSummary(book.id);
    const isRead = readBookIds.has(book.id);
    const coverImage = coverArtworkForBook(book);
    const coverMarkup = bookCoverImageMarkup(book, "book-cover-image");
    const availabilityClass = book.available > 0 ? "is-available" : "is-unavailable";
    const availabilityLabel = book.available > 0 ? `${book.available} disponibles` : "Sin disponibilidad";
    return `<article class="book-card${isRead ? " is-read" : ""}">
      <div class="book-card-top"><span class="book-category">${escapeHTML(book.category)}</span>${isRead ? '<span class="read-badge"><span aria-hidden="true">✓</span> Leído</span>' : ""}</div>
      <button class="book-cover ${coverImage ? "book-cover-photo" : `cover-art ${escapeHTML(book.cover || "cover-1")}`}" type="button" data-book="${escapeHTML(book.id)}" aria-label="Ver detalles de ${escapeHTML(book.title)}">${coverImage ? coverMarkup : `<span class="cover-title">${escapeHTML(book.title)}</span><span class="cover-author">${escapeHTML(book.author)}</span>`}</button>
      <div class="book-info"><div><h3>${escapeHTML(book.title)}</h3><p>${escapeHTML(book.author)}</p><p class="catalog-availability ${availabilityClass}"><span aria-hidden="true"></span>${availabilityLabel}</p><p class="catalog-rating">${rating.count ? `★ ${rating.average.toFixed(1)} (${rating.count} reseñas)` : "Sin valoraciones"}</p></div>
      <button class="book-arrow" type="button" data-book="${escapeHTML(book.id)}" aria-label="Más información de ${escapeHTML(book.title)}">↗</button></div></article>`;
  }).join("");
  renderMobileBookShelves(pageBooks);
  const myBooks = renderMobileMyBooks();
  loadGoogleBookCovers([...pageBooks, ...myBooks]).then((updated) => {
    if (!updated) return;
    renderCatalog(false);
    refreshOpenGoogleBooksLink();
  });
  const scroll = $("#catalog-scroll");
  scroll.hidden = visible.length === 0;
  if (resetScroll) scroll.scrollTop = 0;
  $("#empty-state").hidden = visible.length > 0;
  const shownStart = visible.length ? pagination.start + 1 : 0;
  const shownEnd = Math.min(pagination.start + BOOKS_PER_PAGE, visible.length);
  $("#results-count").textContent = visible.length
    ? `Mostrando ${shownStart}–${shownEnd} de ${visible.length} ${visible.length === 1 ? "libro" : "libros"}`
    : "Mostrando 0 libros";
  const totalCount = $(".filter-chip[data-category='Todos'] span");
  if (totalCount) totalCount.textContent = data.books.length;
}

function showBookDetails(id) {
  const book = data.books.find((item) => item.id === id);
  if (!book) return;
  const cover = $("#dialog-cover");
  const coverImage = coverArtworkForBook(book);
  cover.className = `dialog-cover${coverImage ? " dialog-cover-photo" : ` cover-art ${book.cover || "cover-1"}`}`;
  cover.innerHTML = coverImage ? bookCoverImageMarkup(book, "dialog-cover-image") : `<span class="cover-title">${escapeHTML(book.title)}</span><span class="cover-author">${escapeHTML(book.author)}</span>`;
  $("#book-dialog").dataset.bookId = book.id;
  updateGoogleBooksLink(book);
  $("#dialog-category").textContent = book.category;
  $("#dialog-title").textContent = book.title;
  $("#dialog-author").textContent = `Por ${book.author}`;
  $("#dialog-description").textContent = book.description || "Sin descripción disponible.";
  const rating = ratingSummary(book.id);
  $("#dialog-meta").textContent = [book.pages, `${book.available} ejemplares disponibles`, rating.count ? `★ ${rating.average.toFixed(1)}/5 (${rating.count} reseñas)` : "Sin valoraciones"].filter(Boolean).join(" · ");
  renderBookReviews(book.id);
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
    attachDatePicker(dueDate);

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
    form.append(dueDateField, errorRegion, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runAction(submit, async () => {
        await mutate("/requests", "POST", {
          type: "loan",
          bookId: book.id,
          dueDate: dueDate.value,
          ticketRequested: true,
        }, "Solicitud enviada. Espera la aprobación de biblioteca.");
        if (form.isConnected) $("#book-dialog").close();
      }, errorRegion);
    });
    $(".dialog-copy").append(form);
  }
  const dialog = $("#book-dialog");
  dialog.showModal();
  dialog.scrollTop = 0;
  loadGoogleBookCovers([book]).then((updated) => {
    if (updated) refreshOpenGoogleBooksLink();
  });
}

let inventoryPage = 1;
let selectedInventoryRequestId = null;
let selectedInventoryLoanId = null;
let inventoryDefaultSelectionApplied = false;

function renderInventory(resetPage = false) {
  const query = $("#inventory-search").value.trim().toLocaleLowerCase("es");
  const filter = $("#inventory-filter").value;
  const books = data.books.filter((book) => {
    const availability = { available: book.available > 0, low: book.available === 1, out: book.available === 0, all: true };
    const [filterType, filterValue] = filter.includes(":") ? filter.split(/:(.*)/s).slice(0, 2) : ["all", "all"];
    const matchesFilter = filterType === "status" ? Boolean(availability[filterValue])
      : filterType === "theme" ? catalogFilterCategory(book) === filterValue
        : true;
    return matchesFilter && `${book.title} ${book.author} ${book.isbn} ${book.category}`.toLocaleLowerCase("es").includes(query);
  });
  if (resetPage) inventoryPage = 1;
  const pagination = updateBookPagination("#inventory-pagination", "#inventory-page-status", inventoryPage, books.length);
  inventoryPage = pagination.page;
  const visibleBooks = books.slice(pagination.start, pagination.start + BOOKS_PER_PAGE);
  const totalCopies = books.reduce((sum, book) => sum + Number(book.total || 0), 0);
  $("#inventory-count-summary").textContent = `${books.length} ${books.length === 1 ? "título" : "títulos"} · ${totalCopies} ${totalCopies === 1 ? "ejemplar" : "ejemplares"}`;
  $("#inventory-body").innerHTML = visibleBooks.map((book) => {
    const cover = bookCoverImageMarkup(book, "inventory-row-cover-image");
    const fallback = `<span class="inventory-row-cover-fallback cover-art ${escapeHTML(book.cover || "cover-1")}" aria-hidden="true"><span class="cover-title">${escapeHTML(book.title)}</span></span>`;
    return `<tr tabindex="0" data-inventory-book="${escapeHTML(book.id)}" aria-selected="${book.id === selectedInventoryBookId}">
      <td><div class="inventory-book-cell">${cover || fallback}<span class="inventory-book-copy"><strong>${escapeHTML(book.title)}</strong><small>${escapeHTML(book.author)}</small></span></div></td>
      <td><span class="inventory-theme">${escapeHTML(primaryCategory(book.category) || "Colección")}</span></td>
      <td class="inventory-total-cell">${book.total}</td>
      <td><span class="stock-number ${book.available === 0 ? "danger" : book.available === 1 ? "warning" : ""}">${book.available}</span></td>
      <td><div class="row-actions"><button type="button" data-edit-book="${escapeHTML(book.id)}">Ajustar</button><button type="button" class="danger-action inventory-delete-action" data-delete-book="${escapeHTML(book.id)}" aria-label="Eliminar ${escapeHTML(book.title)}">×</button></div></td>
    </tr>`;
  }).join("");
  loadGoogleBookCovers(visibleBooks).then((updated) => {
    if (updated) renderInventory();
  });
  $("#inventory-empty").hidden = books.length > 0;
  if (!inventoryDefaultSelectionApplied) {
    const nextRequest = data.requests.find((request) => request.type === "loan" && request.status === "Pendiente" && visibleBooks.some((book) => String(book.id) === String(request.bookId)));
    if (nextRequest) {
      selectedInventoryBookId = nextRequest.bookId;
      selectedInventoryRequestId = nextRequest.id;
    } else {
      const activeLoan = data.loans.find((loan) => loan.status !== "Devuelto" && visibleBooks.some((book) => String(book.id) === String(loan.bookId)));
      selectedInventoryBookId = activeLoan?.bookId || visibleBooks[0]?.id || null;
      selectedInventoryLoanId = activeLoan?.id || null;
    }
    inventoryDefaultSelectionApplied = true;
  }
  if (selectedInventoryBookId) {
    const selectedBook = books.find(({ id }) => String(id) === String(selectedInventoryBookId));
    if (selectedBook) showInventoryDetail(selectedBook);
    else closeInventoryDetail();
  }
}

function showInventoryDetail(book) {
  if (!book) return closeInventoryDetail();
  selectedInventoryBookId = book.id;
  const detail = $("#inventory-detail");
  const coverImage = coverArtworkForBook(book);
  const coverClass = escapeHTML(book.cover || "cover-1");
  const googleInfoURL = googleBooksInfoURLForBook(book);
  const pendingRequests = data.requests.filter((request) => request.type === "loan" && request.status === "Pendiente" && String(request.bookId) === String(book.id));
  const selectedRequest = pendingRequests.find((request) => String(request.id) === String(selectedInventoryRequestId)) || pendingRequests[0] || null;
  selectedInventoryRequestId = selectedRequest?.id || null;
  const activeLoans = data.loans.filter((loan) => loan.status !== "Devuelto" && String(loan.bookId) === String(book.id));
  const selectedLoan = activeLoans.find((loan) => String(loan.id) === String(selectedInventoryLoanId)) || activeLoans[0] || null;
  selectedInventoryLoanId = selectedLoan?.id || null;
  const requestOptions = pendingRequests.map((request) => `<option value="${escapeHTML(request.id)}"${String(request.id) === String(selectedRequest?.id) ? " selected" : ""}>${escapeHTML(request.student || "Estudiante")} · Por preparar</option>`).join("");
  const requestPanel = selectedRequest ? `
    <label class="inventory-request-label" for="inventory-request-select">Movimiento del título</label>
    <select class="inventory-request-select" id="inventory-request-select" aria-label="Seleccionar solicitud de retiro">${requestOptions}</select>
    <dl class="inventory-detail-stats inventory-request-stats">
      <div><dt>Solicitante</dt><dd>${escapeHTML(selectedRequest.student || "Estudiante")}</dd></div>
      <div><dt>Fecha de solicitud</dt><dd>${escapeHTML(formatDate(selectedRequest.createdAt))}</dd></div>
      <div><dt>Ejemplares disponibles</dt><dd>${book.available} <span>de ${book.total}</span></dd></div>
    </dl>
    <div class="inventory-detail-actions">
      <button class="action-button inventory-ready-button" type="button" data-approve-request="${escapeHTML(selectedRequest.id)}"${book.available < 1 ? " disabled" : ""}>✓ <span>Marcar listo para retirar</span></button>
      <button class="secondary-button inventory-detail-edit" type="button" data-edit-book="${escapeHTML(book.id)}">Ajustar inventario</button>
    </div>` : `
    <dl class="inventory-detail-stats">
      <div><dt>Ejemplares disponibles</dt><dd>${book.available} <span>de ${book.total}</span></dd></div>
      <div><dt>En circulación</dt><dd>${Math.max(0, book.total - book.available)}</dd></div>
      <div><dt>Estado físico</dt><dd>${escapeHTML(book.condition || "Sin registrar")}</dd></div>
      <div><dt>ISBN</dt><dd>${escapeHTML(book.isbn || "Sin registrar")}</dd></div>
    </dl>
    <button class="action-button inventory-detail-edit" type="button" data-edit-book="${escapeHTML(book.id)}">Ajustar inventario</button>`;
  const activeLoanPanel = selectedLoan ? `
    <dl class="inventory-detail-stats inventory-request-stats">
      <div><dt>Solicitante</dt><dd>${escapeHTML(selectedLoan.student || "Estudiante")}</dd></div>
      <div><dt>Fecha del préstamo</dt><dd>${escapeHTML(formatDate(selectedLoan.loanDate))}</dd></div>
      <div><dt>Fecha de devolución</dt><dd>${escapeHTML(formatDate(selectedLoan.dueDate))}</dd></div>
      <div><dt>Ejemplares disponibles</dt><dd>${book.available} <span>de ${book.total}</span></dd></div>
    </dl>
    <div class="inventory-detail-actions">
      <button class="action-button inventory-return-button" type="button" data-return-loan="${escapeHTML(selectedLoan.id)}">↩ <span>Registrar devolución</span></button>
      <button class="secondary-button inventory-detail-edit" type="button" data-edit-book="${escapeHTML(book.id)}">Ajustar inventario</button>
    </div>` : null;
  $("#inventory-detail-content").innerHTML = `
    ${selectedRequest ? '<h3 class="inventory-request-title">Preparar retiro</h3>' : selectedLoan ? '<h3 class="inventory-request-title">Préstamo activo</h3>' : ""}
    <div class="inventory-detail-top">
      <div class="inventory-detail-cover ${coverImage ? "inventory-detail-cover-photo" : `cover-art ${coverClass}`}" aria-hidden="true">${coverImage ? bookCoverImageMarkup(book, "inventory-detail-cover-image") : `<span class="cover-title">${escapeHTML(book.title)}</span>`}</div>
      <div class="inventory-detail-heading">${selectedRequest ? '<span class="inventory-request-state"><span class="inventory-request-dot"></span>Por preparar</span>' : selectedLoan ? '<span class="inventory-request-state is-loan"><span class="inventory-request-dot"></span>En circulación</span>' : `<span class="inventory-detail-kicker">${escapeHTML(book.category || "Colección")}</span>`}<h4>${escapeHTML(book.title)}</h4><p>${escapeHTML(book.author)}</p>${(selectedRequest || selectedLoan) && googleInfoURL ? `<a class="google-books-link" href="${escapeHTML(googleInfoURL)}" target="_blank" rel="noopener noreferrer">Ver ficha en Google Books <span aria-hidden="true">↗</span></a>` : ""}</div>
    </div>
    ${selectedRequest ? requestPanel : selectedLoan ? activeLoanPanel : `<span class="inventory-detail-kicker inventory-detail-section-title">Ficha del libro</span>${requestPanel}`}`;
  detail.hidden = false;
  $("#inventory-body").querySelectorAll("[data-inventory-book]").forEach((row) => {
    const selected = row.dataset.inventoryBook === String(book.id);
    row.classList.toggle("fila-elegida", selected);
    row.setAttribute("aria-selected", String(selected));
  });
}

function closeInventoryDetail() {
  selectedInventoryBookId = null;
  selectedInventoryRequestId = null;
  selectedInventoryLoanId = null;
  const detail = $("#inventory-detail");
  if (detail) detail.hidden = true;
  $("#inventory-body")?.querySelectorAll("[data-inventory-book]").forEach((row) => {
    row.classList.remove("fila-elegida");
    row.setAttribute("aria-selected", "false");
  });
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
  $("#ticket-heading").textContent = "Ticket de préstamo";
  $("#ticket-student-label").textContent = "Estudiante";
  $("#ticket-book-label").textContent = "Libro";
  $("#ticket-loan-date-label").textContent = "Fecha de préstamo";
  $("#ticket-due-date-label").textContent = "Fecha de devolución";
  $("#ticket-returned-field").hidden = true;
  $("#ticket-return-status-field").hidden = true;
  $("#ticket-returned-at").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-return-status").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-comment-field").hidden = true;
  $("#ticket-id").textContent = loan.ticketId;
  $("#ticket-student").textContent = loan.user;
  $("#ticket-book").textContent = data.books.find((book) => book.id === loan.bookId)?.title || loan.bookTitle || "Libro eliminado";
  $("#ticket-loan-date").textContent = formatDate(loan.loanDate);
  $("#ticket-due-date").textContent = formatDate(loan.dueDate);
  $("#ticket-dialog").showModal();
}

function showReturnTicket(id) {
  const loan = data.loans.find((item) => item.id === id);
  if (!loan?.returnTicketId || !loan.returnedAt) {
    toast("No hay un ticket de devolución disponible.", "error");
    return;
  }
  const late = isLateReturn(loan);
  const dateClass = late ? "return-date--late" : "return-date--on-time";
  $("#ticket-heading").textContent = "Ticket de devolución";
  $("#ticket-student-label").textContent = "Estudiante";
  $("#ticket-book-label").textContent = "Libro";
  $("#ticket-loan-date-label").textContent = "Fecha de préstamo";
  $("#ticket-due-date-label").textContent = "Fecha límite elegida";
  $("#ticket-comment-field").hidden = true;
  $("#ticket-id").textContent = loan.returnTicketId;
  $("#ticket-student").textContent = loan.user;
  $("#ticket-book").textContent = data.books.find((book) => book.id === loan.bookId)?.title || loan.bookTitle || "Libro eliminado";
  $("#ticket-loan-date").textContent = formatDate(loan.loanDate);
  $("#ticket-due-date").textContent = formatDate(loan.dueDate);
  $("#ticket-returned-at").textContent = loan.returnedAt.length === 10
    ? `${formatDate(loan.returnedAt)} (hora no registrada)`
    : dateTime.format(new Date(loan.returnedAt));
  $("#ticket-returned-at").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-returned-at").classList.add(dateClass);
  $("#ticket-return-status").textContent = late ? "Devuelto fuera de plazo" : "Devuelto dentro del plazo";
  $("#ticket-return-status").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-return-status").classList.add(dateClass);
  $("#ticket-returned-field").hidden = false;
  $("#ticket-return-status-field").hidden = false;
  $("#ticket-dialog").showModal();
}

function showReviewTicket(id) {
  const entry = auditEntries.find((item) => item.id === id);
  const details = entry?.details;
  if (!details?.ticketId) {
    toast("No hay un ticket disponible para esta reseña eliminada.", "error");
    return;
  }
  $("#ticket-heading").textContent = "Ticket de moderación";
  $("#ticket-student-label").textContent = "Alumno";
  $("#ticket-book-label").textContent = "Libro";
  $("#ticket-loan-date-label").textContent = "Eliminado por";
  $("#ticket-due-date-label").textContent = "Fecha de eliminación";
  $("#ticket-returned-field").hidden = true;
  $("#ticket-return-status-field").hidden = true;
  $("#ticket-returned-at").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-return-status").classList.remove("return-date--late", "return-date--on-time");
  $("#ticket-id").textContent = details.ticketId;
  $("#ticket-student").textContent = details.studentName || "—";
  $("#ticket-book").textContent = details.bookTitle || "Libro eliminado";
  $("#ticket-loan-date").textContent = entry.actor.name;
  $("#ticket-due-date").textContent = dateTime.format(new Date(entry.at));
  $("#ticket-comment").textContent = details.comment || "";
  $("#ticket-comment-field").hidden = false;
  $("#ticket-dialog").showModal();
}

function renderRequests() {
  const filter = $("#request-filter").value;
  const requests = [...data.requests].reverse().filter((request) => filter === "all" || request.status === filter);
  $("#requests-body").innerHTML = requests.map((request) => {
    const book = data.books.find((item) => item.id === request.bookId);
    const type = request.type === "loan" ? "Préstamo" : "Devolución";
    const ticketLoan = request.ticketId ? data.loans.find((loan) => loan.ticketId === request.ticketId) : null;
    const returnTicketLoan = request.ticketId ? data.loans.find((loan) => loan.returnTicketId === request.ticketId) : null;
    const ticket = returnTicketLoan
      ? `<div class="row-actions"><span>${escapeHTML(request.ticketId)}</span><button class="table-action" type="button" data-view-return-ticket="${escapeHTML(returnTicketLoan.id)}">Ver</button></div>`
      : ticketLoan
      ? `<div class="row-actions"><span>${escapeHTML(request.ticketId)}</span><button class="table-action" type="button" data-view-ticket="${escapeHTML(ticketLoan.id)}">Ver</button></div>`
      : request.type === "loan" ? `<small>${request.status === "Pendiente" ? "Se genera al aprobar" : "No generado"}</small>` : "—";
    const action = request.status === "Pendiente" ? `<div class="row-actions"><button type="button" data-approve-request="${escapeHTML(request.id)}">Aprobar</button><button type="button" class="danger-action" data-reject-request="${escapeHTML(request.id)}">Rechazar</button></div>` : "—";
    return `<tr><td>${escapeHTML(request.student)}</td><td>${escapeHTML(book?.title || request.bookTitle || "Libro eliminado")}</td><td>${type}</td><td>${formatDate(request.createdAt)}</td><td>${formatDate(request.dueDate)}</td><td>${ticket}</td><td>${statusPill(request.status)}</td><td>${action}</td></tr>`;
  }).join("");
  $("#requests-empty").hidden = requests.length > 0;
  $("#pending-request-count").textContent = data.requests.filter((request) => request.status === "Pendiente").length;
}

function renderStudentPanel() {
  const { loans, requests } = data;
  const readBooks = getReadBooks();
  if (!studentPanelInitialized) {
    selectedSummaryPanel = "read";
    $("#student-read-books").hidden = false;
    studentPanelInitialized = true;
  }
  const pendingLoans = requests.filter((request) => request.type === "loan" && request.status === "Pendiente").length;
  const activityOpen = !$("#student-request-details").hidden;
  const readBooksOpen = !$("#student-read-books").hidden;
  const activeLoans = loans.filter((loan) => loan.status !== "Devuelto").length;
  $("#student-summary").innerHTML = [
    ["Libros leídos", readBooks.length, "Ver libros devueltos", "read"],
    ["Préstamos activos", activeLoans, "Ver préstamos activos", "active"],
    ["Préstamos pendientes", pendingLoans, "Ver solicitudes pendientes", "pending"],
    ["Historial de actividades", loans.length + requests.length, "Ver todos los movimientos", "history"],
  ].map(([label, count, note, key]) => key === "read"
    ? `<button class="stat-card stat-card-button" id="student-read-books-toggle" type="button" aria-controls="student-read-books" aria-expanded="${readBooksOpen}" aria-pressed="${selectedSummaryPanel === "read"}"><span>${label}</span><strong>${count}</strong><small>${note}</small></button>`
    : `<button class="stat-card stat-card-button" type="button" data-activity-mode="${key}" aria-controls="student-request-details" aria-expanded="${activityOpen && selectedSummaryPanel === key}" aria-pressed="${selectedSummaryPanel === key}"><span>${label}</span><strong>${count}</strong><small>${note}</small></button>`).join("");

  $("#student-read-list").innerHTML = readBooks.map((book) => `
    <article class="student-read-card">
      ${coverArtworkForBook(book) ? bookCoverImageMarkup(book, "student-read-cover") : `<span class="student-read-cover-fallback cover-art ${escapeHTML(book.cover || "cover-1")}" aria-hidden="true"></span>`}
      <div class="student-read-copy"><span class="read-badge">Leído</span><h4>${escapeHTML(book.title)}</h4><p>${escapeHTML(book.author || "Autor no disponible")}</p></div>
      <div class="student-read-actions">
        ${data.books.some((item) => item.id === book.id) ? `<button class="secondary-button" type="button" data-show-book-reviews="${escapeHTML(book.id)}">Ver reseñas</button><button class="action-button" type="button" data-write-review="${escapeHTML(book.id)}">Escribir reseña</button>` : '<small>Ya no está en el catálogo</small>'}
        ${book.available === null ? "" : `<button class="secondary-button rerequest-book-button" type="button" data-rerequest-book="${escapeHTML(book.id)}"${book.available < 1 ? " disabled" : ""}>${book.available > 0 ? 'Volver a pedir <span aria-hidden="true">→</span>' : "Sin ejemplares disponibles"}</button>`}
      </div>
    </article>
  `).join("");
  loadGoogleBookCovers(readBooks).then((updated) => {
    if (updated) renderStudentPanel();
  });
  $("#student-read-books-empty").hidden = readBooks.length > 0;

  const rows = [
    ...requests.map((item) => ({ kind: "request", item, when: item.createdAt, dueDate: item.dueDate, ticketId: item.ticketId, ticketRequested: item.ticketRequested, label: item.type === "loan" ? "Solicitud de préstamo" : "Solicitud de devolución" })),
    ...loans.map((item) => ({ kind: "loan", item, when: item.loanDate, dueDate: item.dueDate, ticketId: item.ticketId, returnTicketId: item.returnTicketId, returnedAt: item.returnedAt, label: "Préstamo" })),
  ];
  rows.sort((a, b) => b.when.localeCompare(a.when));
  const visibleRows = rows.filter(({ kind, item }) => studentActivityMode === "active"
    ? kind === "loan" && item.status !== "Devuelto"
    : studentActivityMode === "pending"
      ? kind === "request" && item.type === "loan" && item.status === "Pendiente"
      : true);
  const activityTable = $("#student-requests-body").closest("table");
  activityTable.classList.remove("is-active-mode", "is-pending-mode", "is-history-mode");
  activityTable.classList.add(`is-${studentActivityMode}-mode`);
  $("#student-requests-count").textContent = visibleRows.length;
  const activityTitle = $("#student-requests-title");
  if (activityTitle) activityTitle.textContent = studentActivityMode === "active" ? "Préstamos activos"
    : studentActivityMode === "pending" ? "Préstamos pendientes" : "Tu actividad";
  $("#student-requests-body").innerHTML = visibleRows.map(({ item, dueDate, ticketId, returnTicketId, returnedAt, ticketRequested, label }) => {
    const book = data.books.find((entry) => entry.id === item.bookId);
    const returnTicketLoan = item.type === "return" && ticketId
      ? data.loans.find((loan) => loan.returnTicketId === ticketId)
      : null;
    const loanTicket = ticketId && item.type !== "return" ? escapeHTML(ticketId)
      : item.type === "return" ? "—"
      : ticketRequested ? (item.status === "Pendiente" ? "Al aprobar" : "No generado") : "Se genera al aprobar";
    const returnTicket = returnTicketId
      ? `<div class="row-actions"><span>${escapeHTML(returnTicketId)}</span><button class="table-action" type="button" data-view-return-ticket="${escapeHTML(item.id)}">Ver devolución</button></div>`
      : returnTicketLoan
        ? `<div class="row-actions"><span>${escapeHTML(ticketId)}</span><button class="table-action" type="button" data-view-return-ticket="${escapeHTML(returnTicketLoan.id)}">Ver devolución</button></div>`
        : "";
    const returnDate = returnedAt
      ? `<small class="return-date ${isLateReturn(item) ? "return-date--late" : "return-date--on-time"}">Real: ${escapeHTML(returnedAt.length === 10 ? `${formatDate(returnedAt)} (hora no registrada)` : dateTime.format(new Date(returnedAt)))} · ${isLateReturn(item) ? "Fuera de plazo" : "A tiempo"}</small>`
      : "";
    const ticket = returnTicket ? `${item.type === "return" ? "" : `<small>Préstamo: ${loanTicket}</small>`}${returnTicket}`
      : loanTicket;
    const readBadge = item.type !== "return" && item.status === "Devuelto" ? '<span class="read-badge">Leído</span>' : "";
    return `<tr><td><strong>${escapeHTML(book?.title || item.bookTitle || "Libro eliminado")}</strong>${readBadge}</td><td>${label}</td><td>${formatDate(item.createdAt || item.loanDate)}</td><td>${formatDate(dueDate)}${returnDate}</td><td>${ticket}</td><td>${statusPill(item.status)}</td></tr>`;
  }).join("");
  $("#student-requests-empty").textContent = studentActivityMode === "active" ? "No tienes préstamos activos."
    : studentActivityMode === "pending" ? "No tienes préstamos pendientes." : "Aún no tienes solicitudes ni préstamos registrados.";
  $("#student-requests-empty").hidden = visibleRows.length > 0;
}

function setStudentActivityExpanded(expanded, scrollToActivity = false) {
  const details = $("#student-request-details");
  const section = $("#student-activity");
  if (!details) return;
  details.hidden = !expanded;
  if (section) section.hidden = !expanded;
  document.querySelectorAll("[data-activity-mode]").forEach((button) => {
    const selected = button.dataset.activityMode === selectedSummaryPanel;
    button.setAttribute("aria-expanded", String(expanded && selected));
    button.setAttribute("aria-pressed", String(selected));
  });
  const readBooksButton = $("#student-read-books-toggle");
  const readBooksSection = $("#student-read-books");
  readBooksButton?.setAttribute("aria-expanded", String(Boolean(readBooksSection && !readBooksSection.hidden)));
  readBooksButton?.setAttribute("aria-pressed", String(selectedSummaryPanel === "read"));
  if (scrollToActivity && expanded) $("#student-activity")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getReadBooks() {
  const returnedLoans = data.loans
    .filter((loan) => loan.status === "Devuelto")
    .sort((a, b) => (b.returnedAt || b.loanDate).localeCompare(a.returnedAt || a.loanDate));
  const booksById = new Map();
  returnedLoans.forEach((loan) => {
    if (booksById.has(loan.bookId)) return;
    const book = data.books.find((item) => item.id === loan.bookId);
    booksById.set(loan.bookId, {
      id: loan.bookId,
      title: book?.title || loan.bookTitle || "Libro eliminado",
      author: book?.author || "",
      available: book ? book.available : null,
    });
  });
  return [...booksById.values()];
}

const reviewPrefix = pageRole === "student" ? "student-" : "";
const reviewControl = (name) => $(`#${reviewPrefix}${name}`);

function renderReviews() {
  const select = reviewControl("review-book-filter");
  const bookNames = new Map(data.reviews.map((review) => [review.bookId, review.bookTitle || "Libro eliminado"]));
  data.books.forEach((book) => { bookNames.set(book.id, book.title); });
  if (select) {
    const previous = select.value;
    select.replaceChildren(new Option("Todos los libros", "all"), ...[...bookNames].map(([id, title]) => new Option(title, id)));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    refreshCustomSelect(select);
  }

  const bookFilter = select?.value || "all";
  const sort = reviewControl("review-sort").value;
  const reviews = data.reviews.filter((review) => bookFilter === "all" || review.bookId === bookFilter);
  reviews.sort((a, b) => {
    const ratingOrder = sort === "highest" ? b.rating - a.rating : sort === "lowest" ? a.rating - b.rating : 0;
    return ratingOrder || b.createdAt.localeCompare(a.createdAt);
  });
  reviewControl("review-list").innerHTML = reviews.map((review) => {
    const edit = review.own && data.user.role === "admin" ? `<button type="button" data-edit-review="${escapeHTML(review.id)}">Editar</button>` : "";
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
  const reviewTools = reviewControl("review-tools");
  if (reviewTools) reviewTools.hidden = data.reviews.length === 0;
  const seeReviews = $("#student-see-reviews");
  if (seeReviews) seeReviews.hidden = data.reviews.length === 0;
  reviewControl("review-reset").disabled = bookFilter === "all" && sort === "newest";
}

function renderAll() {
  if (data.user.role === "student") {
    renderCategoryFilters();
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
    auditEntries = entries;
    $("#audit-body").innerHTML = entries.map(({ id, at, action, target, actor, details }) => {
      const request = data.requests.find((item) => item.id === target.id);
      const ticketLoan = data.loans.find((loan) => loan.id === target.id)
        || (request?.ticketId && data.loans.find((loan) => loan.ticketId === request.ticketId));
      const returnTicketLoan = details?.ticketType === "return"
        ? data.loans.find((loan) => loan.id === details.loanId)
        : null;
      const ticket = details?.ticketType === "return" && returnTicketLoan
        ? `<button class="table-action" type="button" data-view-return-ticket="${escapeHTML(returnTicketLoan.id)}">${escapeHTML(details.ticketId)}</button>`
        : details?.ticketId
          ? `<button class="table-action" type="button" data-view-review-ticket="${escapeHTML(id)}">${escapeHTML(details.ticketId)}</button>`
          : ticketLoan?.ticketId
        ? `<button class="table-action" type="button" data-view-ticket="${escapeHTML(ticketLoan.id)}">${escapeHTML(ticketLoan.ticketId)}</button>`
        : "—";
      const legacyStudentName = /^Reseña de (.+?)(?: sobre «|$)/.exec(target.label)?.[1];
      const studentName = action === "Eliminar reseña" ? details?.studentName || legacyStudentName || "—" : "—";
      const deletedComment = action === "Eliminar reseña" && details?.comment
        ? `<small>Comentario eliminado: ${escapeHTML(details.comment)}</small>`
        : "";
      return `<tr>
      <td><time datetime="${escapeHTML(at)}">${dateTime.format(new Date(at))}</time></td>
      <td>${escapeHTML(action)}</td><td>${escapeHTML(target.label)}${deletedComment}<small>${escapeHTML(target.id)}</small></td><td>${ticket}</td><td>${escapeHTML(studentName)}</td>
      <td>${escapeHTML(actor.name)}</td><td>${escapeHTML(roleNames[actor.role] || actor.role)}</td><td>${escapeHTML(actor.identifier || "—")}</td>
    </tr>`;
    }).join("");
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
    if (field.type === "select" || field.type === "rating") {
      input = `<select name="${name}" ${field.type === "rating" ? "data-rating-picker" : ""} ${required}>${field.options.map(([key, label]) =>
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
  form.querySelectorAll('input[type="date"]').forEach(attachDatePicker);
  form.querySelectorAll("select").forEach(attachCustomSelect);
  const loanDateInput = form.querySelector('[name="loanDate"]');
  const dueDateInput = form.querySelector('[name="dueDate"]');
  if (loanDateInput && dueDateInput) {
    loanDateInput.addEventListener("change", () => {
      updateDatePickerBounds(loanDateInput, "", dateToday());
      updateDatePickerBounds(dueDateInput, loanDateInput.value, dateAfterDays(loanDateInput.value, 14));
    });
  }

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

function confirmBookDeletion(book) {
  const dialog = $("#delete-confirm-dialog");
  const form = $("#delete-confirm-form");
  const checkbox = $("#delete-confirm-checkbox");
  const submit = $("#delete-confirm-submit");
  const cancel = $("#delete-confirm-cancel");
  const close = $("#delete-confirm-close");
  const errorRegion = $("#delete-confirm-error");
  if (!dialog || !form || !checkbox || !submit || !cancel || !close || !errorRegion) {
    toast("No se pudo abrir la confirmación para eliminar el libro.", "error");
    return;
  }

  $("#delete-confirm-book").textContent = book.title;
  checkbox.checked = false;
  checkbox.disabled = false;
  submit.disabled = true;
  cancel.disabled = false;
  close.disabled = false;
  errorRegion.hidden = true;
  errorRegion.textContent = "";
  submit.dataset.busy = "false";
  checkbox.onchange = () => { submit.disabled = !checkbox.checked; };
  cancel.onclick = close.onclick = () => {
    if (submit.dataset.busy !== "true") dialog.close();
  };
  dialog.oncancel = (event) => {
    if (submit.dataset.busy === "true") event.preventDefault();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!checkbox.checked || submit.dataset.busy === "true") return;
    submit.dataset.busy = "true";
    submit.disabled = checkbox.disabled = cancel.disabled = close.disabled = true;
    errorRegion.hidden = true;
    try {
      await mutate(`/books/${encodeURIComponent(book.id)}`, "DELETE", undefined, "Libro eliminado.");
      dialog.close();
    } catch (error) {
      displayError(error, errorRegion);
    } finally {
      submit.dataset.busy = "false";
      checkbox.disabled = cancel.disabled = close.disabled = false;
      submit.disabled = !checkbox.checked;
    }
  };
  dialog.showModal();
  checkbox.focus();
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
    { name: "loanDate", label: "Fecha de préstamo", type: "date", value: today, max: today },
    { name: "dueDate", label: "Fecha límite de devolución (máximo 14 días)", type: "date", value: due, min: today, max: due },
  ], (values) => mutate("/loans", "POST", {
    ...values,
    ticketRequested: true,
  }, "Préstamo registrado y stock actualizado."));
}

function addReview(review, selectedBookId) {
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
    { name: "bookId", label: "Libro", type: "select", value: review?.bookId || selectedBookId || options[0][0], options },
    { name: "rating", label: "Calificación", type: "rating", value: review?.rating || 5, options: [[1, "1 estrella"], [2, "2 estrellas"], [3, "3 estrellas"], [4, "4 estrellas"], [5, "5 estrellas"]] },
    { name: "comment", label: "Comentario", type: "textarea", value: review?.comment, maxlength: 600 },
  ], (values) => {
    const path = review ? `/reviews/${encodeURIComponent(review.id)}` : "/reviews";
    return mutate(path, review ? "PATCH" : "POST", values, review ? "Reseña actualizada." : "Reseña publicada.");
  });
}

function bindUI() {
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.bookCoverImage !== "true") return;
    const fallback = image.dataset.fallbackCover;
    delete image.dataset.googleCover;
    delete image.dataset.fallbackCover;
    if (fallback && image.getAttribute("src") !== fallback) image.src = fallback;
    else image.hidden = true;
  }, true);
  document.querySelectorAll("select").forEach(attachCustomSelect);
  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("selected")));
  });
  const filterList = $(".filter-list");
  filterList?.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      filterList.scrollLeft += event.deltaY;
    }
  }, { passive: false });
  filterList?.addEventListener("click", (event) => {
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
  $("#catalog-pagination")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    catalogPage += button.dataset.page === "next" ? 1 : -1;
    renderCatalog();
    $("#catalog-scroll").scrollTop = 0;
    $("#catalogo").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#book-grid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-book]");
    if (button) showBookDetails(button.dataset.book);
  });
  $("#mobile-book-shelves")?.addEventListener("click", (event) => {
    const scrollButton = event.target.closest("[data-shelf-scroll]");
    if (scrollButton) {
      const shelf = scrollButton.closest(".mobile-book-shelf")?.querySelector(".mobile-shelf-scroll");
      shelf?.scrollBy({ left: Number(scrollButton.dataset.shelfScroll) * 140, behavior: "smooth" });
      return;
    }
    const button = event.target.closest("[data-book]");
    if (button) showBookDetails(button.dataset.book);
  });

  $("#mobile-my-books")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-my-books-scroll]");
    if (!button) return;
    const list = $("#mobile-my-books-list");
    const card = list?.querySelector(".mobile-my-book-card");
    if (!list || !card) return;
    const direction = Number(button.dataset.myBooksScroll) || 1;
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
    list.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: "smooth" });
  });
  $("#available-only")?.addEventListener("change", () => renderCatalog(true));
  $("#book-dialog .dialog-close")?.addEventListener("click", () => $("#book-dialog").close());
  $("#dialog-view-all-reviews")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    if (button.dataset.bookId) renderBookReviews(button.dataset.bookId, true);
  });
  $(".management-tabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-panel]");
    if (tab) activateTab(tab.dataset.panel);
  });

  $("#add-book")?.addEventListener("click", () => addOrEditBook());
  $("#inventory-body")?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-book]");
    const remove = event.target.closest("[data-delete-book]");
    if (edit || remove) {
      const book = data.books.find(({ id }) => String(id) === (edit?.dataset.editBook || remove?.dataset.deleteBook));
      if (!book) return;
      if (edit) addOrEditBook(book);
      if (remove) confirmBookDeletion(book);
      return;
    }
    const row = event.target.closest("[data-inventory-book]");
    const book = data.books.find(({ id }) => String(id) === row?.dataset.inventoryBook);
    if (book) showInventoryDetail(book);
  });
  $("#inventory-body")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-inventory-book]");
    if (!row || event.target !== row) return;
    event.preventDefault();
    const book = data.books.find(({ id }) => String(id) === row.dataset.inventoryBook);
    if (book) showInventoryDetail(book);
  });
  $("#inventory-detail")?.addEventListener("click", (event) => {
    const returnButton = event.target.closest("[data-return-loan]");
    if (returnButton) {
      if (confirm("¿Confirmar la devolución de este ejemplar?")) {
        runAction(returnButton, async () => {
          const result = await mutate(`/loans/${encodeURIComponent(returnButton.dataset.returnLoan)}/return`, "POST", undefined, "Devolución registrada. Inventario actualizado.");
          if (result?.returnTicketId) showReturnTicket(result.id);
        });
      }
      return;
    }
    const approve = event.target.closest("[data-approve-request]");
    if (approve) {
      const requestId = approve.dataset.approveRequest;
      runAction(approve, () => mutate(`/requests/${encodeURIComponent(requestId)}`, "PATCH", { approve: true }, "Préstamo aprobado y listo para retirar."));
      return;
    }
    const edit = event.target.closest("[data-edit-book]");
    if (!edit) return;
    const book = data.books.find(({ id }) => String(id) === edit.dataset.editBook);
    if (book) addOrEditBook(book);
  });
  $("#inventory-detail")?.addEventListener("change", (event) => {
    const select = event.target.closest("#inventory-request-select");
    if (!select) return;
    selectedInventoryRequestId = select.value;
    const book = data.books.find(({ id }) => String(id) === String(selectedInventoryBookId));
    if (book) showInventoryDetail(book);
  });
  $("#inventory-detail-close")?.addEventListener("click", closeInventoryDetail);
  $("#inventory-search")?.addEventListener("input", () => renderInventory(true));
  $("#inventory-filter")?.addEventListener("change", () => renderInventory(true));
  $("#inventory-pagination")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    inventoryPage += button.dataset.page === "next" ? 1 : -1;
    renderInventory();
    $("#panel-inventory .table-scroll").scrollTop = 0;
    $("#panel-inventory").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#add-loan")?.addEventListener("click", addLoan);
  $("#loans-body")?.addEventListener("click", (event) => {
    const ticketButton = event.target.closest("[data-view-ticket]");
    if (ticketButton) {
      showLoanTicket(ticketButton.dataset.viewTicket);
      return;
    }
    const button = event.target.closest("[data-return-loan]");
    if (button && confirm("¿Confirmar la devolución de este ejemplar?")) {
      runAction(button, async () => {
        const result = await mutate(`/loans/${encodeURIComponent(button.dataset.returnLoan)}/return`, "POST", undefined, "Devolución registrada. Inventario actualizado.");
        if (result?.returnTicketId) showReturnTicket(result.id);
      });
    }
  });
  $("#loan-search")?.addEventListener("input", renderLoans);
  $("#loan-filter")?.addEventListener("change", renderLoans);

  $("#requests-body")?.addEventListener("click", (event) => {
    const returnTicketButton = event.target.closest("[data-view-return-ticket]");
    if (returnTicketButton) {
      showReturnTicket(returnTicketButton.dataset.viewReturnTicket);
      return;
    }
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
  $("#student-requests-body")?.addEventListener("click", (event) => {
    const returnTicketButton = event.target.closest("[data-view-return-ticket]");
    if (returnTicketButton) showReturnTicket(returnTicketButton.dataset.viewReturnTicket);
  });
  $("#student-summary")?.addEventListener("click", (event) => {
    const readBooksButton = event.target.closest("#student-read-books-toggle");
    if (readBooksButton) {
      const section = $("#student-read-books");
      const closeReadBooks = selectedSummaryPanel === "read" && !section.hidden;
      selectedSummaryPanel = "read";
      section.hidden = closeReadBooks;
      setStudentActivityExpanded(false);
      if (!closeReadBooks) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const activityCard = event.target.closest("[data-activity-mode]");
    if (!activityCard) return;
    const nextMode = activityCard.dataset.activityMode;
    const shouldClose = selectedSummaryPanel === nextMode && !$("#student-request-details").hidden;
    selectedSummaryPanel = nextMode;
    if (shouldClose) {
      setStudentActivityExpanded(false);
      return;
    }
    studentActivityMode = nextMode;
    $("#student-read-books").hidden = true;
    renderStudentPanel();
    setStudentActivityExpanded(true, true);
  });
  $("#student-read-list")?.addEventListener("click", (event) => {
    const writeReviewButton = event.target.closest("[data-write-review]");
    if (writeReviewButton) {
      addReview(undefined, writeReviewButton.dataset.writeReview);
      return;
    }
    const seeReviewsButton = event.target.closest("[data-show-book-reviews]");
    if (seeReviewsButton) {
      showBookDetails(seeReviewsButton.dataset.showBookReviews);
      return;
    }
    const button = event.target.closest("[data-rerequest-book]");
    if (button) showBookDetails(button.dataset.rerequestBook);
  });
  $("#request-filter")?.addEventListener("change", renderRequests);
  $("#audit-body")?.addEventListener("click", (event) => {
    const returnTicketButton = event.target.closest("[data-view-return-ticket]");
    if (returnTicketButton) {
      showReturnTicket(returnTicketButton.dataset.viewReturnTicket);
      return;
    }
    const reviewTicketButton = event.target.closest("[data-view-review-ticket]");
    if (reviewTicketButton) {
      showReviewTicket(reviewTicketButton.dataset.viewReviewTicket);
      return;
    }
    const button = event.target.closest("[data-view-ticket]");
    if (button) showLoanTicket(button.dataset.viewTicket);
  });

  $(`#${reviewPrefix}add-review`)?.addEventListener("click", () => addReview());
  if (pageRole === "student") {
    $("#student-see-reviews")?.addEventListener("click", () => {
      $("#student-review-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  const bookFilter = reviewControl("review-book-filter");
  bookFilter?.addEventListener("change", renderReviews);
  reviewControl("review-sort").addEventListener("change", renderReviews);
  reviewControl("review-reset").addEventListener("click", () => {
    if (bookFilter) bookFilter.value = "all";
    const sort = reviewControl("review-sort");
    sort.value = "newest";
    if (bookFilter) refreshCustomSelect(bookFilter);
    refreshCustomSelect(sort);
    renderReviews();
    selectPickerInstances.get(bookFilter || sort)?.trigger.focus();
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
    window.removeEventListener("hashchange", sectionNavigationUpdate);
    window.removeEventListener("popstate", sectionNavigationUpdate);
  }
  const links = [...document.querySelectorAll(".main-nav .nav-link[href^='#']:not([hidden])")];
  const mobileStudentLinks = [...document.querySelectorAll(".student-bottom-nav .nav-link[href^='#']")];

  const setActive = (id) => {
    [...links, ...mobileStudentLinks].forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  const libraryPage = $("#biblioteca");
  const studentPanelPage = $("#panel-estudiante");
  if (pageRole === "student" && libraryPage && studentPanelPage) {
    const pages = [libraryPage, studentPanelPage];
    const pageLinks = [...document.querySelectorAll("a[data-student-page]")];
    const activateStudentPage = () => {
      const currentPage = pages.find((page) => page.id === location.hash.slice(1)) || libraryPage;
      pages.forEach((page) => { page.hidden = page !== currentPage; });
      setActive(currentPage.id);
      if (location.hash !== `#${currentPage.id}`) history.replaceState(null, "", `#${currentPage.id}`);
      window.scrollTo(0, 0);
    };

    pageLinks.forEach((link) => {
      link.onclick = (event) => {
        event.preventDefault();
        if (location.hash === link.hash) activateStudentPage();
        else location.hash = link.hash;
      };
    });
    sectionNavigationUpdate = activateStudentPage;
    window.addEventListener("hashchange", sectionNavigationUpdate);
    window.addEventListener("popstate", sectionNavigationUpdate);
    activateStudentPage();
    return;
  }

  const sections = links.map((link) => $(link.getAttribute("href"))).filter((section) => section && !section.hidden);
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
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú de navegación" : "Abrir menú de navegación");
    mainNav.classList.toggle("is-open", open);
  }
  menuToggle.addEventListener("click", () => showMenu(menuToggle.getAttribute("aria-expanded") !== "true"));
  mainNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) showMenu(false);
  });

  const themeToggle = $(".theme-toggle");
  const themeStorageKey = pageRole === "admin" ? "biblioteca-theme-admin" : "biblioteca-theme-student";
  const setTheme = (theme) => {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", isDark ? "Activar modo claro" : "Activar modo nocturno");
    themeToggle.querySelector(".theme-toggle-icon").textContent = isDark ? "☀" : "☾";
    themeToggle.querySelector(".theme-toggle-label").textContent = isDark ? "Modo claro" : "Modo nocturno";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#121714" : "#f7f6f0");
    try { localStorage.setItem(themeStorageKey, isDark ? "dark" : "light"); } catch (error) {}
  };
  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog.id === "management-dialog" && $("#management-dialog-close").disabled) return;
      if (dialog.id === "delete-confirm-dialog" && $("#delete-confirm-submit").dataset.busy === "true") return;
      dialog.close();
    });
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

bindUI();
setupPage();
