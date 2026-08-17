export const $ = selector => document.querySelector(selector);

export const euro = value => value == null
  ? "—"
  : new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(value);

export const escapeHtml = value => String(value ?? "").replace(
  /[&<>"']/g,
  character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]
);

export const usableCoverUrl = value => value && !/books\.google\.com\/books\/content/i.test(value) ? value : "";

export const NO_COVER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='230'%3E%3Crect width='100%25' height='100%25' fill='%23e8e1d5'/%3E%3Cpath d='M48 55h64v90H48z' fill='none' stroke='%23756f66' stroke-width='5'/%3E%3Cpath d='M58 72h44M58 88h34M58 104h39' stroke='%23756f66' stroke-width='4'/%3E%3C/svg%3E";
