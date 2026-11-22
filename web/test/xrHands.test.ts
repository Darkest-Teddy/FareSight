import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as pc from 'playcanvas';
import ts from 'typescript';
import type { ModelLibrary, ScenePicker } from '../src/xr/sceneSupport.ts';

// Match Vite's TypeScript handling for the XR modules under Node's strip-only test runner.
const xrDirectory = new URL('../src/xr/', import.meta.url).href;
const xrModules = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(xrDirectory) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith(xrDirectory) || !url.endsWith('.ts')) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
const { XRPresence } = await import('../src/xr/XRPresence.ts');
xrModules.deregister();

const digits = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].map((digit) => [
  'metacarpal', 'phalanx-proximal', ...(digit === 'thumb' ? [] : ['phalanx-intermediate']), 'phalanx-distal', 'tip',
].map((joint) => `${digit}-${joint}`));
const jointNames = ['wrist', ...digits.flat()];
type Side = 'left' | 'right';
type Pose = { position: pc.Vec3; rotation: pc.Quat };

function makeApp(): pc.AppBase {
  const graphicsDevice = new pc.NullGraphicsDevice();
  const app = new pc.AppBase(graphicsDevice.canvas);
  const options = new pc.AppOptions();
  options.graphicsDevice = graphicsDevice;
  options.componentSystems = [pc.RenderComponentSystem];
  options.resourceHandlers = [pc.ContainerHandler];
  app.init(options);
  return app;
}

async function loadHand(app: pc.AppBase, side: Side): Promise<pc.ContainerResource> {
  const filename = `vr-hand-${side}.glb`;
  const glb = readFileSync(new URL(`../public/assets-demo/${filename}`, import.meta.url));
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.equal(json.skins.length, 1);
  assert.equal(json.accessors[json.skins[0].inverseBindMatrices].count, 25);
  const asset = new pc.Asset(filename, 'container', { url: filename, contents: Uint8Array.from(glb).buffer });
  app.assets.add(asset);
  await new Promise((resolve, reject) => {
    asset.ready(resolve);
    asset.once('error', reject);
    app.assets.load(asset);
  });
  return asset.resource;
}

function singleMesh(entity: pc.Entity): pc.MeshInstance {
  const instances = (entity.findComponents('render') as pc.RenderComponent[]).flatMap(({ meshInstances }) => meshInstances);
  assert.equal(instances.length, 1);
  return instances[0];
}

function makePresence(app: pc.AppBase, load: ModelLibrary['load']) {
  const root = new pc.Entity('Presence', app);
  const cameraRig = new pc.Entity('Camera rig', app);
  const camera = new pc.Entity('Camera', app);
  app.root.addChild(root);
  app.root.addChild(cameraRig);
  cameraRig.addChild(camera);
  const input = new pc.EventHandler();
  const xr = Object.assign(new pc.EventHandler(), { input, app, camera, active: true, visibilityState: 'visible' });
  const actions = { targets: () => [], buttons: [], menu: () => undefined, reviews: () => [] };
  const presence = new XRPresence(xr as unknown as pc.XrManager, root, cameraRig, camera,
    { nearPanel: () => null } as unknown as ScenePicker, { load } as ModelLibrary,
    actions as unknown as ConstructorParameters<typeof XRPresence>[6]);
  return { presence, root, cameraRig, input, xr };
}

function trackedSource(xr: pc.EventHandler, side: Side) {
  const joints = new Map<string, pc.XrJoint>();
  const hand = {
    _manager: xr,
    tracking: true,
    get wrist() { return joints.get('wrist'); },
    get joints() { return [...joints.values()]; },
    get fingers() { return digits.map((names) => ({ joints: names.map((name) => joints.get(name)) })); },
    getJointById: (name: string) => joints.get(name) ?? null,
  };
  for (const [index, name] of jointNames.entries()) {
    joints.set(name, new pc.XrJoint(index, name, hand as unknown as pc.XrHand));
  }
  return { hand, joints, source: {
    hand, handedness: side, targetRayMode: pc.XRTARGETRAY_GAZE, grip: false,
    getLocalPosition: () => null, getLocalRotation: () => null,
  } };
}

function applyPose(joints: Map<string, pc.XrJoint>, poses: Map<string, Pose>): void {
  for (const [name, joint] of joints) {
    const { position, rotation } = poses.get(name)!;
    joint.update({ radius: 0.006, transform: { position, orientation: rotation } } as Parameters<pc.XrJoint['update']>[0]);
  }
}

function aimDigits(poses: Map<string, Pose>): void {
  for (const digit of digits) {
    for (let i = 1; i < digit.length; i++) {
      const from = poses.get(digit[i - 1])!;
      const to = poses.get(digit[i])!;
      from.rotation.setFromDirections(pc.Vec3.FORWARD, new pc.Vec3().sub2(to.position, from.position).normalize());
      if (i === digit.length - 1) to.rotation.copy(from.rotation);
    }
  }
}

function moveTip(poses: Map<string, Pose>, chain: string[], target: pc.Vec3): void {
  const tip = poses.get(chain.at(-1)!)!;
  const delta = new pc.Vec3().sub2(target, tip.position);
  for (const [index, name] of chain.entries()) poses.get(name)!.position.addScaled(delta, (index + 1) / chain.length);
}

function skinVolume(mesh: pc.Mesh, palette: pc.Mat4[]): number {
  const positions: number[] = [], indices: number[] = [], blends: number[] = [], weights: number[] = [];
  const vertexCount = mesh.getPositions(positions);
  assert.equal(mesh.getIndices(indices), 2314 * 3);
  assert.equal(mesh.getVertexStream(pc.SEMANTIC_BLENDINDICES, blends), vertexCount);
  assert.equal(mesh.getVertexStream(pc.SEMANTIC_BLENDWEIGHT, weights), vertexCount);
  const transformed = [];
  const position = new pc.Vec3(), point = new pc.Vec3();
  for (let i = 0; i < vertexCount; i++) {
    position.set(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
    const result = new pc.Vec3();
    for (let j = 4 * i; j < 4 * i + 4; j++) {
      if (weights[j]) result.addScaled(palette[blends[j]].transformPoint(position, point), weights[j]);
    }
    assert.ok(Number.isFinite(result.lengthSq()));
    transformed.push(result);
  }
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [transformed[indices[i]], transformed[indices[i + 1]], transformed[indices[i + 2]]];
    volume += a.dot(point.cross(b, c)) / 6;
  }
  return volume;
}

const identityError = (matrix: pc.Mat4) => Math.hypot(...matrix.data.map((value, index) => value - pc.Mat4.IDENTITY.data[index]));

function assertPose(instance: pc.MeshInstance, joints: Map<string, pc.XrJoint>, frame: number): pc.Mat4[] {
  const skin = instance.skinInstance!;
  skin.updateMatrixPalette(instance.node, frame);
  const matrices: pc.Mat4[] = skin.matrices;
  for (const [index, bone] of skin.bones.entries()) {
    const joint = joints.get(bone.name)!;
    assert.ok(bone.getPosition().distance(joint.getPosition()) < 1e-5, bone.name);
    assert.ok(Math.abs(bone.getRotation().dot(joint.getRotation())) > 1 - 1e-5, bone.name);
    const matrix = matrices[index];
    const determinant = new pc.Vec3().cross(matrix.getX(), matrix.getY()).dot(matrix.getZ());
    assert.ok(Math.abs(determinant - 1) < 1e-4, `${bone.name} determinant ${determinant}`);
  }
  return matrices;
}

for (const side of ['left', 'right'] as const) {
  test(`${side} GLB skins at bind, flat open and pinched WebXR poses`, async (t) => {
    const app = makeApp();
    let destroyPresence: (() => void) | undefined;
    t.after(() => { destroyPresence?.(); app.destroy(); });
    const resource = await loadHand(app, side);
    const bindRig = resource.instantiateRenderEntity();
    const bindMesh = singleMesh(bindRig);
    const skin = bindMesh.skinInstance!;
    assert.deepEqual(new Set(skin.skin.boneNames), new Set(jointNames));
    assert.equal(identityError(bindRig.getWorldTransform()), 0);
    assert.equal(identityError(bindMesh.node.getWorldTransform()), 0);
    assert.ok(skin.bones.every((bone) => bone.parent === bindRig));
    const bind = new Map(skin.bones.map((bone) => [bone.name, {
      position: bone.getPosition().clone(), rotation: bone.getRotation().clone(),
    }]));
    for (const digit of digits) {
      for (let i = 1; i < digit.length; i++) {
        const from = bind.get(digit[i - 1])!;
        const along = bind.get(digit[i])!.position.clone().sub(from.position).normalize();
        assert.ok(along.dot(from.rotation.transformVector(pc.Vec3.FORWARD)) > 0.99, digit[i - 1]);
      }
    }
    const wrist = bind.get('wrist')!;
    const inverseWrist = wrist.rotation.clone().invert();
    const open = new Map([...bind].map(([name, { position }]) => {
      const flat = inverseWrist.transformVector(position.clone().sub(wrist.position));
      flat.y = 0;
      return [name, { position: flat, rotation: new pc.Quat() }];
    }));
    aimDigits(open);
    const thumb = open.get('thumb-tip')!.position;
    const index = open.get('index-finger-tip')!.position;
    const pinky = open.get('pinky-finger-tip')!.position;
    assert.ok(side === 'left' ? thumb.x > index.x && index.x > pinky.x : thumb.x < index.x && index.x < pinky.x);
    for (const [, { rotation }] of open) assert.ok(rotation.transformVector(pc.Vec3.UP).dot(pc.Vec3.UP) > 0.9999);
    assert.ok(open.get('middle-finger-tip')!.position.z < -0.16);
    bindRig.destroy();

    const pending = Promise.withResolvers<pc.ContainerResource>();
    const { presence, root, cameraRig, input, xr } = makePresence(app, (url) => {
      assert.equal(url, `/assets-demo/vr-hand-${side}.glb`);
      return pending.promise;
    });
    destroyPresence = () => presence.destroy();
    const { hand, source, joints } = trackedSource(xr, side);
    applyPose(joints, bind);
    input.fire('add', source);
    presence.updatePointers();
    const fallback = root.findByName('Tracked hand fallback') as pc.Entity;
    assert.ok(fallback?.enabled && fallback.children.length > 25);
    const fallbackTips = (fallback.findByName('thumb-tip') as pc.Entity).render!.meshInstances[0].material;
    const destroyTips = t.mock.method(fallbackTips, 'destroy');
    pending.resolve(resource);
    await pending.promise;
    assert.equal(root.findByName('Tracked hand fallback'), null);
    assert.equal(destroyTips.mock.callCount(), 1);
    const rig = root.findByName('Armature') as pc.Entity;
    assert.ok(rig && !rig.enabled, 'The rig stays hidden until a tracked frame has posed it');
    presence.updatePointers();
    const instance = singleMesh(rig);
    const surface = instance.material as pc.StandardMaterial;
    assert.equal(instance.cull, false);
    assert.equal(surface.blendType, pc.BLEND_NONE);
    assert.equal(surface.depthWrite, true);
    const bindPalette = assertPose(instance, joints, 1);
    const bindError = Math.max(...bindPalette.map(identityError));
    assert.ok(bindError < 1e-3, `bind identity error ${bindError}`);
    const bindVolume = skinVolume(instance.mesh, bindPalette);
    assert.ok(bindVolume > 0.00001);
    t.diagnostic(`Maximum bind matrix error ${bindError.toExponential(2)}, mesh volume ${bindVolume.toExponential(3)} m³`);

    // XrJoint applies the camera parent transform. XRPresence also handles an independent root transform.
    cameraRig.setLocalPosition(2, 1, -3);
    cameraRig.setLocalEulerAngles(5, 61, -8);
    root.setLocalPosition(-2, 0.3, 1);
    root.setLocalEulerAngles(-9, 23, 6);
    applyPose(joints, open);
    presence.updatePointers();
    assert.ok(skinVolume(instance.mesh, assertPose(instance, joints, 2)) > 0.00001);
    const openEmission = surface.emissiveIntensity;

    const contact = thumb.clone().lerp(thumb, index, 0.45).add(new pc.Vec3(0, -0.020, 0.013));
    moveTip(open, digits[0].slice(-2), contact.clone().add(new pc.Vec3(0, -0.005, 0)));
    moveTip(open, digits[1].slice(-3), contact.clone().add(new pc.Vec3(0, 0.005, 0)));
    aimDigits(open);
    applyPose(joints, open);
    presence.updatePointers();
    assert.ok(skinVolume(instance.mesh, assertPose(instance, joints, 3)) > 0.00001);
    assert.ok(surface.emissiveIntensity > openEmission + 0.15);

    const missing = 'pinky-finger-phalanx-distal';
    const bone = rig.findByName(missing)!;
    const lastLocalPosition = bone.getLocalPosition().clone();
    joints.delete(missing);
    const displacement = new pc.Vec3(0.08, 0.13, -0.16);
    const expected = bone.getPosition().clone().add(displacement);
    cameraRig.translate(displacement);
    presence.updatePointers();
    assert.ok(bone.getLocalPosition().equals(lastLocalPosition));
    assert.ok(bone.getPosition().distance(expected) < 1e-5);
    hand.tracking = false;
    presence.updatePointers();
    assert.equal(rig.enabled, false);
    hand.tracking = true;
    presence.updatePointers();
    assert.equal(rig.enabled, true);
    assert.equal(instance.cull, false);

    const destroySurface = t.mock.method(surface, 'destroy');
    const destroySkinTexture = t.mock.method(instance.skinInstance!.boneTexture, 'destroy');
    if (side === 'left') input.fire('remove', source);
    else {
      presence.destroy();
      destroyPresence = undefined;
    }
    assert.equal(root.children.length, 0);
    assert.equal(destroySurface.mock.callCount(), 1);
    assert.equal(destroySkinTexture.mock.callCount(), 1);
  });
}

test('XRPresence keeps the fallback on a failed load and ignores late loads after removal or destruction', async (t) => {
  const app = makeApp();
  t.after(() => app.destroy());
  const left = Promise.withResolvers<pc.ContainerResource | null>();
  const right = Promise.withResolvers<pc.ContainerResource | null>();
  const { presence, root, input, xr } = makePresence(app, (url) => url.endsWith('left.glb') ? left.promise : right.promise);
  const leftSource = trackedSource(xr, 'left').source;
  const rightSource = trackedSource(xr, 'right').source;
  input.fire('add', leftSource);
  input.fire('add', rightSource);
  const resource = { instantiateRenderEntity: t.mock.fn(() => assert.fail('A late result must never instantiate')) } as unknown as pc.ContainerResource;
  input.fire('remove', leftSource);
  left.resolve(resource);
  await left.promise;
  assert.equal(root.children.length, 1);

  right.resolve(null);
  await right.promise;
  presence.updatePointers();
  assert.ok(root.findByName('Tracked hand fallback')?.enabled);

  const pending = Promise.withResolvers<pc.ContainerResource>();
  const second = makePresence(app, () => pending.promise);
  second.input.fire('add', trackedSource(second.xr, 'left').source);
  second.presence.destroy();
  pending.resolve(resource);
  await pending.promise;
  assert.equal(second.root.children.length, 0);
  presence.destroy();
});
