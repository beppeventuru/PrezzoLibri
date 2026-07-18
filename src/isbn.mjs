export function cleanIsbn(value = "") {
  return String(value).toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidIsbn(value) {
  const isbn = cleanIsbn(value);
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn.slice(0, 12)].reduce((total, digit, index) =>
      total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === Number(isbn[12]);
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) =>
      total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0;
  }
  return false;
}

export function isbn10To13(value) {
  const isbn10 = cleanIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn10) || !isValidIsbn(isbn10)) return null;
  const base = `978${isbn10.slice(0, 9)}`;
  const sum = [...base].reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${base}${(10 - sum % 10) % 10}`;
}

export function canonicalIsbn(value) {
  const isbn = cleanIsbn(value);
  if (!isValidIsbn(isbn)) return null;
  return isbn.length === 10 ? isbn10To13(isbn) : isbn;
}
