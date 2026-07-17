/**
 * Minimal Java class-file rewriter.
 *
 * Behinder sends "payload template" classes whose static String fields are
 * filled client-side before upload (its `Params.getParamedClass` uses ASM to
 * set a `ConstantValue` on the field). We only need that one feature: set a
 * static String field's ConstantValue, leaving everything else byte-identical.
 */

const CONSTANT_VALUE = "ConstantValue";

class Cursor {
  constructor(readonly buf: Buffer) {}
  u1(off: number): number {
    return this.buf.readUInt8(off);
  }
  u2(off: number): number {
    return this.buf.readUInt16BE(off);
  }
}

interface PoolInfo {
  count: number;
  /** offset just past the last pool entry */
  end: number;
  utf8: Map<number, string>;
  constantValueNameIndex: number; // 0 = absent
}

function readPool(cur: Cursor): PoolInfo {
  const buf = cur.buf;
  const count = cur.u2(8);
  const utf8 = new Map<number, string>();
  let constantValueNameIndex = 0;
  let off = 10;
  for (let i = 1; i < count; i++) {
    const tag = cur.u1(off);
    switch (tag) {
      case 1: {
        const len = cur.u2(off + 1);
        const value = buf.toString("utf8", off + 3, off + 3 + len);
        utf8.set(i, value);
        if (value === CONSTANT_VALUE) constantValueNameIndex = i;
        off += 3 + len;
        break;
      }
      case 3: // Integer
      case 4: // Float
      case 9: // Fieldref
      case 10: // Methodref
      case 11: // InterfaceMethodref
      case 12: // NameAndType
      case 17: // Dynamic
      case 18: // InvokeDynamic
        off += 5;
        break;
      case 5: // Long — two slots
      case 6: // Double — two slots
        off += 9;
        i++;
        break;
      case 7: // Class
      case 8: // String
      case 16: // MethodType
      case 19: // Module
      case 20: // Package
        off += 3;
        break;
      case 15: // MethodHandle
        off += 4;
        break;
      default:
        throw new Error(`unsupported constant pool tag ${tag} at index ${i}`);
    }
  }
  return { count, end: off, utf8, constantValueNameIndex };
}

function encodeUtf8Entry(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  const out = Buffer.alloc(3);
  out.writeUInt8(1, 0);
  out.writeUInt16BE(data.length, 1);
  return Buffer.concat([out, data]);
}

/**
 * Return a copy of `classBytes` where the static String field `fieldName`
 * carries `ConstantValue = value` (added or replaced).
 */
export function injectStringConstant(
  classBytes: Buffer,
  fieldName: string,
  value: string,
): Buffer {
  const cur = new Cursor(classBytes);
  if (cur.buf.readUInt32BE(0) !== 0xcafebabe) {
    throw new Error("not a Java class file");
  }
  const pool = readPool(cur);

  // walk to the fields section
  let off = pool.end;
  off += 6; // access_flags, this_class, super_class
  const interfacesCount = cur.u2(off);
  off += 2 + interfacesCount * 2;
  const fieldsCount = cur.u2(off);
  off += 2;

  // new constant pool entries (appended at the end, so all existing
  // references keep working)
  const newEntries: Buffer[] = [];
  let nextIndex = pool.count;

  let cvNameIndex = pool.constantValueNameIndex;
  if (cvNameIndex === 0) {
    newEntries.push(encodeUtf8Entry(CONSTANT_VALUE));
    cvNameIndex = nextIndex++;
  }
  newEntries.push(encodeUtf8Entry(value));
  const valueUtf8Index = nextIndex++;
  const stringEntry = Buffer.alloc(3);
  stringEntry.writeUInt8(8, 0); // String tag
  stringEntry.writeUInt16BE(valueUtf8Index, 1);
  newEntries.push(stringEntry);
  const valueStringIndex = nextIndex++;

  for (let f = 0; f < fieldsCount; f++) {
    const fieldStart = off;
    const nameIndex = cur.u2(off + 2);
    const descIndex = cur.u2(off + 4);
    const attrCountOff = off + 6;
    const attrCount = cur.u2(attrCountOff);
    off += 8;
    const name = pool.utf8.get(nameIndex);
    const desc = pool.utf8.get(descIndex);
    const isTarget = name === fieldName && desc === "Ljava/lang/String;";

    for (let a = 0; a < attrCount; a++) {
      const attrNameIndex = cur.u2(off);
      const attrLen = cur.buf.readUInt32BE(off + 2);
      if (
        isTarget &&
        pool.constantValueNameIndex !== 0 &&
        attrNameIndex === pool.constantValueNameIndex
      ) {
        // replace existing ConstantValue in place: [fieldStart..off+6) + new idx + rest
        const patched = Buffer.from(classBytes.subarray(off, off + 6 + attrLen));
        patched.writeUInt16BE(valueStringIndex, 6);
        return Buffer.concat([
          headWithNewPool(classBytes, pool, newEntries),
          classBytes.subarray(pool.end, off),
          patched,
          classBytes.subarray(off + 6 + attrLen),
        ]);
      }
      off += 6 + attrLen;
    }

    if (isTarget) {
      // append a new ConstantValue attribute to this field
      const newAttr = Buffer.alloc(8);
      newAttr.writeUInt16BE(cvNameIndex, 0);
      newAttr.writeUInt32BE(2, 2);
      newAttr.writeUInt16BE(valueStringIndex, 6);
      const fieldBytes = Buffer.from(classBytes.subarray(fieldStart, off));
      fieldBytes.writeUInt16BE(attrCount + 1, 6);
      return Buffer.concat([
        headWithNewPool(classBytes, pool, newEntries),
        classBytes.subarray(pool.end, fieldStart),
        fieldBytes,
        newAttr,
        classBytes.subarray(off),
      ]);
    }
  }
  throw new Error(`field ${fieldName} (Ljava/lang/String;) not found in class`);
}

/**
 * Read back a static String field's ConstantValue, or null when absent.
 * Mirrors the injection above; useful for verification and test harnesses.
 */
export function readStringConstant(classBytes: Buffer, fieldName: string): string | null {
  const cur = new Cursor(classBytes);
  if (cur.buf.readUInt32BE(0) !== 0xcafebabe) {
    throw new Error("not a Java class file");
  }
  const pool = readPool(cur);
  const strings = new Map<number, number>();
  {
    let off = 10;
    for (let i = 1; i < pool.count; i++) {
      const tag = cur.u1(off);
      if (tag === 8) strings.set(i, cur.u2(off + 1));
      if (tag === 1) off += 3 + cur.u2(off + 1);
      else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) off += 5;
      else if (tag === 5 || tag === 6) {
        off += 9;
        i++;
      } else if ([7, 8, 16, 19, 20].includes(tag)) off += 3;
      else if (tag === 15) off += 4;
      else throw new Error(`unsupported constant pool tag ${tag} at index ${i}`);
    }
  }

  let off = pool.end + 6;
  const interfacesCount = cur.u2(off);
  off += 2 + interfacesCount * 2;
  const fieldsCount = cur.u2(off);
  off += 2;
  for (let f = 0; f < fieldsCount; f++) {
    const name = pool.utf8.get(cur.u2(off + 2));
    const attrCount = cur.u2(off + 6);
    off += 8;
    for (let a = 0; a < attrCount; a++) {
      const attrNameIndex = cur.u2(off);
      const attrLen = cur.buf.readUInt32BE(off + 2);
      if (
        name === fieldName &&
        pool.constantValueNameIndex !== 0 &&
        attrNameIndex === pool.constantValueNameIndex
      ) {
        const utf8Index = strings.get(cur.u2(off + 6));
        return utf8Index === undefined ? null : (pool.utf8.get(utf8Index) ?? null);
      }
      off += 6 + attrLen;
    }
  }
  return null;
}

/** file head (through the pool) with patched pool count + appended entries */
function headWithNewPool(classBytes: Buffer, pool: PoolInfo, newEntries: Buffer[]): Buffer {
  const head = Buffer.from(classBytes.subarray(0, pool.end));
  head.writeUInt16BE(pool.count + newEntries.length, 8);
  return Buffer.concat([head, ...newEntries]);
}
