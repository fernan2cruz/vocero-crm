/**
 * 064 — CSV para abrir en Excel o Google Sheets. Sin dependencias.
 *
 * Tres cosas que importan más de lo que parecen:
 * - Un texto que empieza con `=`, `+`, `-` o `@` lo interpreta la hoja de
 *   cálculo como FÓRMULA. El nombre de un contacto lo escribe cualquiera (el
 *   perfil de WhatsApp es de quien escribe), así que se neutraliza con un
 *   apóstrofo antes de exportar. Los números van como número, sin tocar.
 * - Comillas, comas y saltos de línea se escapan como pide RFC 4180.
 * - El BOM de UTF-8 al inicio evita que Excel rompa acentos y eñes.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const seguro = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export const CSV_BOM = "﻿";

/** Filas → texto CSV (CRLF entre filas, BOM al inicio). */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lineas = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return CSV_BOM + lineas.join("\r\n") + "\r\n";
}
