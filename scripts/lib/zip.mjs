/*  A small zip writer: STORE method (no compression — the audio is already
 *  compressed, and stored files can be checked and extracted by any tool),
 *  with ZIP64 records when the package grows past 4 GB or 65,535 files.
 *  Writes entry by entry to a file (pass a path), or into memory (pass nothing,
 *  then take .buffer() after close()) — for a zip that goes straight on to be
 *  encrypted and must never touch the disk unencrypted.
 */
import { openSync, writeSync, closeSync } from "node:fs";
import { crc32 } from "node:zlib";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const MAX32 = 0xFFFFFFFF;

export class ZipWriter {
  constructor(path){ this.fd = path ? openSync(path, "w") : null; this.chunks = []; this.offset = 0; this.central = []; }
  #write(buf){ if(this.fd === null) this.chunks.push(buf); else writeSync(this.fd, buf); this.offset += buf.length; }
  buffer(){ return Buffer.concat(this.chunks); }
  add(name, data, date = new Date()){
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data), size = data.length, at = this.offset;
    const big = size >= MAX32 || at >= MAX32;
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    const zip64Local = big ? Buffer.concat([u16(0x0001), u16(16), u64(size), u64(size)]) : Buffer.alloc(0);
    this.#write(Buffer.concat([
      u32(0x04034b50), u16(big ? 45 : 20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(big ? MAX32 : size), u32(big ? MAX32 : size), u16(nameBuf.length), u16(zip64Local.length),
      nameBuf, zip64Local]));
    this.#write(data);
    this.central.push({ nameBuf, crc, size, at, dosTime, dosDate });
  }
  close(){
    const cdStart = this.offset;
    for(const e of this.central){
      const big = e.size >= MAX32 || e.at >= MAX32;
      const extra = big ? Buffer.concat([u16(0x0001), u16(24), u64(e.size), u64(e.size), u64(e.at)]) : Buffer.alloc(0);
      this.#write(Buffer.concat([
        u32(0x02014b50), u16(big ? 45 : 20), u16(big ? 45 : 20), u16(0x0800), u16(0), u16(e.dosTime), u16(e.dosDate),
        u32(e.crc), u32(big ? MAX32 : e.size), u32(big ? MAX32 : e.size), u16(e.nameBuf.length), u16(extra.length), u16(0),
        u16(0), u16(0), u32(0), u32(big ? MAX32 : e.at), e.nameBuf, extra]));
    }
    const cdSize = this.offset - cdStart, n = this.central.length;
    const need64 = n >= 0xFFFF || cdStart >= MAX32 || cdSize >= MAX32 || this.central.some(e => e.size >= MAX32 || e.at >= MAX32);
    if(need64){
      const z64 = this.offset;
      this.#write(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(n), u64(n), u64(cdSize), u64(cdStart)]));
      this.#write(Buffer.concat([u32(0x07064b50), u32(0), u64(z64), u32(1)]));
    }
    this.#write(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(Math.min(n, 0xFFFF)), u16(Math.min(n, 0xFFFF)),
                               u32(Math.min(cdSize, MAX32)), u32(Math.min(cdStart, MAX32)), u16(0)]));
    if(this.fd !== null) closeSync(this.fd);
  }
}
