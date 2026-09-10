/**
 * CRC-32 (polynôme IEEE 802.3 / ISO-HDLC, 0xEDB88320) — implémentation pure,
 * portable Node/Hermes, utilisée uniquement par `zip-writer.ts` pour
 * produire des en-têtes ZIP valides. Vérifiée contre le vecteur de test
 * standard CRC-32 ("123456789" -> 0xCBF43926, voir `__tests__/crc32.test.ts`).
 */

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildTable();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
