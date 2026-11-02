Fixes the Photon regression by backing out the delta-sync change. The reconciler now short-circuits on a stale ETag and the rehydration path no longer double-fires the capture hook.
