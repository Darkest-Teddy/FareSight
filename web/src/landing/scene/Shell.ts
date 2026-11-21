import * as pc from 'playcanvas';
import { child, clamp, type XYZ } from '../../xr/sceneSupport';

/**
 * A room shell that comes apart.
 *
 * The reference this is built from (the Zen TV capture) does something very
 * specific, and it is worth naming because it is easy to get wrong: the room
 * does not shatter. It *erodes*. Large flat architectural pieces — a stretch
 * of wall, a window surround, a length of skirting — detach one after another
 * and rise, tumbling slowly, until there is no room left. Nothing accelerates
 * sharply and nothing breaks into fragments.
 *
 * So each piece here is a real slab with real thickness, and there are a few
 * dozen of them rather than a few hundred. That is cheap enough to animate on
 * the CPU as ordinary entities, which in turn means every piece is lit by the
 * scene's image-based lighting like any other object. A custom shader would
 * have been faster and would have had to reimplement all of that worse.
 */

export interface SlabSpec {
  /** Centre of the slab, in room space, metres. */
  readonly position: XYZ;
  /** Full extents, metres. One axis is the thickness. */
  readonly size: XYZ;
  /** Euler angles in degrees. Defaults to none. */
  readonly rotation?: XYZ;
  /** Picks which of the shell's materials the slab is built from. */
  readonly surface: string;
  /**
   * Overrides when this slab leaves, 0 to 1. Pieces are otherwise ordered by
   * how far they sit from the middle of the room, so the shell opens from its
   * edges inward the way the reference does.
   */
  readonly delay?: number;
}

interface Piece {
  readonly entity: pc.Entity;
  readonly restPosition: pc.Vec3;
  readonly restRotation: pc.Quat;
  /** When this piece starts to leave, 0 to 1 across the whole break-up. */
  readonly delay: number;
  /** Direction it drifts, away from the middle of the room. */
  readonly drift: pc.Vec3;
  readonly tumbleAxis: pc.Vec3;
  readonly tumbleTurns: number;
  readonly rise: number;
}

/** How long any one piece takes to leave, as a fraction of the whole. */
const pieceSpan = 0.55;
/** Metres a piece rises over its travel. Rise dominates drift, as in the reference. */
const riseBase = 7.5;
/** Metres a piece drifts outward over its travel. */
const driftBase = 3.4;

/** Deterministic pseudo-random in [0, 1). Keeps the break-up identical run to run. */
function seeded(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Smootherstep: starts and ends at a standstill, which is the whole feel. */
function ease(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class Shell {
  private readonly pieces: Piece[] = [];
  private readonly scratchPosition = new pc.Vec3();
  private readonly scratchRotation = new pc.Quat();
  private readonly spin = new pc.Quat();

  constructor(
    app: pc.Application,
    parent: pc.Entity,
    specs: readonly SlabSpec[],
    materials: Readonly<Record<string, pc.Material>>,
    private readonly name = 'shell',
  ) {
    // Pieces furthest from the middle of the room leave first. Measuring that
    // here rather than asking each spec for a delay keeps the room layout
    // readable: it describes a room, not an animation.
    const spans = specs.map((spec) => Math.hypot(spec.position[0], spec.position[2]));
    const furthest = Math.max(...spans, 1);

    specs.forEach((spec, index) => {
      const surface = materials[spec.surface];
      if (!surface) throw new Error(`${name}: no material for surface '${spec.surface}'`);

      const entity = child(parent, `${name}-${index}`, spec.position);
      entity.addComponent('render', { type: 'box', material: surface, castShadows: true, receiveShadows: true });
      entity.setLocalScale(...spec.size);
      if (spec.rotation) entity.setLocalEulerAngles(...spec.rotation);

      // Outward in the horizontal plane only. Pieces that happen to sit dead
      // centre get an arbitrary but stable direction rather than a zero one.
      const drift = new pc.Vec3(spec.position[0], 0, spec.position[2]);
      if (drift.length() < 0.001) drift.set(seeded(index) - 0.5, 0, seeded(index + 99) - 0.5);
      drift.normalize();

      const tumbleAxis = new pc.Vec3(
        seeded(index + 11) - 0.5,
        seeded(index + 23) - 0.5,
        seeded(index + 37) - 0.5,
      ).normalize();

      this.pieces.push({
        entity,
        restPosition: entity.getLocalPosition().clone(),
        restRotation: entity.getLocalRotation().clone(),
        delay: spec.delay ?? (1 - spans[index] / furthest) * (1 - pieceSpan),
        drift,
        tumbleAxis,
        // Under a full turn. More than that reads as debris rather than as a
        // room letting go of itself.
        tumbleTurns: 0.18 + seeded(index + 53) * 0.42,
        rise: riseBase * (0.7 + seeded(index + 71) * 0.6),
      });
    });
  }

  /**
   * `t` is 0 with the room intact and 1 once every piece has gone.
   *
   * Pieces are hidden rather than faded once they are clear of the frame.
   * The reference never fades anything; the room simply stops being between
   * you and what is behind it.
   */
  setProgress(t: number): void {
    const progress = clamp(t, 0, 1);

    for (const piece of this.pieces) {
      const local = clamp((progress - piece.delay) / pieceSpan, 0, 1);

      if (local <= 0) {
        piece.entity.enabled = true;
        piece.entity.setLocalPosition(piece.restPosition);
        piece.entity.setLocalRotation(piece.restRotation);
        continue;
      }
      if (local >= 1) { piece.entity.enabled = false; continue; }

      piece.entity.enabled = true;
      const eased = ease(local);

      const travel = driftBase * eased;
      this.scratchPosition.set(
        piece.restPosition.x + piece.drift.x * travel,
        piece.restPosition.y + piece.rise * eased,
        piece.restPosition.z + piece.drift.z * travel,
      );
      piece.entity.setLocalPosition(this.scratchPosition);

      // Hold the original plane for the first moment of travel, so a piece
      // lifts away before it starts to turn over.
      const turn = ease(clamp((local - 0.12) / 0.88, 0, 1));
      this.spin.setFromAxisAngle(piece.tumbleAxis, piece.tumbleTurns * 360 * turn);
      piece.entity.setLocalRotation(this.scratchRotation.mul2(this.spin, piece.restRotation));
    }
  }

  destroy(): void {
    for (const piece of this.pieces) piece.entity.destroy();
    this.pieces.length = 0;
  }
}
