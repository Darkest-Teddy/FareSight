# FareSight splat experiment · 2026-11-21

This experiment tests turning ordinary restaurant photos into Gaussian splats for the Quest 3 viewer.
- **Rooms:** WorldMirror 2.0 on Replicate. 3 restaurants × {2, 3 photos} × {518, 952 px}.
- **Dishes:** SAM 3D Objects (fal), Idol (fal) and TRELLIS (Replicate). 8 dishes, one photo each.

## Results

- **Rooms:** 0 of 12 passed the "walkable room" bar.
  - Cost: $0.20 for all 12 jobs, or $0.009–$0.027 per room. The $0.25-per-location target isn't the constraint.
  - Each room looks right from photo 1's position and holds up for about 0.25–0.4 m of head movement. By about 1.5 m into the room it breaks into holes and smears.
  - 952 px cost about 50% more and gave the same holes once you moved. A third photo rescued none of the six comparisons.
  - Working default: 2 photos at 518 px.
- **Dishes:** total spend $1.56. Acceptance after retries:

  | Provider | Accepted | Cost per accepted dish |
  |---|---|---|
  | SAM 3D Objects | 6/8 | $0.037 |
  | Idol | 6/8 | $0.20 |
  | TRELLIS | 5/8 | $0.029 |

  SAM and Idol failed on different dishes. Using SAM first and Idol only on SAM's failures accepted 8/8 for $0.52. The SAM costs are estimates, because fal didn't expose billing for this key.

## Contents

| Path | What it is |
|---|---|
| `rooms/report.md` | Room method, 12-job results table, cost per configuration, recommendation |
| `rooms/results.json` | Every billable room attempt: prediction id, GPU seconds, cost, stats, scores |
| `rooms/sources/` | The 9 source photos with authors and licences (`manifest.json`) |
| `rooms/outputs/<room>-<n>p-<px>/` | Quest-ready `room-100000.sog` and `room-250000.sog`, renders, contact sheet, camera poses |
| `rooms/outputs/baseline/` | Free single-photo fallback: Depth Anything V2 depth mesh (`room.glb`) and renders |
| `dishes/report.md` | Dish method, per-provider comparison, cost per accepted dish, recommendation |
| `dishes/results.json`, `dishes/outputs/*/*/attempt*/job.json` | Every dish attempt: job id, cost, stats, scores |
| `dishes/sources/` | The dish photos with authors and licences |
| `dishes/outputs/<dish>/<provider>/attempt<N>/` | `30k.sog` and `60k.sog` (leveled, metres, plate on y = 0), review renders |
| `dishes/outputs/contact-sheets/` | One comparison sheet per dish |
| `viewer/` | Local 3D viewer for all of the above |
| `*/*.py` | The scripts that produced everything |

## View it in 3D

Requires Node 18 or newer, with no install step.

```sh
node viewer/server.mjs
# open http://localhost:5180
```

- **Rooms tab:** pick a restaurant and configuration. The view starts at photo 1's camera.
  - Controls: drag to look, WASD to move, Q/E to go down or up.
  - The corner shows your estimated distance from photo 1.
  - "Overlay photo 1" checks fidelity against the source photo.
- **Dishes tab:** the providers sit side by side at real size on a table, with their scores and costs.

## Not included

The bundle leaves out about 4 GB of raw and intermediate files: raw model PLYs, decimated and normalized PLYs, provider zip archives and depth `.npy` arrays. Everything the reports cite for review is here, along with the Quest-ready SOG files and the GLB. The full-resolution files stay in the FareSight repository under `experiments/splat-eval-2026-11-21/`.

## Caveats

- **Source photos:** they are openly licensed tourist photos of Vienna, Paris and New York interiors, not Boston. Some room sets span several years.
- **Sample size:** eight dishes and three rooms are a small sample. The acceptance rates are directional.
- **Quest performance:** frame time on Quest 3 was not measured. Gaussian count and file size are the proxy.
