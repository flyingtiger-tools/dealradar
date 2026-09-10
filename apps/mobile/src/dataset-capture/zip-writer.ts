import { crc32 } from "./crc32";

/**
 * Écrivain ZIP minimal, méthode STORED uniquement (aucune compression) —
 * choix délibéré (Phase 4) : construire un vrai ZIP portable (ouvrable par
 * l'Explorateur Windows, l'Archive Utility macOS, 7-Zip, unzip…) sans tirer
 * de dépendance de compression externe. "Priorité : fiabilité >
 * sophistication" — voir aussi `readStoredZipEntries()` ci-dessous, utilisée
 * en test pour vérifier qu'un ZIP produit se relit correctement (CRC compris)
 * avant de faire confiance à ce module pour un export réel.
 *
 * Portable Node/Hermes (aucune API spécifique à une plateforme) — testable
 * directement sous Node (voir `__tests__/zip-writer.test.ts`).
 */

export interface ZipEntryInput {
  /** Chemin dans l'archive, ex. "dataset.json" ou "photos/<id>.jpg" — toujours "/", jamais "\\". */
  path: string;
  data: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** Bit 11 du "general purpose bit flag" — indique que le nom de fichier est encodé en UTF-8. */
const UTF8_NAME_FLAG = 0x0800;
const VERSION_NEEDED = 20;

function encodeUtf8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    const codePoint = str.codePointAt(i)!;
    if (codePoint > 0xffff) i += 1; // paire de substituts déjà consommée par codePointAt
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Format date/heure DOS attendu par le format ZIP (résolution 2 secondes) — métadonnée seulement, jamais utilisée pour une logique métier. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate = (((Math.max(1980, date.getFullYear()) - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff));
  }

  u32(value: number): void {
    this.push(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff));
  }

  get offset(): number {
    return this.length;
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

interface CentralRecord {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

/** Construit un ZIP32 valide (un seul disque, aucun commentaire) — jamais utilisé pour des archives dépassant les limites ZIP32 (4 Go/65535 entrées), largement suffisant pour un dataset de photos de cartes. */
export function buildStoredZip(entries: readonly ZipEntryInput[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const writer = new ByteWriter();
  const centralRecords: CentralRecord[] = [];

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.path.replace(/\\/g, "/"));
    const crc = crc32(entry.data);
    const offset = writer.offset;

    writer.u32(LOCAL_FILE_HEADER_SIGNATURE);
    writer.u16(VERSION_NEEDED);
    writer.u16(UTF8_NAME_FLAG);
    writer.u16(0); // méthode : stored
    writer.u16(time);
    writer.u16(date);
    writer.u32(crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(nameBytes.length);
    writer.u16(0); // extra field length
    writer.push(nameBytes);
    writer.push(entry.data);

    centralRecords.push({ nameBytes, crc, size: entry.data.length, offset, dosTime: time, dosDate: date });
  }

  const centralDirectoryStart = writer.offset;
  for (const record of centralRecords) {
    writer.u32(CENTRAL_DIRECTORY_SIGNATURE);
    writer.u16(VERSION_NEEDED); // version made by
    writer.u16(VERSION_NEEDED); // version needed
    writer.u16(UTF8_NAME_FLAG);
    writer.u16(0); // méthode : stored
    writer.u16(record.dosTime);
    writer.u16(record.dosDate);
    writer.u32(record.crc);
    writer.u32(record.size);
    writer.u32(record.size);
    writer.u16(record.nameBytes.length);
    writer.u16(0); // extra field length
    writer.u16(0); // comment length
    writer.u16(0); // disk number start
    writer.u16(0); // internal file attributes
    writer.u32(0); // external file attributes
    writer.u32(record.offset);
    writer.push(record.nameBytes);
  }
  const centralDirectorySize = writer.offset - centralDirectoryStart;

  writer.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writer.u16(0); // numéro de ce disque
  writer.u16(0); // disque contenant le début du répertoire central
  writer.u16(centralRecords.length);
  writer.u16(centralRecords.length);
  writer.u32(centralDirectorySize);
  writer.u32(centralDirectoryStart);
  writer.u16(0); // longueur du commentaire

  return writer.toUint8Array();
}

export interface ParsedZipEntry {
  path: string;
  size: number;
  crcValid: boolean;
}

/**
 * Relit un ZIP produit par `buildStoredZip()` et vérifie le CRC-32 de chaque
 * entrée contre les octets réellement stockés — outil de vérification
 * utilisé en test (et disponible pour un futur diagnostic manuel), jamais un
 * lecteur ZIP général (STORED uniquement, ZIP32 uniquement, aucun
 * commentaire d'archive attendu — reflète exactement ce que `buildStoredZip`
 * produit).
 */
export function readStoredZipEntries(zip: Uint8Array): ParsedZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Cherche l'EOCD depuis la fin — sûr ici car buildStoredZip n'écrit jamais de commentaire d'archive.
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("ZIP invalide : signature de fin de répertoire central introuvable.");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ParsedZipEntry[] = [];
  let cursor = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`ZIP invalide : en-tête de répertoire central manquant à l'entrée ${i}.`);
    }
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = typeof TextDecoder !== "undefined" ? new TextDecoder().decode(nameBytes) : String.fromCharCode(...nameBytes);

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);

    entries.push({ path, size: compressedSize, crcValid: crc32(data) === crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
