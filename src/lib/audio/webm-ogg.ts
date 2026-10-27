/**
 * 044 — WebM/Opus → Ogg/Opus, sin recodificar.
 *
 * Chrome y Edge graban con `MediaRecorder` en `audio/webm;codecs=opus`, y
 * WhatsApp solo acepta notas de voz en Ogg con Opus. El audio es el mismo: los
 * paquetes Opus se sacan del contenedor WebM (Matroska) y se meten, tal cual,
 * en páginas Ogg (RFC 7845). Sin ffmpeg y sin dependencias: el CRM no gana un
 * binario en la imagen por esto.
 *
 * Lo que graba `MediaRecorder` trae el Segment y los Cluster con tamaño
 * DESCONOCIDO (los escribe en vivo). Por eso el lector no salta elementos
 * maestros: entra en ellos y sigue leyendo en línea, que vale tanto para
 * tamaños conocidos como desconocidos.
 */

export class WebmOggError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebmOggError";
  }
}

// IDs de Matroska que importan aquí (con su marcador, como se leen).
const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  Audio: 0xe1,
  Channels: 0x9f,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

/** Maestros en los que se entra en vez de saltarlos. */
const MAESTROS = new Set<number>([
  ID.Segment,
  ID.Cluster,
  ID.Tracks,
  ID.TrackEntry,
  ID.Audio,
  ID.BlockGroup,
]);

type Pista = {
  numero: number;
  codec: string;
  privado: Uint8Array | null;
  canales: number;
  retrasoNs: number;
};

/** Un VINT de Matroska: largo por el primer bit en 1. */
function leerVint(buf: Uint8Array, pos: number, conMarcador: boolean) {
  const primero = buf[pos];
  if (primero === undefined || primero === 0) {
    throw new WebmOggError("WebM corrupto: número de longitud inválido");
  }
  let largo = 1;
  while (largo <= 8 && !(primero & (0x80 >> (largo - 1)))) largo++;
  if (pos + largo > buf.length) throw new WebmOggError("WebM truncado");
  let valor = conMarcador ? primero : primero & (0xff >> largo);
  let todoUnos = (primero & (0xff >> largo)) === 0xff >> largo;
  for (let i = 1; i < largo; i++) {
    const b = buf[pos + i]!;
    valor = valor * 256 + b;
    if (b !== 0xff) todoUnos = false;
  }
  return { valor, largo, desconocido: !conMarcador && todoUnos };
}

function leerUint(buf: Uint8Array): number {
  let v = 0;
  for (const b of buf) v = v * 256 + b;
  return v;
}

/**
 * Cuántas muestras (a 48 kHz) trae un paquete Opus, por su byte TOC
 * (RFC 6716 §3.1). Hace falta para la posición de cada página Ogg.
 */
export function muestrasDePaquete(paquete: Uint8Array): number {
  const toc = paquete[0];
  if (toc === undefined) return 0;
  const config = toc >> 3;
  let ms: number;
  if (config < 12) ms = [10, 20, 40, 60][config % 4]!;
  else if (config < 16) ms = [10, 20][config % 2]!;
  else ms = [2.5, 5, 10, 20][config % 4]!;
  const c = toc & 0x03;
  const tramas = c === 0 ? 1 : c === 3 ? (paquete[1] ?? 0) & 0x3f : 2;
  return Math.round(tramas * ms * 48);
}

/** Lee la pista Opus y sus paquetes, en orden. */
export function extraerOpusDeWebm(webm: Uint8Array): { pista: Pista; paquetes: Uint8Array[] } {
  const pistas: Pista[] = [];
  const bloques: Uint8Array[] = [];
  let actual: Pista | null = null;
  let vioEbml = false;
  let pos = 0;

  while (pos < webm.length) {
    const id = leerVint(webm, pos, true);
    const tam = leerVint(webm, pos + id.largo, false);
    const inicio = pos + id.largo + tam.largo;

    if (id.valor === ID.EBML) vioEbml = true;
    if (MAESTROS.has(id.valor)) {
      if (id.valor === ID.TrackEntry) {
        actual = { numero: 0, codec: "", privado: null, canales: 1, retrasoNs: 0 };
        pistas.push(actual);
      }
      pos = inicio; // se entra: sus hijos vienen enseguida
      continue;
    }
    if (tam.desconocido) {
      throw new WebmOggError("WebM con un elemento de tamaño desconocido inesperado");
    }
    const fin = inicio + tam.valor;
    if (fin > webm.length) {
      // Una grabación cortada a media escritura: lo leído hasta aquí sirve.
      if (id.valor === ID.SimpleBlock || id.valor === ID.Block) break;
      throw new WebmOggError("WebM truncado");
    }
    const datos = webm.subarray(inicio, fin);

    switch (id.valor) {
      case ID.TrackNumber:
        if (actual) actual.numero = leerUint(datos);
        break;
      case ID.CodecID:
        if (actual) actual.codec = new TextDecoder().decode(datos);
        break;
      case ID.CodecPrivate:
        if (actual) actual.privado = datos;
        break;
      case ID.CodecDelay:
        if (actual) actual.retrasoNs = leerUint(datos);
        break;
      case ID.Channels:
        if (actual) actual.canales = leerUint(datos);
        break;
      case ID.SimpleBlock:
      case ID.Block:
        bloques.push(datos);
        break;
    }
    pos = fin;
  }

  if (!vioEbml) throw new WebmOggError("El archivo no es WebM");
  const pista = pistas.find((p) => p.codec === "A_OPUS");
  if (!pista) throw new WebmOggError("El WebM no trae audio Opus");

  const paquetes: Uint8Array[] = [];
  for (const b of bloques) {
    const pistaDelBloque = leerVint(b, 0, false);
    if (pistaDelBloque.valor !== pista.numero) continue;
    const cabecera = pistaDelBloque.largo + 3; // + timecode (2) + flags (1)
    const flags = b[pistaDelBloque.largo + 2] ?? 0;
    if (flags & 0x06) {
      // MediaRecorder no usa lacing; otro grabador podría. Mejor decirlo.
      throw new WebmOggError("WebM con lacing: no se puede convertir sin recodificar");
    }
    const paquete = b.subarray(cabecera);
    if (paquete.length > 0) paquetes.push(paquete);
  }
  if (paquetes.length === 0) throw new WebmOggError("La grabación está vacía");
  return { pista, paquetes };
}

// ── Ogg ────────────────────────────────────────────────────────────────────

const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** CRC de Ogg: polinomio 0x04C11DB7, sin reflejar, semilla 0. */
export function crcOgg(datos: Uint8Array): number {
  let crc = 0;
  for (const b of datos) crc = ((crc << 8) ^ CRC_TABLA[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

function pagina(
  paquetes: Uint8Array[],
  opciones: { tipo: number; granulo: number; serie: number; secuencia: number }
): Uint8Array {
  const segmentos: number[] = [];
  for (const p of paquetes) {
    let resto = p.length;
    while (resto >= 255) {
      segmentos.push(255);
      resto -= 255;
    }
    segmentos.push(resto);
  }
  const cuerpo = paquetes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(27 + segmentos.length + cuerpo);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  out[4] = 0;
  out[5] = opciones.tipo;
  dv.setBigInt64(6, BigInt(opciones.granulo), true);
  dv.setUint32(14, opciones.serie, true);
  dv.setUint32(18, opciones.secuencia, true);
  out[26] = segmentos.length;
  out.set(segmentos, 27);
  let pos = 27 + segmentos.length;
  for (const p of paquetes) {
    out.set(p, pos);
    pos += p.length;
  }
  dv.setUint32(22, crcOgg(out), true);
  return out;
}

function opusHead(pista: Pista): Uint8Array {
  const p = pista.privado;
  if (p && p.length >= 19 && new TextDecoder().decode(p.subarray(0, 8)) === "OpusHead") {
    return p;
  }
  // Sin CodecPrivate se arma la cabecera mínima (familia 0: mono o estéreo).
  const head = new Uint8Array(19);
  const dv = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = Math.min(Math.max(pista.canales, 1), 2);
  dv.setUint16(10, Math.round((pista.retrasoNs / 1e9) * 48000) || 312, true);
  dv.setUint32(12, 48000, true);
  return head;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("Wassapi");
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("OpusTags"), 0);
  dv.setUint32(8, vendor.length, true);
  out.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true);
  return out;
}

/** Paquetes por página: ~1 s de audio con tramas de 20 ms. */
const PAQUETES_POR_PAGINA = 50;

/** WebM con Opus → Ogg con Opus (mismos paquetes, sin pérdida). */
export function webmAOgg(webm: Uint8Array): Uint8Array {
  const { pista, paquetes } = extraerOpusDeWebm(webm);
  return empaquetarOgg(opusHead(pista), paquetes);
}

/** Un Ogg/Opus con estos paquetes; sin `head`, la cabecera mono mínima. */
export function empaquetarOgg(
  head: Uint8Array = opusHead({ numero: 1, codec: "A_OPUS", privado: null, canales: 1, retrasoNs: 0 }),
  paquetes: Uint8Array[]
): Uint8Array {
  // Serie fija: el archivo tiene un solo flujo y así la salida es determinista.
  const serie = 0x566f6365; // "Voce"
  const paginas: Uint8Array[] = [
    pagina([head], { tipo: 0x02, granulo: 0, serie, secuencia: 0 }),
    pagina([opusTags()], { tipo: 0, granulo: 0, serie, secuencia: 1 }),
  ];
  let granulo = 0;
  let secuencia = 2;
  for (let i = 0; i < paquetes.length; ) {
    const grupo: Uint8Array[] = [];
    let segmentos = 0;
    while (i < paquetes.length && grupo.length < PAQUETES_POR_PAGINA) {
      const p = paquetes[i]!;
      const suyos = Math.floor(p.length / 255) + 1;
      if (segmentos + suyos > 255) break;
      grupo.push(p);
      segmentos += suyos;
      granulo += muestrasDePaquete(p);
      i++;
    }
    if (grupo.length === 0) throw new WebmOggError("Paquete Opus demasiado grande");
    const ultima = i >= paquetes.length;
    paginas.push(
      pagina(grupo, { tipo: ultima ? 0x04 : 0, granulo, serie, secuencia: secuencia++ })
    );
  }
  const total = paginas.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of paginas) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** ¿Es WebM? (cabecera EBML). */
export function esWebm(datos: Uint8Array): boolean {
  return datos[0] === 0x1a && datos[1] === 0x45 && datos[2] === 0xdf && datos[3] === 0xa3;
}
