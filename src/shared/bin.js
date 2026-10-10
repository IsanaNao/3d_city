// Little-endian helpers shared by the compiler (Node) and the viewer.

export class BinWriter {
  constructor() {
    this.buf = new Uint8Array(256);
    this.view = new DataView(this.buf.buffer);
    this.o = 0;
  }

  ensure(n) {
    if (this.o + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.o + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.o));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) {
    this.ensure(1);
    this.buf[this.o++] = v & 255;
  }

  u16(v) {
    this.ensure(2);
    this.view.setUint16(this.o, v & 0xffff, true);
    this.o += 2;
  }

  u32(v) {
    this.ensure(4);
    this.view.setUint32(this.o, v >>> 0, true);
    this.o += 4;
  }

  i32(v) {
    this.ensure(4);
    this.view.setInt32(this.o, v | 0, true);
    this.o += 4;
  }

  f32(v) {
    this.ensure(4);
    this.view.setFloat32(this.o, Number.isFinite(v) ? v : 0, true);
    this.o += 4;
  }

  raw(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.o);
    this.o += arr.length;
  }

  bytes() {
    return this.buf.slice(0, this.o);
  }
}

export function binReader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = (n) => {
    if (o + n > bytes.length) throw new Error('binary ended early');
  };
  return {
    u8() { need(1); return bytes[o++]; },
    u16() { need(2); const v = view.getUint16(o, true); o += 2; return v; },
    u32() { need(4); const v = view.getUint32(o, true); o += 4; return v; },
    i32() { need(4); const v = view.getInt32(o, true); o += 4; return v; },
    f32() { need(4); const v = view.getFloat32(o, true); o += 4; return v; },
    bytes(n) { need(n); const s = bytes.subarray(o, o + n); o += n; return s; },
    get offset() { return o; },
    get length() { return bytes.byteLength; },
    rest() { return bytes.byteLength - o; },
  };
}
