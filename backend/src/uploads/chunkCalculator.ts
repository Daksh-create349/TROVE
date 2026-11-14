export interface SegmentSpec {
  partIndex: number;
  offset: number;
  size: number;
}

export interface SegmentPlan {
  totalSize: number;
  segmentSize: number;
  totalParts: number;
  segments: SegmentSpec[];
}

/**
 * Calculates the logical segments for an upload given the file's total size
 * and the safe segment size determined by Telegram account capabilities.
 *
 * For a 0-byte file, exactly 1 segment of size 0 is created.
 */
export function calculateSegments(
  totalSize: number,
  safeSegmentSize: number,
): SegmentPlan {
  if (totalSize < 0) {
    throw new Error(`Invalid total file size: ${totalSize}`);
  }
  if (safeSegmentSize <= 0) {
    throw new Error(`Invalid safe segment size: ${safeSegmentSize}`);
  }

  if (totalSize === 0) {
    return {
      totalSize: 0,
      segmentSize: safeSegmentSize,
      totalParts: 0,
      segments: [],
    };
  }

  const totalParts = Math.ceil(totalSize / safeSegmentSize);
  const segments: SegmentSpec[] = [];

  for (let i = 0; i < totalParts; i++) {
    const offset = i * safeSegmentSize;
    const size = Math.min(safeSegmentSize, totalSize - offset);
    segments.push({
      partIndex: i,
      offset,
      size,
    });
  }

  return {
    totalSize,
    segmentSize: safeSegmentSize,
    totalParts,
    segments,
  };
}
