/**
 * Robust clock synchronization with median filtering, EWMA smoothing, and drift correction.
 * Used by both audience (room clock + controller ping) and operator (controller ping) clients.
 */

export const SYNC_CONFIG = Object.freeze({
  // Sample collection
  SAMPLE_WINDOW: 5,           // Number of samples to keep for median filtering
  MIN_SAMPLES_FOR_MEDIAN: 3,  // Minimum samples before using median

  // EWMA smoothing
  EWMA_ALPHA: 0.15,           // Smoothing factor for offset (0.1-0.2 recommended)
  EWMA_ALPHA_DRIFT: 0.05,     // Smoothing factor for drift estimation

  // Outlier rejection
  RTT_OUTLIER_FACTOR: 3.0,    // Reject samples with RTT > median_rtt * this
  OFFSET_OUTLIER_MS: 50,      // Reject samples with |offset - median_offset| > this
  MAX_RTT_MS: 2000,           // Hard ceiling for any sample

  // Drift correction
  DRIFT_CORRECTION_INTERVAL_MS: 1000,  // Apply drift correction per-frame
  MAX_DRIFT_CORRECTION_PPM: 100,       // Max parts-per-million correction

  // Controller ping specific
  CONTROLLER_PING_WEIGHT: 2.0, // Weight controller samples higher than room samples
});

/**
 * Statistics helper for median and percentile calculations.
 */
function median(sortedArray) {
  if (!sortedArray.length) return null;
  const mid = Math.floor(sortedArray.length / 2);
  return sortedArray.length % 2 === 0
    ? (sortedArray[mid - 1] + sortedArray[mid]) / 2
    : sortedArray[mid];
}

/**
 * Robust clock synchronizer.
 * Maintains filtered offset, RTT, and drift estimates.
 */
export class ClockSync {
  constructor(options = {}) {
    this.config = { ...SYNC_CONFIG, ...options };

    // Raw sample buffers (for median filtering)
    this.offsetSamples = [];
    this.rttSamples = [];
    this.timestamps = [];  // When each sample was taken (local time)

    // Filtered state
    this.offset = 0;           // Current best offset estimate (server - local)
    this.rtt = Infinity;       // Current best RTT estimate
    this.driftPpm = 0;         // Clock drift in parts-per-million
    this.lastOffset = 0;       // Previous offset for drift calculation
    this.lastSampleTime = 0;   // Local time of last accepted sample

    // EWMA state
    this.ewmaOffset = null;
    this.ewmaDrift = null;

    // Quality metrics
    this.sampleCount = 0;
    this.rejectedCount = 0;
    this.lastUpdateTime = 0;
  }

  /**
   * Add a new clock sample.
   * @param {number} clientSent - Local timestamp when request was sent
   * @param {number} serverReceived - Server timestamp when request received
   * @param {number} serverSent - Server timestamp when response sent
   * @param {number} clientReceived - Local timestamp when response received
   * @param {number} weight - Sample weight (controller ping = higher)
   * @returns {boolean} True if sample was accepted
   */
  addSample(clientSent, serverReceived, serverSent, clientReceived, weight = 1) {
    const now = clientReceived;
    const networkRtt = (clientReceived - clientSent) - (serverSent - serverReceived);
    const offset = ((serverReceived - clientSent) + (serverSent - clientReceived)) / 2;

    // Basic validity checks
    if (!Number.isFinite(networkRtt) || networkRtt < 0 || networkRtt > this.config.MAX_RTT_MS) {
      this.rejectedCount++;
      return false;
    }
    if (!Number.isFinite(offset)) {
      this.rejectedCount++;
      return false;
    }

    // Outlier rejection based on current median (if we have enough samples)
    if (this.rttSamples.length >= this.config.MIN_SAMPLES_FOR_MEDIAN) {
      const sortedRtt = [...this.rttSamples].sort((a, b) => a - b);
      const medianRtt = median(sortedRtt);
      if (networkRtt > medianRtt * this.config.RTT_OUTLIER_FACTOR) {
        this.rejectedCount++;
        return false;
      }

      const sortedOffsets = [...this.offsetSamples].sort((a, b) => a - b);
      const medianOffset = median(sortedOffsets);
      if (Math.abs(offset - medianOffset) > this.config.OFFSET_OUTLIER_MS) {
        this.rejectedCount++;
        return false;
      }
    }

    // Accept sample
    this.offsetSamples.push(offset);
    this.rttSamples.push(networkRtt);
    this.timestamps.push(now);

    // Trim to window
    const maxWindow = this.config.SAMPLE_WINDOW;
    if (this.offsetSamples.length > maxWindow) {
      this.offsetSamples.shift();
      this.rttSamples.shift();
      this.timestamps.shift();
    }

    this._recompute();
    this.lastUpdateTime = now;
    this.sampleCount++;
    return true;
  }

  /**
   * Recompute filtered estimates from current samples.
   */
  _recompute() {
    if (this.offsetSamples.length === 0) return;

    const sortedOffsets = [...this.offsetSamples].sort((a, b) => a - b);
    const sortedRtts = [...this.rttSamples].sort((a, b) => a - b);

    const medianOffset = median(sortedOffsets);
    const medianRtt = median(sortedRtts);

    // EWMA smoothing for offset
    if (this.ewmaOffset === null) {
      this.ewmaOffset = medianOffset;
    } else {
      this.ewmaOffset = this.config.EWMA_ALPHA * medianOffset + (1 - this.config.EWMA_ALPHA) * this.ewmaOffset;
    }
    this.offset = this.ewmaOffset;
    this.rtt = medianRtt;

    // Drift estimation (ppm) from consecutive samples
    if (this.lastOffset !== 0 && this.lastSampleTime !== 0 && this.timestamps.length >= 2) {
      const dt = this.timestamps[this.timestamps.length - 1] - this.lastSampleTime;
      if (dt > 0) {
        const rawDriftPpm = ((this.offset - this.lastOffset) / dt) * 1e6;
        const clampedDrift = Math.max(-this.config.MAX_DRIFT_CORRECTION_PPM,
                                      Math.min(this.config.MAX_DRIFT_CORRECTION_PPM, rawDriftPpm));

        if (this.ewmaDrift === null) {
          this.ewmaDrift = clampedDrift;
        } else {
          this.ewmaDrift = this.config.EWMA_ALPHA_DRIFT * clampedDrift + (1 - this.config.EWMA_ALPHA_DRIFT) * this.ewmaDrift;
        }
        this.driftPpm = this.ewmaDrift;
      }
    }

    this.lastOffset = this.offset;
    this.lastSampleTime = this.timestamps[this.timestamps.length - 1];
  }

  /**
   * Get current server time estimate for a given local time.
   * Applies drift correction since last sample.
   * @param {number} localTime - Local timestamp (performance.now())
   * @returns {number} Estimated server time
   */
  getServerTime(localTime = performance.now()) {
    if (this.sampleCount === 0) return localTime; // No sync yet

    const dt = localTime - this.lastSampleTime;
    const driftCorrection = (this.driftPpm / 1e6) * dt;
    return localTime + this.offset + driftCorrection;
  }

  /**
   * Get current sync quality metrics.
   */
  getQuality() {
    if (this.sampleCount === 0) return { synced: false, reason: 'no_samples' };

    const sortedOffsets = [...this.offsetSamples].sort((a, b) => a - b);
    const sortedRtts = [...this.rttSamples].sort((a, b) => a - b);
    const offsetSpread = sortedOffsets.length > 1
      ? sortedOffsets[sortedOffsets.length - 1] - sortedOffsets[0]
      : 0;
    const rttSpread = sortedRtts.length > 1
      ? sortedRtts[sortedRtts.length - 1] - sortedRtts[0]
      : 0;

    return {
      synced: true,
      sampleCount: this.sampleCount,
      rejectedCount: this.rejectedCount,
      offset: this.offset,
      rtt: this.rtt,
      driftPpm: this.driftPpm,
      offsetSpread,
      rttSpread,
      lastUpdate: this.lastUpdateTime,
      age: performance.now() - this.lastUpdateTime,
    };
  }

  /**
   * Reset all state.
   */
  reset() {
    this.offsetSamples = [];
    this.rttSamples = [];
    this.timestamps = [];
    this.offset = 0;
    this.rtt = Infinity;
    this.driftPpm = 0;
    this.lastOffset = 0;
    this.lastSampleTime = 0;
    this.ewmaOffset = null;
    this.ewmaDrift = null;
    this.sampleCount = 0;
    this.rejectedCount = 0;
    this.lastUpdateTime = 0;
  }

  /**
   * Check if sync is stale (no updates for a while).
   * @param {number} maxAgeMs - Maximum age before considering stale
   */
  isStale(maxAgeMs = 10000) {
    return this.sampleCount === 0 || (performance.now() - this.lastUpdateTime) > maxAgeMs;
  }
}

/**
 * Convenience: create a probe collector for a batch of samples.
 * Usage:
 *   const probe = createProbe();
 *   for (each sample) probe.add(clientSent, serverReceived, serverSent, clientReceived);
 *   const { offset, rtt, quality } = probe.finish();
 */
export function createProbe(sync, weight = 1) {
  const samples = [];
  return {
    add(clientSent, serverReceived, serverSent, clientReceived) {
      samples.push({ clientSent, serverReceived, serverSent, clientReceived });
    },
    finish() {
      let accepted = 0;
      for (const s of samples) {
        if (sync.addSample(s.clientSent, s.serverReceived, s.serverSent, s.clientReceived, weight)) {
          accepted++;
        }
      }
      return { accepted, ...sync.getQuality() };
    },
    get samples() { return samples; },
  };
}

/**
 * High-level helper: run a sync round against a WebSocket endpoint.
 * Sends `count` pings spaced by `intervalMs`, collects responses, updates sync.
 * Returns a promise that resolves with the final quality metrics.
 */
export async function runSyncRound(sendFn, onResponse, sync, options = {}) {
  const {
    count = 8,
    intervalMs = 70,
    timeoutMs = 3000,
    weight = 1,
  } = options;

  const probe = createProbe(sync, weight);
  const pending = new Map();
  let resolved = false;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };

  const promise = new Promise((resolve) => {
    const finish = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(probe.finish());
    };

    const timeoutId = setTimeout(finish, timeoutMs);

    // Send pings
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (resolved) return;
        const clientSent = performance.now();
        const probeId = crypto.randomUUID();
        pending.set(probeId, clientSent);
        sendFn({ type: 'sync', clientSent, probeId });
      }, i * intervalMs);
    }

    // Response handler (caller must wire this up)
    onResponse((message) => {
      if (resolved) return;
      const clientSent = pending.get(message.probeId);
      if (clientSent === undefined) return;
      pending.delete(message.probeId);

      probe.add(clientSent, message.serverReceived, message.serverSent, performance.now());

      if (pending.size === 0 && probe.samples.length >= Math.min(count, sync.config.MIN_SAMPLES_FOR_MEDIAN)) {
        // Got minimum viable samples, can finish early
        finish();
      }
    });
  });

  return promise;
}