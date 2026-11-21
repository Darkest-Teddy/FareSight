# Which provider should generate a FareSight menu?

**Use SAM 3D Objects on fal by default.** After one targeted retry where needed, SAM delivered six featured-ready dishes for an estimated $0.22. Idol also delivered six and cost $1.20. They failed on different foods. Idol recovered the burger and tiramisu that SAM missed, including the fries beside the burger and the layers inside the slice. For a featured dish that fails SAM review, those differences justify trying Idol. Keep the pinned TRELLIS integration as a low-cost comparison baseline.

**Recorded generation cost was $1.563793 against a $4.00 cap.** There were 24 initial paid-endpoint jobs and 13 corrective jobs, yielding 36 splats. One SAM sushi job returned HTTP 422. Eleven earlier submission rejections produced no job ID. A separate public-Space ramen cost $0 and is excluded from every paid rate and projection. The inference key could read request records and prices but lacked access to the fal billing ledger. The SAM portion is therefore an estimate.

## Paid results

Each cell shows the featured-dish verdict for the original photo and, where used, the corrected input. The dollar amount covers both attempts. A 422 means the service returned no splat. Each linked sheet puts the source beside six views from each selected 60k delivery file, followed by the same front view at 30k.

| Dish and contact sheet | SAM 3D Objects | Idol | TRELLIS |
| --- | --- | --- | --- |
| [Shoyu ramen](outputs/contact-sheets/ramen.png) | yes · $0.0200 | yes · $0.1000 | yes · $0.0144 |
| [Katsu curry](outputs/contact-sheets/curry.png) | yes · $0.0200 | no → no · $0.2000 | no → no · $0.0201 |
| [Tiramisu](outputs/contact-sheets/tiramisu.png) | no → no · $0.0400 | no → yes · $0.2000 | no → yes · $0.0206 |
| [Burger and fries](outputs/contact-sheets/burger.png) | no → no · $0.0400 | yes · $0.1000 | no → no · $0.0201 |
| [Old fashioned](outputs/contact-sheets/cocktail.png) | no → yes · $0.0400 | yes · $0.1000 | yes · $0.0181 |
| [Margherita pizza](outputs/contact-sheets/pizza.png) | yes · $0.0200 | no → yes · $0.2000 | no → yes · $0.0174 |
| [Salmon sushi platter](outputs/contact-sheets/sushi.png) | 422 → yes · $0.0200 | no → no · $0.2000 | no → no · $0.0204 |
| [Greek salad](outputs/contact-sheets/salad.png) | yes · $0.0200 | yes · $0.1000 | yes · $0.0126 |

| Provider | Jobs | Accepted on first run | Accepted after retries | Cost of all attempts | Cost / menu item | Cost / accepted dish |
| --- | --- | --- | --- | --- | --- | --- |
| SAM 3D Objects | 12 | 4/8 | 6/8 (75%) | $0.2200 | $0.0275 | $0.0367 |
| Idol | 12 | 4/8 | 6/8 (75%) | $1.2000 | $0.1500 | $0.2000 |
| TRELLIS | 13 | 3/8 | 5/8 (62.5%) | $0.1438 | $0.0180 | $0.0288 |

One new accepted dish in an eight-dish set moves the rate 12.5 percentage points. The lowest cost per accepted dish belonged to TRELLIS. SAM's additional cost was about $0.008 per accepted dish, and it handled both the curry plate and the sushi platter. The acceptance totals alone hide that difference.

## What each provider got right

- **SAM** preserved the curry plate and the arrangement of cutlet, rice and sauce on the original input. It also kept pizza toppings inside the crust on a continuous plate. Its text selection produced fries alone for the burger, an empty plate for tiramisu, and a glass without its peel. A hand mask restored the cocktail garnish and recovered the sushi platter after the initial 422. Even with a mask, SAM flattened the tiramisu to cocoa dust and merged the burger fries into a yellow sheet.
- **Idol** kept the individual fries and burger layers on the first run. It preserved the orange peel and the ice in the glass, though some highlights repeated around the back. It initially removed the dessert plate and left fragments of the pizza plate. Masked retries restored both. The katsu had little rice volume and a dark gap behind the cutlet. The sushi platter folded at the edges and the nigiri lost distinct rice bases.
- **TRELLIS** produced an intact ramen bowl, cocktail and salad on the first pass. A full-serving alpha mask recovered the pizza plate and the cocoa-dusted dessert plate. It still extruded the curry plate into a maroon wall, split the sushi platter into upright pieces at the rear and fused the fries into sheets. Its time-based pricing was particularly favorable for masked retries.

The burger is a clear reason to pay for Idol on a popular item. The tiramisu shows where the existing TRELLIS baseline can also supply an acceptable, cheaper rescue. For a plated dish SAM already captures, these eight comparisons give little reason for a blanket Idol upgrade. One generation of a featured item at each of 1,000 restaurants would cost $100 with Idol, about $80 more than 1,000 successful single-object SAM generations or $86.80 more than TRELLIS at its observed first-run mean. With this sample's retry frequency, replacing SAM with Idol for one item per location would add about $122.50 per 1,000 locations.

## Menu economics

These projections replay the eight paired outcomes and recorded costs. Each restaurant supplies either 30 menu items or three popular items with the same mix. Fractions indicate an expected count across many restaurants. Prices cover generation. Restaurant review, tracing masks, leveling and hosting add costs outside this table. A restaurant whose three bestsellers are all stacked sandwiches could see very different acceptance.

| Policy | Items / restaurant | Expected accepted / restaurant | 1 restaurant | 100 restaurants | 1,000 restaurants | Cost / accepted |
| --- | --- | --- | --- | --- | --- | --- |
| SAM 3D Objects | 30 | 22.5 | $0.83 | $82.50 | $825.00 | $0.0367 |
| SAM 3D Objects | 3 | 2.25 | $0.08 | $8.25 | $82.50 | $0.0367 |
| Idol | 30 | 22.5 | $4.50 | $450.00 | $4,500.00 | $0.2000 |
| Idol | 3 | 2.25 | $0.45 | $45.00 | $450.00 | $0.2000 |
| TRELLIS | 30 | 18.75 | $0.54 | $53.92 | $539.22 | $0.0288 |
| TRELLIS | 3 | 1.875 | $0.05 | $5.39 | $53.92 | $0.0288 |
| SAM, then Idol on failures | 30 | 30 | $1.95 | $195.00 | $1,950.00 | $0.0650 |
| SAM, then Idol on failures | 3 | 3 | $0.20 | $19.50 | $195.00 | $0.0650 |
| SAM, then Idol on failures · one attempt per provider | 30 | 22.5 | $2.03 | $202.50 | $2,025.00 | $0.0900 |
| SAM, then Idol on failures · one attempt per provider | 3 | 2.25 | $0.20 | $20.25 | $202.50 | $0.0900 |

In the bounded-retry mix, SAM failed on **2 of 8** after correction. Idol accepted the burger on its first attempt and the dessert on its second. Serving all eight this way would have cost $0.22 for SAM plus $0.30 for those three Idol generations, or **$0.52 for eight accepted**. The single-attempt comparison routes **4 of 8** first-pass SAM failures to Idol. It recovers the burger and drink, leaving six accepted at $0.54. These projections use each fallback dish's observed Idol result, so success on easier dishes never substitutes for success on the hard ones.

## Inputs and method

One downloaded Commons JPEG per dish went to each endpoint unchanged on the first attempt. The nominal widths below are assumptions for placement on a table. The photo alone does not establish the real portion size. The burger width covers the burger and side of fries on their original surface. The glass width is its diameter. Attribution, original dimensions, download URLs and checksums are in the [source manifest](sources/manifest.json).

| Subject | Nominal width | Elevation | Credit | License |
| --- | --- | --- | --- | --- |
| [Shoyu ramen](https://commons.wikimedia.org/wiki/File:Shoyu_Ramen%EF%BC%88Tokyo_Ramen%EF%BC%89_-_01.jpg) | 24 cm | 65° | Quercus acuta | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [Katsu curry](https://commons.wikimedia.org/wiki/File:Katsu-curry_002.jpg) | 26 cm | 58° | Ocdp | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Tiramisu](https://commons.wikimedia.org/wiki/File:Tiramisu_-_Raffaele_Diomede.jpg) | 18 cm | 30° | Raffaele Diomede from Pordenone, ITALIA | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| [Burger and fries](https://commons.wikimedia.org/wiki/File:RedDot_Burger.jpg) | 15 cm | 15° | Hongreddotbrewhouse | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| [Old fashioned](https://commons.wikimedia.org/wiki/File:Whiskey_Old_Fashioned1.jpg) | 8.5 cm | 14° | Erich Wagner (www.eventografie.de) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [Margherita pizza](https://commons.wikimedia.org/wiki/File:PizzaMargarita.jpg) | 30 cm | 45° | 食道楽 | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) |
| [Salmon sushi platter](https://commons.wikimedia.org/wiki/File:Salmon_Sushi_and_Sashimi_Platter_-_W_Sushi.jpg) | 26 cm | 26° | Angelicadlr | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| [Greek salad](https://commons.wikimedia.org/wiki/File:Greek_salad.jpg) | 24 cm | 37° | pastitio | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |

The ramen and curry photos look further down onto the food than the burger and glass photos. Parts of several plates extend beyond their frames. A complete rear surface, a clipped plate edge and the actual serving height are therefore plausibility judgments. The optional multi-image run was skipped because no verified second view of the same serving was available.

**Generation.** SAM received an explicit dish prompt on every request and returned `gaussian_splat.url`. Idol used `image_type=real` and returned its PLY in `model_mesh.url`. TRELLIS used FareSight's pinned version `e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`, with Gaussian PLY enabled and mesh/color/normal exports disabled. We downloaded the returned files after each job. Idol supplied a preprocessed subject image and TRELLIS a background-removed preview. SAM used its automatic text segmentation initially. Corrective inputs added a full-serving mask for SAM or an alpha channel for Idol and TRELLIS, preserving JPEG-derived RGB values and framing. The fal seed changed from 42 to 43 on a retry, so a recovered output cannot be attributed solely to the mask. The two fal endpoints ran serially. [SAM schema](https://fal.ai/models/fal-ai/sam-3/3d-objects/api) · [Idol schema](https://fal.ai/models/speridlabs/idol/api) · [TRELLIS deployment](https://replicate.com/firtoz/trellis) · [Schema snapshots](outputs/provider-schemas.json)

**Table placement.** Each PLY was inspected in orbit. All 11 successful SAM outputs needed level correction from their camera pose. We used its pose metadata, a fitted rim or visible support, or an inspected axis correction. Three masked Idol outputs needed rim leveling. The other nine Idol outputs and all 13 TRELLIS outputs used native axes. Camera yaw was chosen separately to match the photograph. For a missing or broken vessel, the recorded scale applies to the surviving geometry. Rotating a warped plate cannot make it flat.

**Scale and ground.** The delivery files use the largest visible horizontal span between the 0.1st and 99.9th percentiles of Gaussian centers with opacity above 0.10. We scale that span to the nominal width, center its midpoint on X/Z, and set its robust bottom on the table plane. We scale Gaussian axis lengths with their positions. Each ledger entry also gives the raw and decoded 5th–95th percentile span and the exact multiplier for FareSight's existing 5th–95th scale convention. Use unit scale for the supplied meter-sized SOG, or the recorded tier multiplier if matching that app convention. Transparent outliers can sit below the robust floor. For the Idol dessert retry the lowest decoded center is 6.35 cm below the plane, while every raw center above the opacity cutoff is within 0.75 mm of the plane or above it.

**Compression and review.** `npx -y @playcanvas/splat-transform@3.12.0` decimated each normalized file to 30,000 and 60,000 Gaussians, then wrote positive-Y-up SOG v3. We decoded both tiers to check count, dimensions and bounds. A native PlayCanvas renderer produced 512 × 512 views from the 60k SOG at the photographed angle, a low side angle, overhead, the back and ±30° around the front. Each output also has an uncompressed front and a 30k front. The 72 delivery files range from 0.372 to 0.416 MB at 30k and 0.727 to 0.800 MB at 60k. Local renders verify appearance at these tiers; Quest 3 stereo, frame timing and placement in the running headset app remain unmeasured. [PlayCanvas SplatTransform](https://github.com/playcanvas/splat-transform)

## How the costs were determined

- **SAM.** The pricing API lists $0.02 per unit. Each successful response contained one object metadata entry and one merged splat, with no billable-unit header or dollar amount. Eleven one-object outputs account for $0.22. The sushi 422 had no output or billing field and contributes $0 to the estimate. A one-unit charge for it would add $0.02, bringing the experiment to $1.584 and SAM to $0.0400 per accepted dish. [Observed price response and billing access](outputs/pricing-check.json) · [fal model pricing](https://fal.ai/docs/documentation/model-apis/pricing)
- **Idol.** Every completed request returned `x-fal-billable-units: 1` at the published $0.10/generation. Twelve generations account for $1.20. The queue status and result billing fields for each fal request are preserved with its ID. [Request evidence](results.json)
- **TRELLIS.** Replicate reported execution seconds and no dollar charge in the prediction response. Multiplying each `metrics.predict_time` by $0.0014/s for the A100 80 GB gives $0.143793 for 13 predictions. The frequently quoted $0.038 is the deployment's typical run, which was higher than these runs. [Deployment hardware](https://replicate.com/firtoz/trellis) · [Replicate hardware rates](https://replicate.com/pricing)

The seven earlier fal model-submission 403s have UTC timestamps in the ledger. The first Idol 403 at 16:46:35 UTC has a missing response body because the original logging path discarded it. Later captured bodies report exhausted balance. Historical timestamps come from the archived command result where exact receipt time was unavailable. The separate read-only usage and billing-events 403 responses reflect the API key's permissions. No generation was billed for either lookup.

## Visual scores by attempt

A, V, H, R and C stand for arrangement and toppings, vessel or complete serving, height, cleanliness during rotation, and recognizability after compression. Five means a close match or clean result; one means the defining feature is absent or badly broken. We judged featured readiness on the complete serving in motion. A sharp front alone could not compensate for a missing slice or a plate that broke apart around the back. On the burger, the fries beside the stack are part of the serving. The final sheet shows the accepted attempt when available, otherwise the latest successful attempt.

| Dish | Provider | # | Accepted | A / V / H / R / C | Evidence |
| --- | --- | --- | --- | --- | --- |
| Shoyu ramen | SAM 3D Objects | 1 | yes | 4 / 5 / 3 / 4 / 5 | Rim and foot are complete. Pork, fish cake, bamboo and noodles remain in the photographed arrangement, although broth and toppings look smoother. Once leveled, the bowl is plausible but shallow and the rear exterior is matte. Six views and the 30k front retain the serving. |
| Shoyu ramen | Idol | 1 | yes | 5 / 5 / 5 / 4 / 5 | Two pork slices, scallions, bamboo and the spiral fish cake occupy the correct quadrants. The round rim, foot and bowl depth survive rotation. A blue patch appears on the unseen exterior. The same toppings read at 30k. |
| Shoyu ramen | TRELLIS | 1 | yes | 5 / 5 / 4 / 4 / 5 | Pork, fish cake, scallions and bamboo occupy the photographed quadrants. The patterned rim closes; the side and back show a complete bowl with a very dark exterior. Broth and noodles remain readable at 30k. |
| Katsu curry | SAM 3D Objects | 1 | yes | 4 / 5 / 3 / 4 / 5 | The cutlet sits at the back, with rice along its front edge and the sauce pooled toward the viewer. The cuts remain visible, though the breading looks smooth and the rice forms clumps. The side and rear show a complete shallow plate with a foot. The cutlet still reads at 30k. |
| Katsu curry | Idol | 1 | no | 4 / 2 / 2 / 1 / 4 | The cutlet, rice and sauce are identifiable, but the plate is cut off on one side with a vertical gray wall. The side view exposes a folded shape and the back appears like a paper cutout. Both SOG tiers show the same defect. |
| Katsu curry | Idol | 2 | no | 4 / 3 / 2 / 2 / 5 | The cutlet slices and sauce read clearly at both tiers, and the mask restores the white rim and logo. The plate ends in a straight chord at the viewer, the side shows little rice volume, and a dark gap opens under the cutlet at the back. |
| Katsu curry | TRELLIS | 1 | no | 4 / 1 / 2 / 2 / 4 | Rice, cutlet and sauce stay in their photographed regions. The source’s wide white plate disappears; the side exposes a thin sauce sheet and an extruded cutlet wall. Compression preserves the faulty silhouette. |
| Katsu curry | TRELLIS | 2 | no | 4 / 3 / 3 / 2 / 4 | The retry restores the wide white rim and its logo, with the cutlet behind the sauce as in the photo. The slices merge into a low mound and the rice forms a narrow band. The plate reads from the photo angle and both 30-degree turns, but the side and back expose a thick, uneven dark maroon wall around it. The 30k front retains the cutlet, rice and plate. |
| Tiramisu | SAM 3D Objects | 1 | no | 1 / 5 / 1 / 5 / 1 | The selection contains only the white plate. Its shallow rim closes cleanly in the side, top and rear views. The cake, its height, layers and cocoa topping are absent from the raw splat and both delivery tiers. |
| Tiramisu | SAM 3D Objects | 2 | no | 1 / 5 / 1 / 5 / 1 | The mask recovers brown cocoa dust across the plate. Neither the raw front nor the 60k side shows a raised slice. The plate remains intact through rotation, but there is no cake to identify at either tier. |
| Tiramisu | Idol | 1 | no | 5 / 1 / 4 / 4 / 5 | The cocoa, sponge and cream layers are distinct at 30k and the cake has believable depth around the back. The entire white plate and its scattered cocoa dust are absent. |
| Tiramisu | Idol | 2 | yes | 5 / 3 / 4 / 4 / 5 | The mask restores cocoa dust on the white plate. The slice retains the cocoa cap and alternating cream and soaked cake layers in the side and back views, including at 30k. The plate closes, although its clipped sides make it look polygonal. |
| Tiramisu | TRELLIS | 1 | no | 4 / 1 / 4 / 3 / 5 | The cocoa top and exposed layers survive at both tiers and the slice has credible height. The white plate and cocoa dust are missing; under rotation the bottom edge looks chewed away. |
| Tiramisu | TRELLIS | 2 | yes | 5 / 4 / 4 / 3 / 5 | The dark front face, lighter side layers, cocoa top and dust on the plate match the source view. The cake keeps its height and distinct cream and sponge bands through both 30-degree turns and from behind. The white plate surrounds the slice, although its rim looks wavy and has a notch at the back. The 30k front preserves the layers and the cocoa dust. |
| Burger and fries | SAM 3D Objects | 1 | no | 1 / 2 / 1 / 4 / 1 | Only a small pile of fries is present in the raw and compressed views. The fries retain some individual contours through rotation, but the bun, patty, vegetables and entire height of the burger are missing. No separate plate is evident in the photo. |
| Burger and fries | SAM 3D Objects | 2 | no | 3 / 2 / 4 / 2 / 4 | The mask recovers the seeded bun, patty, lettuce and the side order. The tomato is thick and bulbous, and the fries merge into a folded yellow sheet from the side and at +30°. Both tiers retain that shape. No separate plate appears in the photo, so serving completeness includes the fries. The comparison with Idol's separate fries and TRELLIS's fused fries puts this below the featured-dish threshold. |
| Burger and fries | Idol | 1 | yes | 5 / 5 / 4 / 4 / 5 | The seeded bun, onion, patties, tomato and lettuce remain stacked, and separate fries sit at the right as in the photograph. The back is simplified, but the ±30° views retain the stack and side. No plate is evident in the source. Both tiers read clearly. |
| Burger and fries | TRELLIS | 1 | no | 3 / 3 / 4 / 2 / 4 | The bun and leafy stack retain their height. Two oversized tomato lobes replace thinner slices and the right-hand fries turn into a fused pale clump in the side and +30° views. No distinct plate is visible in the source; serving completeness is judged on the fries. The bun remains legible at 30k. |
| Burger and fries | TRELLIS | 2 | no | 4 / 2 / 4 / 2 / 4 | At the photo angle, the sesame bun, patty, tomato and lettuce form a stack of plausible height with the fries on the right. With no plate visible in the photo, serving completeness is judged on the fries: the few distinct sticks become a broad folded mass, and from the side and back they stretch into thin pointed sheets under the burger. The +30-degree view already shows this distortion. The 30k and 60k fronts preserve the same recognizable burger and malformed fries. |
| Old fashioned | SAM 3D Objects | 1 | no | 2 / 5 / 4 / 3 / 3 | The full tumbler, dark foot, amber liquid and pale ice are present, but the orange peel above the rim is missing even in the raw front. The sides repeat the ice around the facets of the glass. Both tiers read as a drink and omit its identifying garnish. |
| Old fashioned | SAM 3D Objects | 2 | yes | 4 / 5 / 5 / 3 / 5 | The peel rises above the rim to the right of the ice sphere as in the photo. Both tiers keep the glass foot, ice, liquid line and garnish. The side repeats the pale ice across glass facets and the ice grows grainier at 30k. The drink remains identifiable through the modest turns. |
| Old fashioned | Idol | 1 | yes | 5 / 5 / 5 / 3 / 5 | The bright sphere, amber liquid, peel and clear rim match the frontal photograph, with enough height to read as a heavy tumbler. Baked highlights and angular glass distort on the side, and the opposite side repeats the ice motif. The modest rotations and 30k front remain convincing. |
| Old fashioned | TRELLIS | 1 | yes | 4 / 5 / 5 / 4 / 5 | The peel, ice sphere and amber liquid sit inside a complete tumbler with a credible foot. The back and modest turns preserve the rim; the thick base carries angular baked reflections. The orange peel and silhouette survive 30k. |
| Margherita pizza | SAM 3D Objects | 1 | yes | 4 / 5 / 4 / 4 / 5 | The browned crust surrounds white mozzarella and dark basil on red sauce. At the center the toppings merge into a tan patch. From the side the dough rises above a continuous shallow plate. The back and modest rotations retain that outline, and the toppings are recognizable at both tiers. |
| Margherita pizza | Idol | 1 | no | 5 / 2 / 3 / 2 / 5 | The mozzarella and basil arrangement matches at both tiers. Only strips of the white/blue plate remain. The side and rear show a detached strip beneath the crust. |
| Margherita pizza | Idol | 2 | yes | 5 / 3 / 4 / 3 / 5 | Basil leaves, cheese islands and raised blistered crust stay in place at 30k and 60k. With the rim leveled, the side profile supports the pizza and the plate stays continuous through both turns. The angular blue-purple outer lip is especially visible at the rear. |
| Margherita pizza | TRELLIS | 1 | no | 4 / 1 / 3 / 3 / 5 | Mozzarella islands, basil and browned rim survive both tiers. The white plate disappears. The side is very flat; the underside diagnostic repeats the colored topping pattern. |
| Margherita pizza | TRELLIS | 2 | yes | 4 / 4 / 4 / 3 / 5 | The white plate now surrounds the browned crust. The mozzarella patches, basil clusters and red sauce follow the photo, although individual leaves blur. The raised rim is visible in profile, and the pizza and plate hold together at both 30-degree turns and from the back. The low side view exposes black tabs beneath the plate; the underside diagnostic repeats the toppings. The 30k front retains the crust, cheese and basil. |
| Salmon sushi platter | SAM 3D Objects | 1 | 422 | — | No masks returned for the explicit sushi-platter prompt. No splat to score. |
| Salmon sushi platter | SAM 3D Objects | 2 | yes | 4 / 4 / 4 / 3 / 4 | The front retains salmon over white rice, taller salmon at the back, green garnish and the white platter. Individual nigiri boundaries are softer than the photo, especially in the top and rear views, and the plate corners look angular. The two rows and height difference still read at both tiers. |
| Salmon sushi platter | Idol | 1 | no | 4 / 1 / 4 / 2 / 4 | The photo angle retains the front rows of nigiri, rear salmon and green garnish. The white platter is entirely gone. The rear garnish turns into a ragged beige mass, and reduced detail does not restore missing rice or plate. |
| Salmon sushi platter | Idol | 2 | no | 4 / 2 / 2 / 2 / 4 | The near row of bright salmon and the pile behind survive compression, but the grains and rice bases blur into low orange mounds. The mask recovers a flat cream-colored support; angular folded corners, a central break and cutout garnish are exposed from the back. |
| Salmon sushi platter | TRELLIS | 1 | no | 3 / 1 / 3 / 2 / 3 | The front retains rows of orange nigiri and taller rear pieces. Most rice, garnish and the white platter are lost. A black patch and merged salmon shapes appear around the back; the reduced version reads as sushi mainly from the front. |
| Salmon sushi platter | TRELLIS | 2 | no | 4 / 2 / 3 / 2 / 4 | The retry restores rice beneath the front nigiri, the taller salmon pieces behind them and part of the pale platter. The 30k front and both modest turns still read as a sushi assortment. From the side and back, the rear platter breaks into upright panels with dark loops and stretched green garnish. The back edge disappears across the middle, exposing a gap below the fish. |
| Greek salad | SAM 3D Objects | 1 | yes | 4 / 5 / 3 / 4 / 4 | The herb-speckled feta lies diagonally over the tomato and pale onion as in the photo. The rim closes around the whole serving. The low side shows little separation between the feta and the vegetables, and some ingredients blend into dark patches at the back. The feta remains distinct at 30k. |
| Greek salad | Idol | 1 | yes | 5 / 4 / 4 / 4 / 5 | Feta, onion curls and tomatoes retain their photographed positions. The bowl remains present from top, side and rear, with a slightly uneven edge. The low side shows the cheese rising above the vegetables. Both delivery tiers keep ingredient boundaries. |
| Greek salad | TRELLIS | 1 | yes | 4 / 5 / 4 / 4 / 5 | Feta sits above red tomato, onions and greens in a bowl with a continuous rim. Height and layering hold from the side. The rear ingredients soften into brown patches; the feta and vegetables remain identifiable at 30k. |

## Measurements by attempt

MB use decimal bytes. Level corrections are in world-space degrees. Runtime is endpoint-reported inference time for SAM and Idol or prediction execution time for TRELLIS; queue and download time are excluded. The ledger retains full XYZ bounds, exact byte counts and scales, including decoded measurements for each tier. [Attempt ledger](results.json)

| Dish | Provider | # | Runtime s | Cost USD | Raw Gaussians | PLY MB | 30k MB | 60k MB | Level XYZ ° | Photo yaw ° |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shoyu ramen | SAM 3D Objects | 1 | 27.61 | $0.02000 | 472,640 | 32.14 | 0.384 | 0.750 | 116.08, 0, -1.21 | 179 |
| Shoyu ramen | Idol | 1 | 5.75 | $0.10000 | 262,144 | 17.83 | 0.391 | 0.756 | native | 279 |
| Shoyu ramen | TRELLIS | 1 | 10.28 | $0.01439 | 500,672 | 34.05 | 0.387 | 0.765 | native | 343 |
| Katsu curry | SAM 3D Objects | 1 | 20.07 | $0.02000 | 468,544 | 31.86 | 0.372 | 0.727 | 120.45, 0, -1.19 | 0 |
| Katsu curry | Idol | 1 | 5.73 | $0.10000 | 262,144 | 17.83 | 0.389 | 0.757 | native | 255 |
| Katsu curry | Idol | 2 | 5.75 | $0.10000 | 262,144 | 17.83 | 0.385 | 0.747 | native | 267 |
| Katsu curry | TRELLIS | 1 | 8.96 | $0.01254 | 192,768 | 13.11 | 0.390 | 0.739 | native | 180 |
| Katsu curry | TRELLIS | 2 | 5.43 | $0.00760 | 271,584 | 18.47 | 0.389 | 0.760 | native | 90 |
| Tiramisu | SAM 3D Objects | 1 | 12.16 | $0.02000 | 268,096 | 18.23 | 0.373 | 0.732 | 150.77, 0, 0.27 | 0 |
| Tiramisu | SAM 3D Objects | 2 | 16.68 | $0.02000 | 261,088 | 17.75 | 0.374 | 0.735 | 153.71, 0, -0.33 | 0 |
| Tiramisu | Idol | 1 | 5.65 | $0.10000 | 262,144 | 17.83 | 0.389 | 0.762 | native | 251 |
| Tiramisu | Idol | 2 | 5.72 | $0.10000 | 262,144 | 17.83 | 0.375 | 0.734 | -3.53, 0, -5.83 | 305 |
| Tiramisu | TRELLIS | 1 | 9.21 | $0.01290 | 406,528 | 27.64 | 0.381 | 0.744 | native | 32 |
| Tiramisu | TRELLIS | 2 | 5.53 | $0.00774 | 270,816 | 18.42 | 0.379 | 0.738 | native | 196 |
| Burger and fries | SAM 3D Objects | 1 | 16.95 | $0.02000 | 371,200 | 25.24 | 0.396 | 0.781 | 130.02, 0, 6.76 | 135 |
| Burger and fries | SAM 3D Objects | 2 | 21.43 | $0.02000 | 746,240 | 50.74 | 0.391 | 0.758 | 158.48, 0, 6.29 | 21 |
| Burger and fries | Idol | 1 | 5.75 | $0.10000 | 262,144 | 17.83 | 0.399 | 0.766 | native | 266 |
| Burger and fries | TRELLIS | 1 | 8.78 | $0.01229 | 400,864 | 27.26 | 0.391 | 0.766 | native | 185 |
| Burger and fries | TRELLIS | 2 | 5.56 | $0.00778 | 414,304 | 28.17 | 0.388 | 0.758 | native | 292 |
| Old fashioned | SAM 3D Objects | 1 | 47.76 | $0.02000 | 1,238,624 | 84.23 | 0.406 | 0.795 | 168.25, 0, -1 | 148 |
| Old fashioned | SAM 3D Objects | 2 | 26.91 | $0.02000 | 1,003,200 | 68.22 | 0.406 | 0.793 | 165.92, 0, 1.17 | 12 |
| Old fashioned | Idol | 1 | 5.63 | $0.10000 | 262,144 | 17.83 | 0.416 | 0.798 | native | 276 |
| Old fashioned | TRELLIS | 1 | 12.96 | $0.01815 | 878,464 | 59.74 | 0.413 | 0.800 | native | 30 |
| Margherita pizza | SAM 3D Objects | 1 | 13.61 | $0.02000 | 429,664 | 29.22 | 0.377 | 0.750 | 146.11, 0, -14.23 | 325 |
| Margherita pizza | Idol | 1 | 5.75 | $0.10000 | 262,144 | 17.83 | 0.391 | 0.761 | native | 243 |
| Margherita pizza | Idol | 2 | 5.74 | $0.10000 | 262,144 | 17.83 | 0.391 | 0.760 | 7.53, 0, 3.39 | 243 |
| Margherita pizza | TRELLIS | 1 | 7.41 | $0.01037 | 156,416 | 10.64 | 0.390 | 0.760 | native | 116 |
| Margherita pizza | TRELLIS | 2 | 5.06 | $0.00708 | 186,720 | 12.70 | 0.387 | 0.756 | native | 121 |
| Salmon sushi platter | SAM 3D Objects | 1 | 0.66 | $0.00000 | — | — | — | — | — | — |
| Salmon sushi platter | SAM 3D Objects | 2 | 23.85 | $0.02000 | 650,688 | 44.25 | 0.388 | 0.752 | 155.2, 0, -1.17 | 345 |
| Salmon sushi platter | Idol | 1 | 5.76 | $0.10000 | 262,144 | 17.83 | 0.384 | 0.748 | native | 236 |
| Salmon sushi platter | Idol | 2 | 5.75 | $0.10000 | 262,144 | 17.83 | 0.377 | 0.734 | 0.11, 0, -7.82 | 249 |
| Salmon sushi platter | TRELLIS | 1 | 8.81 | $0.01233 | 378,624 | 25.75 | 0.385 | 0.757 | native | 149 |
| Salmon sushi platter | TRELLIS | 2 | 5.73 | $0.00803 | 304,960 | 20.74 | 0.391 | 0.760 | native | 156 |
| Greek salad | SAM 3D Objects | 1 | 16.95 | $0.02000 | 611,712 | 41.60 | 0.388 | 0.753 | 148.32, 0, 0.03 | 199 |
| Greek salad | Idol | 1 | 5.74 | $0.10000 | 262,144 | 17.83 | 0.378 | 0.738 | native | 240 |
| Greek salad | TRELLIS | 1 | 9.00 | $0.01260 | 432,864 | 29.44 | 0.381 | 0.748 | native | 345 |

## Public Space reference

| Dish | Endpoint | Cost | Historical scores and judgment |
| --- | --- | --- | --- |
| Shoyu ramen | Idol public Hugging Face Space | $0 | Fidelity 5, bowl 5, toppings 4, rear 4, artifacts 4. Accepted under the earlier rubric. |

**Public Space runs — quality signal only.** The Space version and settings can differ from the paid deployment. Its ramen used the earlier 5th–95th scale convention and four-view sheet. It has no weight in the paid comparison. [Original ramen contact sheet](outputs/ramen/idol-space/attempt1/historical-sheet.png)

## Reproduce the local review

From the experiment directory, run `python3 -B sheets.py` to rebuild the eight sheets and ledger from the preserved attempts, then `python3 -B verify.py` to validate the artifacts. `python3 -B report_tables.py` prints the data tables. The paid runner `run.py` reads credentials from the repository environment file, journals provider IDs before polling, enforces a shared budget reservation and serializes fal jobs. These artifacts are local to the experiment.
