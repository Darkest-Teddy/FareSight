# Difix repair test · El Jefe's · 2026-11-21

**Question:** can an AI clean-up model repair the gaps in a WorldMirror splat?

**Answer:** not the way we can run it cheaply. Difix itself works well on individual frames. Feeding the cleaned frames back into WorldMirror barely changed the splat.

## What was done

1. **Rendered gap views.** `make_views.py` rendered 8 views from `eljefes-kenmore-all-952` at 1/3 and 2/3 of the way between consecutive photos taken at least 0.8 m apart (steps of 1.0–4.0 m).
2. **Cleaned them.** `fix_views.py` ran NVIDIA **Difix** (`nvidia/difix_ref`) on each view, with the nearest real photo as the reference. It runs locally on Apple MPS at about 2.5 s per image. See `views/eljefes-kenmore-all-952/before-after.jpg`.
3. **Rebuilt the room.** WorldMirror 2.0 was run again on the 12 real photos plus the 8 cleaned views, at 952 px, for $0.054. The output is `boston/outputs/eljefes-kenmore-difix-all-952/`.
4. **Compared.** Both splats were rendered from the halfway points between photos. Difix never saw those viewpoints, so they're a fair test. See `eljefes-before-after-walk.jpg`.

## Result

| Halfway view | Empty pixels before | Empty pixels after |
|---|---|---|
| photos 2→3 | 4.0% | 3.3% |
| photos 4→5 | 6.9% | 5.8% |
| photos 5→6 | 3.3% | 3.2% |
| photos 7→8 | 13.4% | 10.4% |
| photos 8→9 | 1.4% | 2.5% |
| photos 11→12 | 1.8% | 1.3% |
| **Mean** | **5.1%** | **4.4%** |

"Empty" means near-black pixels, so the measure also counts some genuinely dark surfaces.

The views look almost the same before and after. The holes in the floor near the camera and the smeared red railings remain.

- **Difix on single frames:** it does what it claims. The cleaned frames remove smears and fill most of the black regions.
- **Why the rebuild barely improved:** WorldMirror reconstructs each input view in one pass, without iterative training, so an extra synthetic view adds Gaussians only for what that frame shows. It doesn't fix the geometry that the other views got wrong. The Difix3D+ paper instead distils the cleaned views into the splat through repeated 3DGS optimization, over several rounds.

## Options not tried

- **Proper Difix3D+ distillation.** Fine-tune the WorldMirror splat with gsplat or OpenSplat against the real photos plus the cleaned views, over several rounds. This needs a training loop and ideally a CUDA GPU; OpenSplat also runs on Apple Metal. It would cost hours of GPU time per room rather than cents.
- **Licensing.** Difix is licensed for research and evaluation only. Production use would need NVIDIA **Fixer** (`nvidia/Fixer`), which is under the Open Model License, is based on Cosmos, and needs Linux with an NVIDIA GPU.
- **More photos.** Retaking photos about every metre is still the cheapest fix for these gaps.
