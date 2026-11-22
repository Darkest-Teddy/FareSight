# Boston walk-through splats · 2026-11-21

WorldMirror 2.0 (Replicate) run on the team's own phone photos of four Boston locations. Each location has 12–19 interior photos.

The settings were the same as the first room experiment, with three changes:
- The sky mask was off.
- Opacity was fixed before compression.
- The review sheets were rendered at full density.

The source photos are private and gitignored. Their EXIF data, including GPS, was stripped before upload.

## Result

**Photo coverage was what the first experiment was missing.** With a full walk-through, El Jefe's holds together 1.5 m into the room, and so does Starbucks apart from smears on its glass walls. The 3-photo control at each location shows the same holes the first experiment did. Shu Daxia holds together near the photo positions but breaks between widely spaced shots.

| Location | Photos | Verdict | Best config |
|---|---|---|---|
| El Jefe's Taqueria, Kenmore | 12 | Walkable along the photo path. Gaps only where consecutive photos are 3–4 m apart. | all-952 |
| Starbucks, Warren Towers | 13 | Walkable. Glass partitions smear, and the floor and ceiling show some artifacts. | all-952 |
| Shu Daxia Hot Pot | 19 | Good near the photo positions. Breaks between shots 2.5–7 m apart among dense furniture. | all-952 |
| City Convenience, Warren Towers | 15 | **Abandoned.** The full set mis-registered the repeated aisles on top of the checkout. A 6-photo front-of-store subset registered correctly but had large gaps between shots. | — |

952 px is clearly sharper than 518 px once there are enough photos. This reverses the first experiment's finding, where 952 px didn't help.

## Cost and size

Total spend was **$0.25** for 13 runs, including $0.06 on City Convenience. A walkable room at 952 px cost **$0.03–0.05** of inference, well under the $0.25 target.

| Config | Raw Gaussians | Full-density SOG | 1M SOG | 500k SOG | Cost |
|---|---|---|---|---|---|
| eljefes-kenmore-all-952 | 4.33 M | 44 MB | 11.8 MB | 6.0 MB | $0.043 |
| shudaxia-hotpot-all-952 | 4.77 M | 50 MB | 11.9 MB | 6.1 MB | $0.052 |
| starbucks-warren-all-952 | 2.53 M | 26 MB | 11.7 MB | 6.0 MB | $0.030 |
| *-all-518 | 1.3–2.3 M | 14–24 MB | ~11.5 MB | ~6 MB | $0.013–0.023 |
| *-3p-518 | 0.41–0.46 M | 4–5 MB | — | — | $0.004 |

**Density now matters.** Cutting a dense room to 100k or 250k Gaussians gives it a pebbly texture (see each `tiers.png`). 500k is acceptable, and 1M looks almost the same as full density. The viewer defaults to the 1M tier. Its frame time on a Quest 3 has not been measured.

## Capture guidance for the next location

- Walk the room and take a photo about every metre, with each shot overlapping the previous one. Between shots 3 m or more apart, the walk check shows gaps and smears.
- Cover each seating area from more than one side.
- Leave out exterior shots and tabletop close-ups.
- Stores with repeated aisles mis-register. Glass partitions smear.

## Files

- `run.py`: Replicate runner. It reuses `../rooms/run.py` and writes `results.json`.
- `evaluate.py`: writes the stats, the SOG tiers, a full-density contact sheet and `tiers.png` for each config.
- `walk.py`: renders `walk.png`, which shows each photo, a novel view halfway to the next photo, and that next photo.
- `outputs/<location>-<config>/`: the SOGs, renders, sheets and `camera_params.json`.
