import { MAX_ROOM_PHOTOS, type Place, type RoomModelTier, type Stop } from '@faresight/shared';
import { api } from '../api';
import { categoryLabel, coverage, servesDishes } from '../data';
import { button, el, errorText, haptic, icon, iconButton, motion, replay, svg, wait, type IconName } from '../dom';
import { prepareImage } from '../photos';
import { scans } from '../store';
import { withCode } from '../ui/CodeSheet';

type Kind = 'room' | 'dish';
interface Shot {
  file: File;
  url: string;
  node: HTMLElement;
  uploadId?: string;
}

const MIN_ROOM_PHOTOS = 2;
const NEW_DISH = '';
const tips: Record<Kind, string[]> = {
  room: [
    'Walk a slow arc around the room and take a photo every few steps.',
    'Let each photo overlap the one before it by about half.',
    'Keep the light steady and wait for people to move out of frame.',
  ],
  dish: [
    'Use one dish on a clear table, with the whole plate in frame.',
    'Shoot from a low angle, about 45 degrees, not straight down.',
    'Avoid hard shadows and hands or cutlery crossing the plate.',
  ],
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
  private readonly guide = el('ol', 'tips');
  private readonly grid = el('div', 'photo-grid');
  private readonly count = el('span', 'photo-count');
  private readonly options = el('section', 'options');
  private readonly feedback = el('p', 'form-error');
  private readonly send: HTMLButtonElement;
  private readonly sendLabel = el('span');
  private readonly dishName = el('input', 'text-input');
  private readonly diameter = el('input', 'text-input');
  private kind: Kind;
  private tier: RoomModelTier = 'atlas-draft';
  private dishId: string;
  private busy = false;
  private finished = false;
  private alive = true;

  constructor(
    private readonly place: Place,
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
    title.append(el('h1', '', place.name), el('p', 'view-sub', `${categoryLabel(place)} · ${stop.name} · ${place.walk_from_stop_m} m from the stop`));
    head.append(iconButton('back', `Back to ${stop.name}`, actions.back, 'head-back'), title);

    const body = el('div', 'venue-body');
    if (this.kinds.length > 1) body.append(this.kindPicker(status));
    else body.append(this.statusNote(status.room));

    const photos = el('section', 'photo-section');
    const photoHead = el('div', 'section-head');
    photoHead.append(el('h2', '', 'Photos'), this.count);
    photos.append(photoHead, this.grid);

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

    body.append(this.guide, photos, this.options);

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
    for (const shot of [...this.shots.room, ...this.shots.dish]) URL.revokeObjectURL(shot.url);
  }

  private get current() { return this.shots[this.kind]; }

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
    this.guide.replaceChildren(...tips[this.kind].map((tip) => el('li', '', tip)));
    replay(this.guide, 'is-swapping');
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
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.value = '';
      this.add(files);
    });
    tile.append(input, icon(symbol), el('span', '', label));
    return tile;
  }

  private renderGrid() {
    const shots = this.current;
    const full = this.kind === 'room' && shots.length >= MAX_ROOM_PHOTOS;
    const tiles: HTMLElement[] = shots.map((shot) => shot.node);
    if (!full) tiles.push(this.picker('camera', shots.length && this.kind === 'dish' ? 'Retake' : 'Camera', true),
      this.picker('image', 'Library', false));
    this.grid.replaceChildren(...tiles);

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

  private async submit() {
    if (this.busy || this.finished || this.problem()) return;
    const kind = this.kind;
    const shots = [...this.current];
    this.busy = true;
    this.feedback.textContent = '';
    this.root.classList.add('is-sending');
    this.renderGrid();
    try {
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
      scans.add({
        id: job.id, placeId: this.place.id, placeName: this.place.name, stopId: this.stop.stop_id, kind,
        label: kind === 'room' ? 'The space' : dish, photoCount: uploadIds.length, createdAt: job.created_at,
      }, job);
      this.finished = true;
      this.send.classList.add('is-done');
      this.send.prepend(icon('check'));
      this.renderFooter({ label: 'Scan started', fraction: 1 });
      haptic([10, 50, 18]);
      await wait(motion(850));
      if (this.alive) this.actions.done(job.id);
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
