# FareSight dining-room splat experiment

## Result

**0 of 12 reconstructions passed the visual publishability gate.** Every configuration accepted 0 of 3 locations, so cost per accepted location is undefined and the $0.25 target remains unproven. The most common failure was missing or distorted geometry as the camera moved into the scene. The source viewpoint often looked convincing.

**Use two photos at 518 px as the default first pass for review.** It was the cheapest configuration to attempt across the same three rooms. Route every result through the visual gate before it is eligible to publish.

Replicate inference cost an estimated **$0.20032995** for **205.467 active seconds**. That includes 12 successful reconstructions and one billed input-transport failure. All 12 model archives, SOGs, and review sheets are saved locally. [Billable attempt ledger](results.json)

## Re-check: opacity, density and field of view

An outside review raised three possible confounds. Each was checked locally against the saved model output, with no new inference. The script is `opacity_check.py`, and the sheets are in `outputs/opacity-check/<config>/comparison.png`.

**What was checked:** the three 2-photo/518 px rooms, plus Café Central at 3 photos/952 px (1.27 M Gaussians).

| Question | Finding | Effect on the verdict |
|---|---|---|
| Is opacity encoded wrong? | **Yes.** All 12 raw PLYs store activated opacity (range 0.0025–1.0, scales in log space). SplatTransform reads that field as a logit, so every Gaussian rendered at 50–73% opacity. The scored renders and the shipped SOGs all carry this bug. | Fixing it makes renders crisper and removes some speckled floaters, such as on McSorley's floor. The holes and smears are unchanged. |
| Did 100k decimation cause the failures? | **No.** Native density (up to 1.27 M), 250k and 100k look nearly the same at every pose. | Same verdict. 100k remains a fine Quest tier. |
| Did the 62° field of view exaggerate the gaps? | **Partly.** At photo 1's own FOV (44–60°), the near views at 0.25–0.5 m lose most of their black frame edges. | Near-viewpoint viewing is better than the sheets showed. At about 1.5 m, every room still shows disocclusion holes behind columns and furniture. |

**Conclusion:** 0 of 12 still pass the walkable-room bar. The failure is missing geometry from too few viewpoints, not conversion or compression.

`evaluate.py` now writes `gaussians-opacity-fixed.ply` before decimating or converting. The SOGs already in `outputs/<config>/` predate that change and are left as scored.

`apply_sky_mask` was left at its default of `true`, and that remains untested. A single controlled run with it set to `false` would cost about $0.013.

## Photo sets

All nine photos came from Wikimedia Commons. I preserved the downloaded renditions and used orientation-corrected 1280 × 960 center crops in the ZIPs. Equal aspect ratios let WorldMirror stack the photos in one input tensor. In the two-photo condition, the ZIP contains the same first two images used by the three-photo condition. The [source manifest](sources/manifest.json) records capture dates, source pages, authors, licenses, and local copies. [WorldMirror image preprocessing](https://github.com/Tencent-Hunyuan/HY-World-2.0/blob/main/hyworld2/worldrecon/hyworldmirror/utils/inference_utils.py)

### Café Central

Vienna, Austria · Café

The pastry display, columns, and pendant lamps link the views. Photo 2 is a very wide original, so the common crop cuts its margins. The photos span 2015, 2024, and 2017, which makes changing patrons, furnishings, and lighting a confound for this room.

| Photo | Role | Credit |
|---|---|---|
| [![Photo 1](sources/central/01-thumb.jpg)](sources/central/01.jpg) | Wide view down the aisle with columns, tiled floor, chairs and the pastry case. | GFHund · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) · [Commons file](https://commons.wikimedia.org/wiki/File:Cafe_Central_Wien_2015-i.JPG) |
| [![Photo 2](sources/central/02-thumb.jpg)](sources/central/02.jpg) | Cross-aisle view toward the pastry display and windows with shared columns and lamps. | Derbrauni · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) · [Commons file](https://commons.wikimedia.org/wiki/File:Caf%C3%A9_Central_Interior_01.jpg) |
| [![Photo 3](sources/central/03-thumb.jpg)](sources/central/03.jpg) | Additional seating and window bay near the case and columns. | O.Mustafin · [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) · [Commons file](https://commons.wikimedia.org/wiki/File:W00158.jpg) |

### Bouillon Chartier Grands Boulevards

Paris, France · Large dining hall

All three photos came from the same 2023 visit. The second view shifts across the tables, and the third adds a closer view of the far end with the skylight and mezzanine still visible.

| Photo | Role | Credit |
|---|---|---|
| [![Photo 1](sources/chartier/01-thumb.jpg)](sources/chartier/01.jpg) | Wide view of the hall down the central tables and aisle. | Benoît Prieur · [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) · [Commons file](https://commons.wikimedia.org/wiki/File:Vue_int%C3%A9rieure_de_Bouillon_Chartier_Grands_Boulevards_en_ao%C3%BBt_2023_(2).JPG) |
| [![Photo 2](sources/chartier/02-thumb.jpg)](sources/chartier/02.jpg) | View from the right of the central tables with the same globes, skylight and mezzanine. | Benoît Prieur · [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) · [Commons file](https://commons.wikimedia.org/wiki/File:Vue_int%C3%A9rieure_de_Bouillon_Chartier_Grands_Boulevards_en_ao%C3%BBt_2023.jpg) |
| [![Photo 3](sources/chartier/03-thumb.jpg)](sources/chartier/03.jpg) | Closer view of the glazed far end, globe lamps and mezzanine railing. | Benoît Prieur · [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) · [Commons file](https://commons.wikimedia.org/wiki/File:Une_vue_int%C3%A9rieure_de_Bouillon_Chartier_Grands_Boulevards_(ao%C3%BBt_2023).jpg) |

### McSorley's Old Ale House

New York, NY, USA · Compact pub

The photo series shares the same bar and framed displays. The third photo adds the window end of the counter. The low reference angle, patrons, and strong window glare make this a harder compact-room case.

| Photo | Role | Credit |
|---|---|---|
| [![Photo 1](sources/mcsorley/01-thumb.jpg)](sources/mcsorley/01.jpg) | Low, wide view showing furniture, sawdust floor, bar and framed wall. | Jazz Guy from New Jersey, United States · [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) · [Commons file](https://commons.wikimedia.org/wiki/File:New_York_City,_17_May_08_(2502397856).jpg) |
| [![Photo 2](sources/mcsorley/02-thumb.jpg)](sources/mcsorley/02.jpg) | More direct view of the bar from a different position, with its framed displays and hanging fixtures. | Jazz Guy from New Jersey, United States · [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) · [Commons file](https://commons.wikimedia.org/wiki/File:New_York_City,_17_May_08_(2501578589).jpg) |
| [![Photo 3](sources/mcsorley/03-thumb.jpg)](sources/mcsorley/03.jpg) | The bar's window-side end and its cabinetry, connecting through the counter and back-bar displays. | Jazz Guy from New Jersey, United States · [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) · [Commons file](https://commons.wikimedia.org/wiki/File:New_York_City,_17_May_08_(2501572821).jpg) |

## Method

- **Prediction.** The authenticated Replicate endpoint returned the schema for `kfarr/tencent-hy-world-2.0` version `9ed0decf15c57cb21d40db281aa5183fce38dd2a57c09c9ab14b1254f57a8feb`. The real input takes one `input_file` URI pointing to a ZIP of ordered photos. The resolution field is `target_size` with a default of 952. The single output URI points to a ZIP. I requested `gaussians.ply` and `camera_params.json` and disabled depth, normal, and point-cloud exports. The edge mask and sky mask stayed at their defaults. [Saved schema](outputs/model-schema.json) · [Cog wrapper](https://github.com/3DStreet/hy-world-2-replicate/blob/main/predict.py)
- **Billing and transport.** The runner submitted predictions one at a time, downloaded each result at completion, and applied the $6 cap to cumulative estimated spend. Costs use each attempt’s `metrics.predict_time × 0.000975` on an L40S. The first Café Central job cost $0.000391561 before rejecting a temporary input path with no ZIP extension. The successful attempts used the same photo bytes in a `data:application/zip` URI. The ledger retains the failed attempt. [L40S pricing](https://replicate.com/pricing) · [Replicate file inputs](https://replicate.com/docs/topics/predictions/input-files)
- **Measurement and compression.** SplatTransform 3.12.0 used CPU merge decimation and SOG compression. I checked each SOG count from its metadata and measured actual bytes. The ledger contains each PLY’s count, file bytes, XYZ bounds, opacity logit and sigmoid statistics, and exponentiated per-axis scale statistics in model units. The min, p05, median, p95, and max are available for opacity and scale. File sizes below use decimal MB. [SplatTransform documentation](https://developer.playcanvas.com/user-manual/splat-transform/)
- **Rendering.** All five views per job use the 100,000-Gaussian SOG. The photo 1 comparison uses the model’s predicted OpenCV pose and intrinsics with a centered lens. The four other views share a 62° vertical field of view. They sample standing and seated positions near photo 1 and forward toward the room centre, using nominal eye heights of 1.55 and 1.20 m. I estimated scale and centre from image geometry, with an assumed photo 1 eye height of 1.55 m for Café Central and Chartier and 1.10 m for McSorley’s. The sheets show approximate translation, and the poses JSON stores model units. The forward samples are roughly 1.5 m from photo 1 along its sightline. These are visual samples of motion and field of view, with physical scale and path clearance unverified. [WorldMirror camera convention](https://huggingface.co/tencent/HY-World-2.0/blob/main/DOCUMENTATION.md) · [SplatTransform rendering](https://developer.playcanvas.com/user-manual/splat-transform/image-rendering/)

## Measured job results

Raw count ranged from 219,581 to 1,273,391 Gaussians. All twelve 100k assets contained exactly 100,000 Gaussians and occupied 1.22 MB to 1.25 MB. The 250k-ceiling versions occupied 2.35 MB to 3.04 MB. McSorley’s 2-photo 518 PLY started below the higher ceiling and kept all 219,581 points in that version. Quest 3 frame time is unmeasured.

| Room | Photos | Target px | Active seconds | Inference cost | Raw Gaussians | 100k SOG | 250k-ceiling SOG | Contact sheet |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Café Central | 2 | 518 | 19.439¹ | $0.018953¹ | 311,946 | [1.23 MB](outputs/central-2p-518/room-100000.sog) | [2.85 MB](outputs/central-2p-518/room-250000.sog) | [View](outputs/central-2p-518/contact-sheet.png) |
| Café Central | 2 | 952 | 17.486 | $0.017049 | 813,695 | [1.24 MB](outputs/central-2p-952/room-100000.sog) | [3.02 MB](outputs/central-2p-952/room-250000.sog) | [View](outputs/central-2p-952/contact-sheet.png) |
| Café Central | 3 | 518 | 14.498 | $0.014135 | 477,579 | [1.25 MB](outputs/central-3p-518/room-100000.sog) | [2.96 MB](outputs/central-3p-518/room-250000.sog) | [View](outputs/central-3p-518/contact-sheet.png) |
| Café Central | 3 | 952 | 27.834 | $0.027139 | 1,273,391 | [1.25 MB](outputs/central-3p-952/room-100000.sog) | [3.03 MB](outputs/central-3p-952/room-250000.sog) | [View](outputs/central-3p-952/contact-sheet.png) |
| Bouillon Chartier | 2 | 518 | 10.700 | $0.010432 | 318,404 | [1.22 MB](outputs/chartier-2p-518/room-100000.sog) | [2.79 MB](outputs/chartier-2p-518/room-250000.sog) | [View](outputs/chartier-2p-518/contact-sheet.png) |
| Bouillon Chartier | 2 | 952 | 21.103 | $0.020575 | 876,842 | [1.23 MB](outputs/chartier-2p-952/room-100000.sog) | [2.98 MB](outputs/chartier-2p-952/room-250000.sog) | [View](outputs/chartier-2p-952/contact-sheet.png) |
| Bouillon Chartier | 3 | 518 | 13.252 | $0.012920 | 382,740 | [1.23 MB](outputs/chartier-3p-518/room-100000.sog) | [2.93 MB](outputs/chartier-3p-518/room-250000.sog) | [View](outputs/chartier-3p-518/contact-sheet.png) |
| Bouillon Chartier | 3 | 952 | 27.180 | $0.026501 | 782,783 | [1.24 MB](outputs/chartier-3p-952/room-100000.sog) | [3.04 MB](outputs/chartier-3p-952/room-250000.sog) | [View](outputs/chartier-3p-952/contact-sheet.png) |
| McSorley’s | 2 | 518 | 9.258 | $0.009027 | 219,581 | [1.22 MB](outputs/mcsorley-2p-518/room-100000.sog) | [2.35 MB](outputs/mcsorley-2p-518/room-250000.sog) | [View](outputs/mcsorley-2p-518/contact-sheet.png) |
| McSorley’s | 2 | 952 | 14.030 | $0.013679 | 397,989 | [1.23 MB](outputs/mcsorley-2p-952/room-100000.sog) | [2.97 MB](outputs/mcsorley-2p-952/room-250000.sog) | [View](outputs/mcsorley-2p-952/contact-sheet.png) |
| McSorley’s | 3 | 518 | 14.998 | $0.014623 | 358,141 | [1.23 MB](outputs/mcsorley-3p-518/room-100000.sog) | [2.93 MB](outputs/mcsorley-3p-518/room-250000.sog) | [View](outputs/mcsorley-3p-518/contact-sheet.png) |
| McSorley’s | 3 | 952 | 15.690 | $0.015298 | 641,607 | [1.23 MB](outputs/mcsorley-3p-952/room-100000.sog) | [3.02 MB](outputs/mcsorley-3p-952/room-250000.sog) | [View](outputs/mcsorley-3p-952/contact-sheet.png) |

¹ Includes the failed prediction and its successful retry. Raw and compressed stats describe the successful reconstruction.

## Evaluation rubric

Score each dimension from 1 to 5 after viewing the 100,000-Gaussian contact sheet. Use 1, 3, and 5 as anchors and 2 or 4 for intermediate results.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Recognizable room | Landmarks or room shape are lost | Main landmarks recognizable near photo 1 | Landmarks and room layout stay clear through the sampled views |
| Coherent furniture | Tables or chairs break into disconnected patches | Main pieces recognizable with some deformation | Tables, chairs and counters retain shape and placement |
| Holes and floaters | Large gaps or blobs dominate | Visible defects away from the main seating area | Defects are minor and peripheral |
| Usable movement | The view breaks on a small lateral shift | Near-photo seated and standing views hold | All sampled positions hold, including both views toward the centre |

A visual publishability pass requires recognition and furniture scores of at least 4, holes and movement scores of at least 3, and a coherent seated and standing pair toward the centre. A reviewer should cite the affected furniture or landmark and the specific view for each call. This screen judges the room as a constrained headset preview. Quest 3 frame time is unmeasured, with SOG bytes and Gaussian count serving as delivery proxies.

## Visual judgement

One reviewer scored the SOG sheets with configuration labels visible. All twelve matched at least part of the original scene. Furniture coherence never reached 4, and each forward seated and standing pair showed a major defect.

| Room and configuration | Recognizable | Furniture | Holes and floaters | Movement | Publishable | Render evidence |
|---|---:|---:|---:|---:|---|---|
| Café Central, 2p / 518 px | 4 | 3 | 2 | 2 | No | The vaults and column rows match at photo 1. Both near views cut off the floor and sides. Moving forward tears up the left café chairs and opens gaps around the right column. |
| Café Central, 2p / 952 px | 4 | 3 | 2 | 2 | No | The near views preserve more floor and chair detail. At both forward poses a tall void opens beside the right column, and the left seating stretches into smeared strips. |
| Café Central, 3p / 518 px | 4 | 3 | 2 | 2 | No | The third image adds fragments of lamps and seating outside the first view. A ghosted teal diner encroaches on the near seated view, and the floor and foreground chairs still break as the viewer moves forward. |
| Café Central, 3p / 952 px | 4 | 3 | 1 | 2 | No | The arches remain recognizable, but blurred glassware and a partial face intrude into the near views. The seated view loses much of its left side, and the forward pair still has column and chair gaps. |
| Bouillon Chartier, 2p / 518 px | 4 | 3 | 2 | 3 | No | The left mezzanine, globe lamps, and red tablecloths stay legible at both near poses. The forward views expose dark ceiling holes and stretch the central serving stand and cloth into a foreground obstruction. |
| Bouillon Chartier, 2p / 952 px | 4 | 3 | 2 | 3 | No | The mezzanine rail, pink tabletops and wall windows read clearly in the near pair. The ceiling still tears around the globes and a large blurred serving stand and cloth block the forward seated view. |
| Bouillon Chartier, 3p / 518 px | 4 | 3 | 2 | 3 | No | The added view recovers part of the skylight and the distant lamps. It also strengthens a distorted serving stand in the foreground, and large ceiling holes remain at the deeper poses. |
| Bouillon Chartier, 3p / 952 px | 4 | 3 | 2 | 3 | No | The skylight and layered globe rows have better continuity in the near pair. In the forward seated view, the serving stand and cloth smear across much of the left foreground, while broken ceiling patches remain visible. |
| McSorley’s, 2p / 518 px | 3 | 2 | 1 | 1 | No | The back-bar and chairs reconstruct at photo 1. The short seated shift exposes a black floor, detached chair pieces and separate image planes. Neither forward view holds the seating together. |
| McSorley’s, 2p / 952 px | 3 | 2 | 1 | 2 | No | More chair legs and sawdust texture survive the near seated view than at 518 px. The forward views still leave the chairs and bar as disconnected patches over a mostly empty floor. |
| McSorley’s, 3p / 518 px | 3 | 2 | 1 | 1 | No | The photo-1 viewpoint retains the wood bar and framed wall, but the added window-side photo does little to fill the sampled floor and seating. The short shift still reveals detached chairs, and the forward pair splits into islands of geometry. |
| McSorley’s, 3p / 952 px | 3 | 2 | 1 | 2 | No | The near seated pose has more floor texture, but the empty borders and disconnected chair legs remain. The forward seated view adds a large bright floater at lower right and leaves the bar visibly fragmented. |

## Cost per accepted location

For each configuration, I divided the sum of billable attempts by the number of distinct rooms that passed the gate. A zero denominator leaves this metric undefined. The attempt mean includes spending on rejects and indicates only the cost to try a room.

| Photos | Target px | Billable attempts | Spend | Spend per location tried | Locations accepted | Cost per accepted location | $0.25 target |
|---:|---:|---:|---:|---:|---:|---:|---|
| 2 | 518 | 4 | $0.038412 | $0.012804 | 0/3 | Undefined | Unproven |
| 2 | 952 | 3 | $0.051303 | $0.017101 | 0/3 | Undefined | Unproven |
| 3 | 518 | 3 | $0.041679 | $0.013893 | 0/3 | Undefined | Unproven |
| 3 | 952 | 3 | $0.068937 | $0.022979 | 0/3 | Undefined | Unproven |

### Paired comparisons

- **952 px raised cost and left the pass rate at zero.** Across six paired jobs at each resolution, 952 px cost $0.12024 versus $0.08009 for 518 px, a 50% increase including the failed attempt. It produced 1.79× to 2.75× as many raw Gaussians in the matched pairs. After decimation, some near poses gained detail, especially the floor and chair legs at McSorley’s. The forward views retained the major holes and furniture failures, so the increase rescued 0 of 6 pairs.
- **Photo 3 rescued 0 of 6 pairs.** The three-photo jobs cost $0.11062 versus $0.08971 for two photos, a 23% increase including the failed attempt. The extra view contributed distant skylight detail at Chartier. It also supplied new foreground artifacts, especially the partial face and blurred glassware in the Café Central 3p/952 near views and a bright lower-right floater in the McSorley’s 3p/952 forward seated view.

## Free single-photo baseline

Depth Anything V2 Small ran locally on Apple MPS, using photo 1 only for depth and texture. Each textured GLB uses a 320 × 240 vertex grid and omits triangles crossing steep depth changes. I transferred the five camera views from each room’s 2p/518 run into the photo-1 camera frame for comparison. The model’s relative depth and approximate metre estimates make this a perceptual comparison. Khronos glTF Validator reported zero errors and zero warnings on all three GLBs. [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf)

| Room | Triangles | GLB size | Renders | Visual comparison with 2p/518 |
|---|---:|---:|---|---|
| Café Central | 141,886 | [3.74 MB](outputs/baseline/central/room.glb) | [View](outputs/baseline/central/contact-sheet.png) | The photo texture is sharper at the reference, then large black cutouts open around the columns and lamps. The splat has softer edges and preserves some additional geometry, with serious gaps in movement. |
| Bouillon Chartier | 143,994 | [3.83 MB](outputs/baseline/chartier/room.glb) | [View](outputs/baseline/chartier/contact-sheet.png) | The mesh keeps sharp lamp and mezzanine textures near the reference. The forward views expose black silhouettes around the globes and central serving stand. The splat adds some depth behind the stand with a large foreground smear. |
| McSorley’s | 145,867 | [3.90 MB](outputs/baseline/mcsorley/room.glb) | [View](outputs/baseline/mcsorley/contact-sheet.png) | The reference view keeps the chairs and tables legible. In all moved views the foreground tabletop separates from the room like a cutout. The splat picks up part of the bar from photo 2 and still fragments the floor and furniture. |

## Open risks

- Three conveniently sourced rooms and one review pass limit what the acceptance rate says about a larger program. Café Central’s inputs span years. Crowds, camera position, lighting, and glare vary across the photo sets.
- The near poses use a wider field of view than some source views, so edge gaps reflect both coverage and translation. The forward poses are approximate. Quest 3 comfort, frame time, loading behavior, and collision remain unmeasured on device.
- Source image attribution applies to public use. Tencent’s community license also places territorial restrictions on use, distribution, and display of outputs, including exclusions for the EU, UK, and South Korea. Review the deployment footprint against the terms before publishing. [Tencent license](https://github.com/Tencent-Hunyuan/HY-World-2.0/blob/main/License.txt)

## Reproduce

From this directory, use Python with NumPy and Pillow, Node with npx, and a WebGPU-capable local renderer. The baseline also uses Torch, Transformers, and Numba. The photos, billable ledger, and results are saved.

```sh
python3 run.py --schema
PYTHONDONTWRITEBYTECODE=1 python3 run.py --retry-failed
PYTHONDONTWRITEBYTECODE=1 python3 evaluate.py --with-250k
HF_HOME="$PWD/outputs/baseline/hf" XDG_CACHE_HOME="$PWD/outputs/baseline/cache" PYTHONDONTWRITEBYTECODE=1 PYTORCH_ENABLE_MPS_FALLBACK=1 outputs/baseline/venv/bin/python baseline.py
```

The runner skips configurations with a successful attempt in the ledger. The reported visual judgements were entered after reviewing each sheet.
