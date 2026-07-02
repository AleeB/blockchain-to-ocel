/**
 * parser.js - Legge una stringa di testo e la trasforma in un array di oggetti.
 *
 * Prova JSON standard; se non funziona, prova JSONL riga per riga
 * (più gestibile sui dataset grossi, non carica tutto in memoria in una volta).
 */
export function parseJsonOrJsonl(raw) {
  const trimmed = raw.trim();

  if (!trimmed) return [];

  try {
    // Prova JSON standard
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed === "object" && parsed !== null) {
      // File con un solo oggetto: lo mette in un array cosi' l'output e' sempre uniforme
      return [parsed];
    }

    throw new Error(`Unexpected JSON type: ${typeof parsed}`);
  } catch (_) {
    // Prova JSONL: ogni riga e' un oggetto JSON separato
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line));
  }
}
