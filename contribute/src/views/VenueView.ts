import { MAX_ROOM_PHOTOS, type GenerationJob, type Place, type RoomModelTier, type Stop } from '@faresight/shared';
import { api } from '../api';
import { sendCapture, type CaptureUpload } from '../captureUpload';
import { catalog } from '../catalog';
import { categoryLabel, coverage, servesDishes } from '../data';
import { button, el, errorText, haptic, icon, iconButton, motion, replay, svg, wait, type IconName } from '../dom';
import { prepareImage } from '../photos';
import { scans } from '../store';
import { withCode } from '../ui/CodeSheet';
import { openGuidedScan } from '../ui/GuidedScan';

type Kind = 'room' | 'dish';
interface Shot {
  file: File;
  url: string;
  node: HTMLElement;
  uploadId?: string;
}

const MIN_ROOM_PHOTOS = 2;
const NEW_DISH = '';
// One line of advice, shown only once the person reaches for the camera or the library.
// The 360° scan explains itself on its own first screen.
const hints: Record<Kind, string> = {
  room: 'Let each photo overlap the last by about half.',
  dish: 'Whole plate in frame, from about 45°.',
};
const tiers: [RoomModelTier, string, string][] = [
  ['atlas-draft', 'Draft', 'Ready in about a minute'],
  ['atlas-refined', 'Refined', 'Sharper, takes about 20 minutes'],
];

function radio(name: string, value: string, checked: boolean, change: () => void) {
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', change);
  return input;
}

/** Add photos of one place and start the job that turns them into a 3D preview. */
export class VenueView {
  readonly root = el('section', 'view venue-view');
  private readonly kinds: Kind[];
  private readonly shots: Record<Kind, Shot[]> = { room: [], dish: [] };
  private readonly grid = el('div', 'photo-grid');
  private readonly hint = el('p', 'field-hint photo-hint');
  private readonly hinted = new Set<Kind>();
  private readonly count = el('span', 'photo-count');
  private readonly options = el('section', 'options');
  private readonly feedback = el('p', 'form-error');
  private readonly send: HTMLButtonElement;
  private readonly sendLabel = el('span');
  private readonly heading = el('h1');
  private readonly sub = el('p', 'view-sub');
  private readonly status = el('div', 'venue-status');
  private readonly unsubscribe: () => void;
  private readonly dishName = el('input', 'text-input');
  private readonly diameter = el('input', 'text-input');
  private kind: Kind;
  private tier: RoomModelTier = 'atlas-draft';
  private dishId: string;
  private busy = false;
  private finished = false;
  private alive = true;
  /** The room capture being sent to object storage, and the photos it was started with. */
  private capture?: { upload: CaptureUpload; shots: Shot[] };

  constructor(
    private place: Place,
    private readonly stop: Stop,
    private readonly actions: { back(): void; done(jobId: string): void },
  ) {
    const status = coverage(place);
    this.kinds = servesDishes(place) ? ['room', 'dish'] : ['room'];
    // Start on whatever the place is still missing.
    this.kind = status.room && this.kinds.includes('dish') ? 'dish' : 'room';
    this.dishId = place.dishes.find((dish) => !(dish.asset ?? dish.asset_id))?.id ?? place.dishes[0]?.id ?? NEW_DISH;

    const head = el('header', 'view-head');
    const title = el('div', 'head-title');
    title.append(this.heading, this.sub);
    head.append(iconButton('back', `Back to ${stop.name}`, actions.back, 'head-back'), title);

    const body = el('div', 'venue-body');
    body.append(this.status);
    this.renderPlace();
    this.unsubscribe = catalog.subscribe(() => this.onCatalog());

    const photos = el('section', 'photo-section');
    const photoHead = el('div', 'section-head');
    photoHead.append(el('h2', '', 'Photos'), this.count);
    photos.append(photoHead, this.grid, this.hint);

    this.dishName.type = 'text';
    this.dishName.maxLength = 120;
    this.dishName.placeholder = 'Name of the dish';
    this.dishName.autocomplete = 'off';
    this.dishName.enterKeyHint = 'done';
    this.dishName.setAttribute('aria-label', 'Name of the new dish');
    this.dishName.addEventListener('input', () => this.renderFooter());
    this.diameter.type = 'number';
    this.diameter.inputMode = 'decimal';
    this.diameter.min = '5';
    this.diameter.max = '100';
    this.diameter.step = 'any';
    this.diameter.placeholder = 'Optional, for example 24';
    this.diameter.addEventListener('input', () => this.renderFooter());

    body.append(photos, this.options);

    this.feedback.setAttribute('role', 'alert');
    this.send = button('', () => void this.submit(), 'primary send');
    this.send.append(this.sendLabel);
    const foot = el('footer', 'venue-foot');
    foot.append(this.feedback, this.send);
    this.root.append(head, body, foot);
    this.render();
  }

  destroy() {
    this.alive = false;
    this.unsubscribe();
    for (const shot of [...this.shots.room, ...this.shots.dish]) URL.revokeObjectURL(shot.url);
  }

  private get current() { return this.shots[this.kind]; }

  /** Shows what comes from the place itself: its name, where it is and what it still needs. */
  private renderPlace() {
    const place = this.place;
    const status = coverage(place);
    this.heading.textContent = place.name;
    this.sub.textContent = `${categoryLabel(place)} · ${this.stop.name} · ${place.walk_from_stop_m} m from the stop`;
    this.status.replaceChildren(this.kinds.length > 1 ? this.kindPicker(status) : this.statusNote(status.room));
  }

  /** Follows the place when it changes on the server, without touching the photos already added. */
  private onCatalog() {
    const next = catalog.find(this.place.id);
    // A scan that is being sent keeps the place it started with.
    if (!next || !this.alive || this.busy || this.finished || JSON.stringify(next) === JSON.stringify(this.place)) return;
    this.place = next;
    if (this.dishId !== NEW_DISH && !next.dishes.some((dish) => dish.id === this.dishId)) this.dishId = next.dishes[0]?.id ?? NEW_DISH;
    this.renderPlace();
    this.renderOptions();
    this.renderFooter();
  }

  private kindPicker(status: ReturnType<typeof coverage>) {
    const picker = el('fieldset', 'kind-picker');
    picker.append(el('legend', 'visually-hidden', 'What are you scanning?'));
    const choices: [Kind, IconName, string, string, string, boolean][] = [
      ['room', 'room', 'The space', `${MIN_ROOM_PHOTOS} to ${MAX_ROOM_PHOTOS} overlapping photos`, status.room ? 'In 3D' : 'Needs photos', status.room],
      ['dish', 'dish', 'A dish', 'One photo of a single dish',
        status.dishes ? `${status.dishesDone} of ${status.dishes} in 3D` : 'None yet',
        status.dishes > 0 && status.dishesDone === status.dishes],
    ];
    for (const [kind, symbol, name, hint, state, done] of choices) {
      const card = el('label', 'kind-card');
      const chip = el('span', done ? 'state-chip is-done' : 'state-chip', state);
      card.append(
        radio('scan-kind', kind, kind === this.kind, () => {
          this.kind = kind;
          this.feedback.textContent = '';
          haptic(6);
          this.render();
        }),
        icon(symbol), el('strong', '', name), el('small', '', hint), chip,
      );
      picker.append(card);
    }
    return picker;
  }

  private statusNote(done: boolean) {
    const note = el('div', 'kind-note');
    note.append(icon('room'), el('span', '', `Scan the space with ${MIN_ROOM_PHOTOS} to ${MAX_ROOM_PHOTOS} overlapping photos.`),
      el('span', done ? 'state-chip is-done' : 'state-chip', done ? 'In 3D' : 'Needs photos'));
    return note;
  }

  private render() {
    this.renderGrid();
    this.renderOptions();
    this.renderFooter();
  }

  private picker(symbol: IconName, label: string, capture: boolean) {
    const tile = el('label', 'add-tile');
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    else input.multiple = this.kind === 'room';
    input.disabled = this.busy;
    input.addEventListener('click', () => {
      this.hinted.add(this.kind);
      this.hint.textContent = hints[this.kind];
    });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.value = '';
      this.add(files);
    });
    tile.append(input, icon(symbol), el('span', '', label));
    return tile;
  }

  private scanTile() {
    const tile = button('', () => void this.scan(), 'add-tile scan-tile');
    tile.disabled = this.busy;
    tile.append(icon('locate'), el('span', '', '360° scan'));
    return tile;
  }

  /** Runs the guided 360° scan and adds the photos it took, like photos picked by hand. */
  private async scan() {
    if (this.busy) return;
    const files = await openGuidedScan(MIN_ROOM_PHOTOS);
    if (this.alive) this.add(files);
  }

  private renderGrid() {
    const shots = this.current;
    const full = this.kind === 'room' && shots.length >= MAX_ROOM_PHOTOS;
    const tiles: HTMLElement[] = shots.map((shot) => shot.node);
    if (!full && this.kind === 'room') tiles.push(this.scanTile());
    if (!full) tiles.push(this.picker('camera', shots.length && this.kind === 'dish' ? 'Retake' : 'Camera', true),
      this.picker('image', 'Library', false));
    this.grid.replaceChildren(...tiles);
    this.hint.textContent = this.hinted.has(this.kind) ? hints[this.kind] : '';

    const needed = this.kind === 'room' ? MIN_ROOM_PHOTOS : 1;
    const ring = svg('svg', { viewBox: '0 0 24 24', class: 'count-ring', 'aria-hidden': 'true' });
    const arc = svg('circle', { cx: 12, cy: 12, r: 9, pathLength: 1, class: 'count-arc' });
    arc.style.strokeDashoffset = String(1 - Math.min(1, shots.length / needed));
    ring.append(svg('circle', { cx: 12, cy: 12, r: 9, class: 'count-track' }), arc);
    const text = this.kind === 'dish' ? (shots.length ? 'Photo added' : '1 photo needed')
      : shots.length < needed ? `${shots.length} of ${needed} needed`
      : `${shots.length} added · up to ${MAX_ROOM_PHOTOS}`;
    this.count.classList.toggle('is-ready', shots.length >= needed);
    this.count.replaceChildren(ring, el('span', '', text));
  }

  private renderOptions() {
    this.options.replaceChildren();
    if (this.kind === 'room') {
      const head = el('div', 'section-head');
      head.append(el('h2', '', 'Quality'));
      const group = el('div', 'segmented');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'Quality');
      const hint = el('p', 'field-hint', tiers.find(([tier]) => tier === this.tier)?.[2] ?? '');
      for (const [tier, name, detail] of tiers) {
        const choice = el('label', 'segment');
        choice.append(radio('room-tier', tier, tier === this.tier, () => {
          this.tier = tier;
          hint.textContent = detail;
          haptic(6);
        }), el('span', '', name));
        group.append(choice);
      }
      this.options.append(head, group, hint);
      return;
    }
    const head = el('div', 'section-head');
    head.append(el('h2', '', 'Which dish?'));
    const chips = el('div', 'chips');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', 'Dish');
    const nameField = el('div', 'field');
    nameField.append(this.dishName);
    nameField.hidden = this.dishId !== NEW_DISH;
    for (const [id, name] of [...this.place.dishes.map((dish): [string, string] => [dish.id, dish.name]), [NEW_DISH, 'New dish']] as [string, string][]) {
      const chip = el('label', 'chip');
      chip.append(radio('dish-choice', id, id === this.dishId, () => {
        this.dishId = id;
        nameField.hidden = id !== NEW_DISH;
        if (id === NEW_DISH) this.dishName.focus();
        haptic(6);
        this.renderFooter();
      }), el('span', '', name));
      chips.append(chip);
    }
    const size = el('label', 'field');
    size.append(el('span', 'field-label', 'Plate width in cm'), this.diameter,
      el('span', 'field-hint', 'Optional. It lets riders see the dish at its true size.'));
    this.options.append(head, chips, nameField, size);
  }

  /** What still stops this scan from being sent, in the words shown on the button. */
  private problem() {
    const count = this.current.length;
    if (this.kind === 'room') {
      return count < MIN_ROOM_PHOTOS ? `Add ${MIN_ROOM_PHOTOS - count} more ${MIN_ROOM_PHOTOS - count === 1 ? 'photo' : 'photos'}` : '';
    }
    if (!count) return 'Add a photo of the dish';
    if (this.dishId === NEW_DISH && !this.dishName.value.trim()) return 'Name the dish';
    if (this.diameter.value && !this.diameter.checkValidity()) return 'Plate width must be 5 to 100 cm';
    return '';
  }

  private renderFooter(progress?: { label: string; fraction: number }) {
    const problem = this.problem();
    const count = this.current.length;
    this.send.disabled = this.busy || this.finished || Boolean(problem);
    this.send.classList.toggle('is-busy', this.busy);
    this.send.style.setProperty('--progress', `${Math.round((progress?.fraction ?? 0) * 100)}%`);
    this.sendLabel.textContent = progress?.label ?? (problem
      || (this.kind === 'room' ? `Send ${count} photos and build the space` : 'Send photo and build the dish'));
  }

  private add(files: File[]) {
    if (this.busy || !files.length) return;
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name));
    const shots = this.current;
    this.feedback.textContent = images.length < files.length ? 'Only photos can be added.' : '';
    if (this.kind === 'dish') {
      for (const shot of shots.splice(0)) URL.revokeObjectURL(shot.url);
      images.splice(1);
    } else {
      const room = MAX_ROOM_PHOTOS - shots.length;
      if (images.length > room) {
        images.splice(room);
        this.feedback.textContent = `A scan takes up to ${MAX_ROOM_PHOTOS} photos. The rest were left out.`;
      }
    }
    for (const file of images) shots.push(this.shot(file));
    if (images.length) haptic(8);
    this.renderGrid();
    this.renderFooter();
    shots.at(-1)?.node.scrollIntoView({ block: 'nearest', behavior: motion(1) ? 'smooth' : 'auto' });
  }

  private shot(file: File): Shot {
    const url = URL.createObjectURL(file);
    const node = el('figure', 'shot');
    const image = el('img');
    image.alt = '';
    image.addEventListener('error', () => node.classList.add('is-unreadable'), { once: true });
    image.src = url;
    const shot: Shot = { file, url, node };
    const remove = iconButton('close', 'Remove this photo', () => {
      if (this.busy) return;
      const shots = this.current;
      shots.splice(shots.indexOf(shot), 1);
      URL.revokeObjectURL(url);
      this.renderGrid();
      this.renderFooter();
    }, 'shot-remove');
    node.append(image, icon('image', 'shot-fallback'), remove, el('span', 'shot-state'));
    return shot;
  }

  /** Sends a room's photos straight to object storage. A second try reuses the capture if the photos are the same. */
  private async sendRoom(shots: Shot[]) {
    const same = this.capture?.shots.length === shots.length && shots.every((shot, index) => shot === this.capture?.shots[index]);
    if (!same) this.capture = undefined;
    const label = (sent: number) => this.renderFooter({ label: `Sending photo ${Math.min(shots.length, sent + 1)} of ${shots.length}…`, fraction: sent / (shots.length + 1) });
    label(this.capture?.upload.sent.size ?? 0);
    const result = await sendCapture({
      placeId: this.place.id, files: shots.map((shot) => shot.file), tier: this.tier, capture: this.capture?.upload,
      onCapture: (upload) => { this.capture = { upload, shots }; },
      onFrame: (seq, state, sent) => {
        shots[seq].node.dataset.state = state;
        label(sent);
        if (sent === shots.length) this.renderFooter({ label: 'Starting the 3D build…', fraction: shots.length / (shots.length + 1) });
      },
    });
    return result;
  }

  private async finish(kind: Kind, photoCount: number, label: string, { job, captureId }: { job: GenerationJob; captureId?: string }) {
    scans.add({
      id: job.id, placeId: this.place.id, placeName: this.place.name, stopId: this.stop.stop_id, kind,
      label, photoCount, createdAt: job.created_at, captureId,
    }, job);
    this.finished = true;
    this.send.classList.add('is-done');
    this.send.prepend(icon('check'));
    this.renderFooter({ label: 'Scan started', fraction: 1 });
    haptic([10, 50, 18]);
    await wait(motion(850));
    if (this.alive) this.actions.done(job.id);
  }

  private async submit() {
    if (this.busy || this.finished || this.problem()) return;
    const kind = this.kind;
    const shots = [...this.current];
    this.busy = true;
    this.feedback.textContent = '';
    this.root.classList.add('is-sending');
    this.renderGrid();
    try {
      if (kind === 'room' && await api.captureStorage()) return await this.finish(kind, shots.length, 'The space', await this.sendRoom(shots));
      for (const [index, shot] of shots.entries()) {
        this.renderFooter({ label: `Sending photo ${index + 1} of ${shots.length}…`, fraction: index / (shots.length + 1) });
        if (shot.uploadId) continue;
        shot.node.dataset.state = 'sending';
        try {
          const file = await prepareImage(shot.file);
          shot.uploadId = (await withCode((code) => api.upload(this.place.id, file, code))).id;
          shot.node.dataset.state = 'sent';
        } catch (error) {
          shot.node.dataset.state = 'failed';
          throw error;
        }
      }
      // The server stores identical photos once, so duplicates collapse to one upload.
      const uploadIds = [...new Set(shots.map((shot) => shot.uploadId!))];
      if (kind === 'room' && uploadIds.length < MIN_ROOM_PHOTOS) {
        throw new Error('These photos are identical. Add a second angle of the room.');
      }
      this.renderFooter({ label: 'Starting the 3D build…', fraction: shots.length / (shots.length + 1) });
      const newDish = this.dishName.value.trim();
      const width = this.diameter.valueAsNumber;
      const job = await withCode((code) => api.generate(kind === 'room'
        ? { kind, place_id: this.place.id, upload_ids: uploadIds, model_tier: this.tier }
        : {
          kind, place_id: this.place.id, upload_ids: uploadIds.slice(0, 1),
          dish_id: this.dishId || undefined,
          dish_name: this.dishId ? undefined : newDish,
          plate_diameter_m: Number.isFinite(width) ? width / 100 : undefined,
        }, code));
      const dish = this.place.dishes.find((entry) => entry.id === this.dishId)?.name ?? newDish;
      await this.finish(kind, uploadIds.length, kind === 'room' ? 'The space' : dish, { job });
    } catch (error) {
      this.feedback.textContent = errorText(error);
      replay(this.send, 'is-shaking');
      haptic([20, 40, 20]);
    } finally {
      this.busy = false;
      this.root.classList.remove('is-sending');
      if (!this.finished && this.alive) {
        this.renderGrid();
        this.renderFooter();
      }
    }
  }
}
