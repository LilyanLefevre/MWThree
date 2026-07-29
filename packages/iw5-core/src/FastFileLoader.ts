// packages/iw5-core/src/FastFileLoader.ts
import * as pako from 'pako'

const FASTFILE_MAGIC = 0x303066665749; // 'IWff00' as little-endian 64-bit integer, or just 'IWff0100' for MW3
const FASTFILE_VERSION = 0x01; // MW3 FastFile version

interface FastFileHeader {
  magic: number; // 'IWff0100'
  version: number;
  // Add other header fields as discovered through reverse engineering
}

export class FastFileLoader {
  private buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
  }

  private readHeader(): FastFileHeader {
    const view = new DataView(this.buffer);
    let offset = 0;

    const magic = view.getUint32(offset, true); // Read first 4 bytes for magic
    offset += 4;
    const version = view.getUint32(offset, true); // Read next 4 bytes for version (assuming it's part of initial header for simplicity, will refine)
    offset += 4;

    // Simplified magic check for now. The actual magic is 'IWff0100'.
    // We'll adjust this once we have a more precise understanding of the header structure.
    // For MW3, the full magic is 0x30303166665749 for 'IWff100' (little-endian)
    // A common simplified check is for 'IWff'
    const expectedMagicPart = 0x66665749; // 'IWff'

    if ((magic & 0xFFFFFFFF) !== expectedMagicPart) {
      throw new Error(`FastFileLoader Error: Invalid FastFile magic. Expected part ${expectedMagicPart.toString(16)}, got ${(magic & 0xFFFFFFFF).toString(16)}`);
    }
    if (version !== FASTFILE_VERSION) {
      throw new Error(`FastFileLoader Error: Unsupported FastFile version. Expected ${FASTFILE_VERSION}, got ${version}`);
    }

    // TODO: Read more header fields based on COD Engine Research / OAT

    return {
      magic: magic, // Will likely be a combined 64-bit value or multiple fields
      version: version,
    };
  }

  private decompressZlibBlocks(offset: number): ArrayBuffer {
    const decompressedChunks: Uint8Array[] = [];
    let currentOffset = offset;
    const dataView = new DataView(this.buffer);

    while (currentOffset < this.buffer.byteLength) {
      // Read 16-bit size (little-endian)
      if (currentOffset + 2 > this.buffer.byteLength) {
        console.warn("FastFileLoader Warning: Reached end of buffer prematurely while reading zlib block size.");
        break;
      }
      const blockSize = dataView.getUint16(currentOffset, true);
      currentOffset += 2;

      if (blockSize === 0) {
        // A block size of 0 usually indicates the end of the zlib blocks
        break;
      }

      // Ensure we have enough data for the zlib block
      if (currentOffset + blockSize > this.buffer.byteLength) {
        throw new Error(`FastFileLoader Error: Zlib block extends beyond buffer limits. Expected ${blockSize} bytes, but only ${this.buffer.byteLength - currentOffset} available.`);
      }

      const compressedData = new Uint8Array(this.buffer, currentOffset, blockSize);
      currentOffset += blockSize;

      try {
        const decompressed = pako.inflate(compressedData);
        decompressedChunks.push(decompressed);
      } catch (error: any) {
        throw new Error(`FastFileLoader Error: Failed to decompress zlib block at offset ${currentOffset - blockSize}. ${error.message}`);
      }
    }
    
    // Reconstitute the full decompressed buffer
    const totalLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const resultBuffer = new Uint8Array(totalLength);
    let writeOffset = 0;
    for (const chunk of decompressedChunks) {
      resultBuffer.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    return resultBuffer.buffer;
  }

  public load(): ArrayBuffer {
    console.log("Loading FastFile...");
    const header = this.readHeader();
    console.log("FastFile Header:", header);

    // After the header, the zlib blocks start. Need to determine the exact offset.
    // For now, assuming zlib blocks start right after the basic magic and version check.
    // This offset needs to be refined based on actual FastFile structure.
    const zlibBlocksStartOffset = 8; // Adjust this based on actual header size

    const decompressedZone = this.decompressZlibBlocks(zlibBlocksStartOffset);
    console.log(`FastFile decompressed. Original size: ${this.buffer.byteLength} bytes, Decompressed zone size: ${decompressedZone.byteLength} bytes`);
    return decompressedZone;
  }
}
