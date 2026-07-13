function parsePngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
  if (buffer.length < 33
    || buffer.readUInt32BE(8) !== 13
    || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('PNG 文件缺少完整的 IHDR 图片信息');
  }
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), orientation: 1 };
}

function readExifOrientation(buffer, start, end) {
  if (start + 14 > end || buffer.subarray(start, start + 6).toString('ascii') !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  const byteOrder = buffer.subarray(tiff, tiff + 2).toString('ascii');
  if (byteOrder !== 'II' && byteOrder !== 'MM') return 1;
  const littleEndian = byteOrder === 'II';
  const read16 = (offset) => littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const read32 = (offset) => littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (read16(tiff + 2) !== 42) return 1;
  const ifd = tiff + read32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = read16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return 1;
    if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
      const orientation = read16(entry + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

function parseJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  let orientation = 1;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('JPEG 标记结构不完整');
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (!Number.isInteger(marker) || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('JPEG 文件结构不完整');
    if (marker === 0xe1) orientation = readExifOrientation(buffer, offset + 2, offset + length);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (length < 11) throw new Error('JPEG 图片尺寸信息不完整');
      const components = buffer[offset + 7];
      if (!components || length !== 8 + components * 3) throw new Error('JPEG 图片帧信息不完整');
      return {
        format: 'jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        orientation,
      };
    }
    offset += length;
  }
  throw new Error('JPEG 文件缺少图片尺寸信息');
}

function parseImageSize(buffer) {
  return parsePngSize(buffer) || parseJpegSize(buffer) || (() => {
    throw new Error('仅支持有效的 JPG 或 PNG 图片');
  })();
}

module.exports = { parseImageSize };
