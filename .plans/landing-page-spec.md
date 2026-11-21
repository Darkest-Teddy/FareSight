# FareSight landing page — sections 1 and 2

Spec for the first two sections of the marketing site. Written from the master
plan (`masterplan.txt`), the Zen TV capture, and the RDR2 meal-screen frame.

---

## 1. What the references actually showed

### Zen TV capture (the hero reference)

`Videos/Captures/(127) Zen TV ... 10-34-05.mp4` — 20.2 s, 1920×1200. Frames
extracted with ffmpeg and inspected. The shot:

1. A man sits on a white chair in a bright white panelled room: wainscoting, a
   chimney breast, tall sash windows, wood plank floor.
2. The walls break into **large flat architectural slabs** — wall segments,
   window frames, skirting chunks. Roughly 20–40 visible pieces, not a fine
   grid. Each slab has visible edge thickness.
3. They **float up and outward, tumbling slowly**. Weightless, not explosive.
   Staggered: the structure erodes from the edges inward.
4. The floor gives way to grass from the outside in.
5. Behind it: blue sky, sea, a green clifftop.
6. **The seated figure never moves.** He is the anchor the shot hangs on.
7. Light shifts from flat interior to open daylight as the shell leaves.

This is the motion the first section reproduces, with a restaurant in place of
the clifftop.

### RDR2 meal frame (the second-section reference)

First-person. Two hands, one holding a knife, over a pewter plate on dark
wood, menu card beneath. A white serif title sits under the plate:
*Lambs Fry* / *with green peas and boiled potatoes*. Camera looks **down** at
the plate from seated eye height.

That camera angle is the whole reason section 2 works: at a downward angle a
plate reads as a plate, and portion size is legible.

### What could not be checked

- **practicalvr.com/play** — client-rendered; the fetch returned one word.
  Not used as a source for any decision in this spec. Pending.
- **mise.software** — text only. Confirmed its structure (cinematic
  first-person, "scroll to wear glasses") but none of its visuals.

---

## 2. Decisions taken

| Question | Decision | Source |
| --- | --- | --- |
| Palette | Master plan §9.14 throughout. Navy `#0B1020`, cyan `#4FE3FF`, amber `#FFB547`, Inter. Zen TV informs pacing and camera only, not colour. | User |
| The person | **First-person.** The viewer is the person in the headset. | User |
| Name | FareSight. | Master plan |
| Engine | PlayCanvas, already a `web` dependency and the §8 choice. No second 3D engine. | Repo |
| Rendering | Real-time 3D, not baked video or image sequences. | User |

### Why first-person settles the hardest problem

No CC0 photoreal human exists. Wikimedia's VR-headset photographs are military
training shots and scanned PDFs. A modelled figure would be the one object in
frame reading as CG next to photogrammetry, which the brief rules out.

First-person removes the problem rather than working around it, and both
references are already first-person or near it. The server in section 2
becomes an arm entering frame, which is one asset rather than a whole person.

---

## 3. Section 1 — the home comes apart

**Camera.** Seated eye height, ~1.2 m, looking slightly down. Fixed position
like the Zen TV chair; only a slow dolly forward across the scroll. Headset
edge-vignette frames the view.

**Built geometry** (it has to be ours, because it has to break):

- Floor: plank geometry, `laminate_floor` PBR.
- Walls: panelled slabs, `painted_plaster_wall` PBR, with wainscot and picture
  rail proportions taken from the reference.
- Window openings cut into one wall, carrying the daylight.

**Photogrammetry scans placed in it:** `Sofa_01`, `CoffeeTable_01`,
`potted_plant_01`, `ClassicConsole_01`.

**Lighting:** `home-env.jpg`, a 1024×512 probe baked from the `hotel_room`
HDRI. Never shown; it lights the scans and gives glazing something true to
reflect.

**The deconstruction, driven by scroll progress 0 → 1:**

| Progress | What happens |
| --- | --- |
| 0.00–0.15 | Still. Room settled. Copy holds. |
| 0.15–0.55 | Wall slabs detach in a staggered sweep, edges first. Each rises, drifts outward, tumbles on a seeded axis. |
| 0.35–0.75 | Floor planks peel from the outside in; restaurant floor beneath. |
| 0.45–0.90 | Furniture scans lift and follow the slabs out. |
| 0.55–1.00 | Lighting cross-fades `home-env` → `restaurant-env`. Restaurant geometry resolves. |

Motion rules taken from the reference: slow and weightless, each piece keeps
its original plane briefly before tumbling, rise dominates drift, nothing
accelerates sharply.

---

## 4. Section 2 — the table

**Camera.** Seated at the restaurant table, looking down at the plate, as in
the RDR2 frame.

**Built geometry:** tile floor (`floor_tiles_06`), brick walls
(`brick_wall_003`), carrying the warm restaurant the first section revealed.

**Scans:** `WoodenTable_01`, `dining_chair_02`, `carved_wooden_plate`,
`wooden_bowl_01`, `wine_bottles_01`.

**Lighting:** `restaurant-env.jpg`, baked from `warm_restaurant`.

**The interaction.** Scroll moves through the menu. Each dish arrives on the
plate and carries, in the §9.14 type:

- Dish name and description, set in the serif weight of the reference frame.
- **Price** in amber `#FFB547`.
- **Portion note**, which is the thing listing apps cannot show.
- **Fare on top**, and the resulting total — the master plan's actual pitch:
  *see exactly what $16 and a Green Line trip gets you*.
- A provenance label, per master plan §3: **Captured** or **Size not
  verified**. Never implied.

---

## 5. Open — needs the user

1. **practicalvr.com/play** still unseen. Stated quality bar.
2. **Cooked food in 3D.** Poly Haven's scanned food is raw produce only
   (apple, avocado, pears, pomegranate, kiwi, lime, ginger, sweet potato,
   hamburger buns). There is no CC0 photoscan of a plated restaurant meal.
   Real food photography on the plate matches the reference frame's angle
   convincingly, but it is a photograph in a 3D scene, not a scan. Flagged
   rather than decided.

---

## 6. Build order

1. Asset pipeline — **done** (`fetch_landing_assets.mjs`, `bake_landing_env.mjs`).
2. Scroll controller and scene bootstrap.
3. Section 1 room and deconstruction.
4. Section 2 table and dish presentation.
5. Reduced-motion and no-WebGL fallbacks.
6. Attribution wired to `credits.json`.
