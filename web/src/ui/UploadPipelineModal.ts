import { MAX_ROOM_PHOTOS, ROOM_PHOTO_REQUIREMENT } from '@faresight/shared';
import type { Asset, GenerationJob, IntakeSelectionResult, JobStage, Place, RoomModelTier } from '@faresight/shared';
import { api, assetUrl, type Upload } from '../api/client';
import { sampleDemoPhotos } from './demoPhotos';
import { button, element, errorText, field, message, modal, option, section } from './dom';

const stages: [JobStage, string][] = [
  ['queued', 'Queued'], ['generating', 'Generating'], ['downloading', 'Downloading'],
  ['converting', 'Converting'], ['needs_review', 'Needs review'], ['ready', 'Ready'],
];
const pollingStages = new Set<JobStage>(['queued', 'generating', 'downloading', 'converting']);
const maxUploads = MAX_ROOM_PHOTOS + 1;

interface UploadActions {
  places(): Place[];
  published(job: GenerationJob, open: boolean): Promise<void>;
}

export class UploadPipelineModal {
  private readonly surface = modal('Upload 3D', 'studio');
  private readonly place = element('select');
  private readonly passcode = element('input');
  private readonly file = element('input');
  private readonly photoList = element('div', 'photo-grid');
  private readonly intakeDetails = element('div', 'intake-details');
  private readonly feedback = message('');
  private readonly roomTier = element('select');
  private readonly dish = element('select');
  private readonly dishName = element('input');
  private readonly newDishField = field('New dish name', this.dishName);
  private readonly diameter = element('input');
  private readonly history = element('select');
  private readonly monitor = element('div', 'job-monitor');
  private readonly sample: HTMLButtonElement;
  private readonly auto: HTMLButtonElement;
  private readonly roomButton: HTMLButtonElement;
  private readonly dishButton: HTMLButtonElement;
  private readonly uploadSets = new Map<string, Upload[]>();
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly sourceUrls = new Map<string, string[]>();
  private readonly roomIds = new Set<string>();
  private dishId = '';
  private selectedJob = '';
  private jobRequest = 0;
  private selectedAsset?: Asset;
  private intake?: IntakeSelectionResult;
  private busy = false;
  private pollTimer?: number;

  constructor(private readonly actions: UploadActions) {
    const { body, dialog } = this.surface;
    const photos = section('1. Add reference photos');
    this.passcode.type = 'password';
    this.passcode.autocomplete = 'off';
    this.passcode.placeholder = 'If configured on the server';
    this.place.addEventListener('change', () => this.changePlace());
    photos.append(field('Restaurant or venue', this.place), field('Studio passcode', this.passcode));
    const drop = element('label', 'drop-zone');
    this.file.type = 'file';
    this.file.accept = 'image/jpeg,image/png,image/webp';
    this.file.multiple = true;
    drop.append(element('strong', '', 'Drop photos here or choose files'), this.file, element('small', '', 'JPEG, PNG or WebP · up to 8 MiB each'));
    this.file.addEventListener('change', () => {
      const files = Array.from(this.file.files ?? []);
      this.file.value = '';
      void this.run(() => this.upload(files));
    });
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('dragging');
      void this.run(() => this.upload(Array.from(event.dataTransfer?.files ?? [])));
    });
    this.sample = button('Load sample demo photo set', () => void this.run(async () => {
      this.note('Preparing illustrated demo references…');
      await this.upload(await sampleDemoPhotos());
    }));
    photos.append(drop, this.sample, element('p', 'muted', 'Sample illustrations depict fictional scenes for pipeline testing.'), this.feedback);

    const select = section('2. Choose generation inputs');
    this.auto = button('Auto-select with Gemini (gemini-4-hydrogen)', () => void this.run(() => this.autoSelect()));
    select.append(this.auto, this.intakeDetails, this.photoList);

    const generate = section('3. Generate a 3D preview');
    this.dish.addEventListener('change', () => this.refreshControls());
    this.dishName.maxLength = 120;
    this.dishName.addEventListener('input', () => this.refreshControls());
    this.diameter.type = 'number';
    this.diameter.min = '0.1';
    this.diameter.max = '200';
    this.diameter.step = 'any';
    this.diameter.placeholder = 'Optional';
    this.roomTier.append(option('atlas-draft', 'Atlas Draft (~30s, 2-32 photos)'), option('atlas-refined', 'Atlas Refined (~18m, high-res)'));
    this.roomButton = button('Generate room (Atlas)', () => void this.run(() => this.generate('room')), 'accent');
    this.dishButton = button('Generate dish (TRELLIS)', () => void this.run(() => this.generate('dish')), 'accent');
    const generateActions = element('div', 'button-row');
    generateActions.append(this.roomButton, this.dishButton);
    generate.append(field('Room quality', this.roomTier), element('p', 'muted', ROOM_PHOTO_REQUIREMENT),
      field('Dish to publish', this.dish), this.newDishField, field('Known plate diameter (cm)', this.diameter), generateActions);

    const monitor = section('4. Monitor and review');
    this.history.addEventListener('change', () => { void this.selectJob(this.history.value); });
    monitor.append(field('Generation job', this.history), this.monitor);
    body.append(photos, select, generate, monitor);
    dialog.addEventListener('close', () => window.clearTimeout(this.pollTimer));
  }

  open(placeId?: string) {
    if (!this.busy) this.reconcilePlaces(placeId);
    this.surface.open();
    void this.loadJobs();
  }

  close() { if (this.surface.dialog.open) this.surface.dialog.close(); }

  private reconcilePlaces(placeId?: string) {
    const old = this.place.value;
    const choices = this.actions.places();
    this.place.replaceChildren(...choices.map((place) => option(place.id, place.name)));
    const preferred = choices.find((place) => place.seed_status === 'demo_venue')?.id ?? choices[0]?.id ?? '';
    this.place.value = [placeId, old, preferred].find((id) => choices.some((place) => place.id === id)) ?? '';
    if (old !== this.place.value) this.changePlace();
    else this.refreshControls();
  }

  private changePlace() {
    this.intake = undefined;
    this.roomIds.clear();
    this.dishId = '';
    this.dishName.value = '';
    this.diameter.value = '';
    const place = this.actions.places().find((entry) => entry.id === this.place.value);
    this.dish.replaceChildren(...(place?.dishes.map((entry) => option(entry.id, entry.name)) ?? []), option('', 'New dish'));
    this.note('');
    this.renderPhotos();
    this.refreshControls();
  }

  private get uploads() { return this.uploadSets.get(this.place.value) ?? []; }

  private refreshControls() {
    this.place.disabled = this.busy || !this.place.options.length;
    this.file.disabled = this.sample.disabled = this.busy || !this.place.value || this.uploads.length >= maxUploads;
    this.auto.disabled = this.busy || !this.uploads.length;
    this.roomTier.disabled = this.dish.disabled = this.dishName.disabled = this.diameter.disabled = this.busy;
    this.newDishField.hidden = this.dish.value !== '';
    this.roomButton.disabled = this.busy || this.roomIds.size < 2 || this.roomIds.size > MAX_ROOM_PHOTOS;
    this.dishButton.disabled = this.busy || !this.dishId || (!this.dish.value && !this.dishName.value.trim());
    this.monitor.querySelectorAll<HTMLButtonElement>('[data-mutation]').forEach((control) => {
      control.disabled = this.busy;
    });
  }

  private note(text: string, problem = false) {
    this.feedback.textContent = text;
    this.feedback.classList.toggle('error', problem);
  }

  private async run(action: () => Promise<void>) {
    if (this.busy || !this.place.value) return;
    this.busy = true;
    this.refreshControls();
    try { await action(); }
    catch (error) {
      this.note(errorText(error), true);
      this.feedback.scrollIntoView({ block: 'nearest' });
    } finally {
      this.busy = false;
      this.refreshControls();
    }
  }

  private async upload(files: File[]) {
    if (!files.length) return;
    const place = this.place.value;
    const uploads = this.uploadSets.get(place) ?? [];
    this.uploadSets.set(place, uploads);
    const errors: string[] = [];
    let received = 0;
    for (const file of files) {
      if (uploads.length >= maxUploads) { errors.push(`The photo set is limited to ${maxUploads} uploads.`); break; }
      if (file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        errors.push(file.name + ' must be a JPEG, PNG or WebP under 8 MiB.');
        continue;
      }
      this.note('Uploading ' + file.name + '…');
      try {
        const upload = await api.upload(place, file, this.passcode.value);
        if (!uploads.some((entry) => entry.id === upload.id)) uploads.push(upload);
        received++;
      } catch (error) { errors.push(file.name + '. ' + errorText(error)); }
    }
    if (received) this.intake = undefined;
    this.renderPhotos();
    this.note(errors.length ? errors.slice(0, 3).join(' ') : `${uploads.length} photos in this set. Choose inputs manually or run auto-selection.`, errors.length > 0);
  }

  private async autoSelect() {
    this.note('Checking photos for distinct rooms and dishes…');
    this.intake = await api.intake(this.place.value, this.uploads.map((upload) => upload.id), this.passcode.value);
    this.roomIds.clear();
    for (const id of this.intake.recommended_room_upload_ids) this.roomIds.add(id);
    this.dishId = this.intake.recommended_dish_upload_id ?? '';
    this.renderPhotos();
    this.note('Selection ready. Review the suggested inputs before generating.');
  }

  private renderPhotos() {
    this.photoList.replaceChildren();
    this.intakeDetails.replaceChildren();
    if (!this.uploads.length) this.photoList.append(message('No reference photos yet. Add photos or load the sample set.'));
    if (this.intake) {
      const usedGemini = this.intake.used_model.toLowerCase().startsWith('gemini');
      this.intakeDetails.append(message(usedGemini ? `Selected by ${this.intake.used_model}. You can change any selection.` : 'Gemini was unavailable for this set. Filename and image-size suggestions are shown for manual review.'));
      for (const group of this.intake.room_groups) {
        const names = group.upload_ids.map((id) => this.uploads.find((upload) => upload.id === id)?.filename ?? id);
        this.intakeDetails.append(element('p', '', `${group.label} · ${names.join(', ')}. ${group.reason}`));
      }
      if (!this.intake.room_groups.length) this.intakeDetails.append(message('No compatible room group was suggested.'));
      if (!this.intake.recommended_dish_upload_id) this.intakeDetails.append(message('No dish photo was suggested.'));
    }
    for (const upload of this.uploads) {
      const card = element('article', 'photo-card');
      card.append(imagePreview(upload.url, upload.filename), element('strong', '', upload.filename));
      const flag = this.intake?.flagged.find((entry) => entry.upload_id === upload.id);
      if (flag) card.append(element('p', 'muted', `${flag.category} · ${flag.reason}`));
      const room = element('input');
      room.type = 'checkbox';
      room.checked = this.roomIds.has(upload.id);
      const roomLabel = element('label', 'check');
      roomLabel.append(room, 'Use for room');
      room.addEventListener('change', () => {
        if (room.checked) this.roomIds.add(upload.id);
        else this.roomIds.delete(upload.id);
        this.refreshControls();
      });
      const dish = element('input');
      dish.type = 'radio';
      dish.name = 'dish-photo';
      dish.checked = this.dishId === upload.id;
      const dishLabel = element('label', 'check');
      dishLabel.append(dish, 'Use for dish');
      dish.addEventListener('change', () => { this.dishId = upload.id; this.refreshControls(); });
      card.append(roomLabel, dishLabel);
      this.photoList.append(card);
    }
  }

  private async generate(kind: 'room' | 'dish') {
    const ids = kind === 'room' ? [...this.roomIds] : [this.dishId];
    const dish = kind === 'dish';
    if (!dish && (ids.length < 2 || ids.length > MAX_ROOM_PHOTOS)) throw new Error(ROOM_PHOTO_REQUIREMENT);
    const diameter = this.diameter.valueAsNumber;
    if (dish && this.diameter.validity.badInput) throw new Error('Enter a valid diameter in centimeters.');
    if (dish && this.diameter.value && !this.diameter.checkValidity()) throw new Error('Enter a plate diameter between 0.1 and 200 cm.');
    this.note(`Queuing ${kind} generation…`);
    const job = await api.generate({
      kind, place_id: this.place.value, upload_ids: ids,
      dish_id: dish && this.dish.value ? this.dish.value : undefined,
      dish_name: dish && !this.dish.value ? this.dishName.value.trim() : undefined,
      plate_diameter_m: dish && Number.isFinite(diameter) ? diameter / 100 : undefined,
      model_tier: dish ? undefined : this.roomTier.value as RoomModelTier,
    }, this.passcode.value);
    this.sourceUrls.set(job.id, this.uploads.filter((upload) => ids.includes(upload.id)).map((upload) => upload.url));
    this.jobs.set(job.id, job);
    this.renderHistory(job.id);
    this.note('Job queued. Follow its progress in the monitor.');
    await this.selectJob(job.id, job);
    this.monitor.scrollIntoView({ block: 'nearest' });
  }

  private async loadJobs() {
    const current = this.selectedJob;
    if (!current) this.monitor.replaceChildren(message('Loading generation jobs…'));
    try {
      for (const job of await api.jobs()) this.jobs.set(job.id, job);
      if (!this.surface.dialog.open) return;
      const selected = this.selectedJob || this.jobs.keys().next().value || '';
      this.renderHistory(selected);
      await this.selectJob(selected);
    } catch (error) {
      if (!current) this.monitor.replaceChildren(message('Could not list jobs. ' + errorText(error), true), button('Reload jobs', () => void this.loadJobs()));
      else this.schedulePoll();
    }
  }

  private renderHistory(selected: string) {
    const jobs = [...this.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    this.history.replaceChildren(option('', 'Choose a job'), ...jobs.map((job) => {
      const place = this.actions.places().find((entry) => entry.id === job.place_id)?.name ?? job.place_id;
      return option(job.id, `${place} · ${job.dish_name || job.kind} · ${job.id.slice(0, 8)}`);
    }));
    this.history.value = selected;
  }

  private async selectJob(id: string, known?: GenerationJob) {
    window.clearTimeout(this.pollTimer);
    const request = ++this.jobRequest;
    const changed = id !== this.selectedJob;
    this.selectedJob = id;
    if (changed) this.selectedAsset = undefined;
    if (!id) {
      this.monitor.replaceChildren(message('No job selected. Start a generation job or choose one to resume.'));
      return;
    }
    if (changed) this.monitor.replaceChildren(message('Loading job…'));
    try {
      const job = known ?? await api.job(id);
      if (request !== this.jobRequest || !this.surface.dialog.open) return;
      this.jobs.set(id, job);
      if (job.asset_id && this.selectedAsset?.id !== job.asset_id) {
        try {
          const asset = await api.asset(job.asset_id);
          if (request !== this.jobRequest || !this.surface.dialog.open) return;
          this.selectedAsset = asset;
        } catch { /* The job remains inspectable while its asset metadata is unavailable. */ }
      }
      this.renderJob(job);
      this.schedulePoll();
    } catch (error) {
      if (request !== this.jobRequest || !this.surface.dialog.open) return;
      this.monitor.replaceChildren(message('Could not refresh job. ' + errorText(error), true), button('Retry job status', () => void this.selectJob(id)));
    }
  }

  private schedulePoll() {
    const job = this.jobs.get(this.selectedJob);
    if (this.surface.dialog.open && job && pollingStages.has(job.status)) {
      this.pollTimer = window.setTimeout(() => void this.selectJob(job.id), 1400);
    }
  }

  private renderJob(job: GenerationJob) {
    const asset = this.selectedAsset;
    const statusIndex = job.status === 'failed' ? -1 : stages.findIndex(([stage]) => stage === job.status);
    const steps = element('ol', 'pipeline-steps');
    stages.forEach(([, label], index) => {
      const step = element('li', index < statusIndex ? 'complete' : '', label);
      if (index === statusIndex) step.setAttribute('aria-current', 'step');
      steps.append(step);
    });
    const progress = element('progress');
    progress.max = 100;
    progress.value = job.progress;
    progress.setAttribute('aria-label', 'Generation progress');
    const status = element('p', 'readout', `${job.progress}% · ${job.status_message}`);
    const overlay = element('div', 'job-data');
    overlay.append(
      element('p', 'muted', `Provider · ${job.provider === 'demo-sim' ? 'Demo simulation' : job.provider}`),
      element('p', 'muted', `Provider task ID · ${job.provider_task_id || 'Not assigned'}`),
      element('p', 'muted', `Gaussians · ${asset?.gaussian_count ? asset.gaussian_count.toLocaleString() : 'Count unavailable'}`),
      element('p', 'muted', `Scale · ${asset?.scale_label ?? 'Awaiting asset inspection'}`),
    );
    if (job.error) overlay.append(message(job.error, true));
    if (job.status === 'failed') {
      const retry = button('Retry from saved stage', () => void this.run(async () => {
        await this.selectJob(job.id, await api.retry(job.id, this.passcode.value));
      }));
      retry.dataset.mutation = '';
      overlay.append(retry);
    }

    const images = element('div', 'inspection-grid');
    const sources = asset?.source_photos?.length ? asset.source_photos : this.sourceUrls.get(job.id) ?? [];
    const rawPreview = job.preview_image_path;
    const preview = asset?.preview_url ?? (rawPreview?.startsWith('/storage/') || rawPreview?.startsWith('http')
      ? rawPreview
      : rawPreview ? '/storage/outputs/' + encodeURIComponent(rawPreview.split('/').at(-1) ?? '') : undefined);
    images.append(inspection('Source photo', sources, 'No source image is available for this job.'),
      inspection(job.provider === 'demo-sim' ? 'Demo preview' : 'Generated preview', preview ? [preview] : [], 'Preview image has not arrived.'));
    if (job.provider === 'demo-sim') images.append(message('Demo jobs use a prebuilt 3D asset. The preview image may repeat the reference.'));
    const publish = section('5. Publish');
    if (asset?.status === 'rejected') publish.append(message('This asset was rejected during review.', true));
    else if (job.status === 'needs_review' && job.asset_id) {
      const action = button('Publish to restaurant manifest', () => void this.run(async () => {
        this.note('Publishing reviewed asset…');
        await api.publish(job.asset_id!, { approve: true }, this.passcode.value);
        this.selectedAsset = undefined;
        await this.selectJob(job.id);
        await this.actions.published(this.jobs.get(job.id) ?? job, false);
        this.note('Asset published to the restaurant manifest.');
      }), 'accent');
      action.dataset.mutation = '';
      publish.append(element('p', 'muted', 'Review the source and preview before publishing.'), action);
    } else if (job.status === 'ready') {
      publish.append(message('Published to the restaurant manifest.'), button('Open in 3D viewer', () => void this.run(async () => {
        await this.actions.published(job, true);
        this.surface.dialog.close();
      }), 'accent'));
    } else publish.append(message('The asset becomes publishable after conversion and review.'));
    this.monitor.replaceChildren(steps, progress, status, overlay, images, publish);
    this.refreshControls();
  }
}

function imagePreview(path: string, label: string) {
  const frame = element('div', 'image-frame');
  const unavailable = () => frame.replaceChildren(message('Image unavailable.', true));
  try {
    const image = element('img');
    image.alt = label;
    image.loading = 'lazy';
    image.addEventListener('error', unavailable, { once: true });
    image.src = assetUrl(path);
    frame.append(image);
  } catch { unavailable(); }
  return frame;
}

function inspection(title: string, paths: string[], empty: string) {
  const item = element('section', 'inspection');
  item.append(element('h4', '', title));
  if (paths.length) item.append(...paths.map((path, index) => imagePreview(path, `${title} ${index + 1}`)));
  else item.append(message(empty));
  return item;
}
