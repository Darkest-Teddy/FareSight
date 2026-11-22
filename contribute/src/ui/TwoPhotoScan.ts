import { button, el, haptic, iconButton, svg } from '../dom';
import { dishPlans, type DishPlan } from '../scan/dish';
import { dishGlyphs, openDishScan } from './GuidedScan';

// What to say before each of the two photos. Nothing checks where the phone is: the 3D build works
// out how the two views relate from the photos themselves, so these lines only ask for two views that
// differ enough to show the dish's top and its sides.
const prompts: Record<DishPlan['shape'], [first: string, second: string]> = {
  plate: ['Photo 1: from where you sit, at a slant', 'Photo 2: from straight above, phone flat'],
  bowl: ['Photo 1: from above the rim, so the filling shows', 'Photo 2: the same, from the opposite side'],
  drink: ['Photo 1: side on, from near table level', 'Photo 2: the same, from the opposite side'],
};

interface Card {
  title: string;
  lines: string[];
  choices?: { glyph: string; title: string; note: string; action: () => void }[];
  primary?: [label: string, action: () => void];
  secondary?: [label: string, action: () => void];
  /** A quiet third action, under the other two. */
  link?: [label: string, action: () => void];
}

/**
 * Full-screen two-photo scan of one dish or drink. The person taps the shutter twice, from two
 * different sides. It uses the camera only: no motion sensors, no dots to aim at.
 */
class TwoPhotoScan {
  private readonly dialog = el('dialog', 'sweep-dialog snap-dialog');
  private readonly video = el('video', 'sweep-video');
  private readonly outline = el('div', 'snap-outline');
  private readonly count = el('p', 'sweep-count');
  private readonly hint = el('p', 'sweep-hint');
  private readonly card = el('section', 'sweep-card');
  private readonly slots = [0, 1].map((index) => button('', () => this.retake(index), 'snap-slot'));
  private readonly shutter = button('', () => void this.capture(), 'snap-shutter');
  private readonly finishButton = button('', () => this.settle(this.files), 'primary small');
  private readonly shots: ({ file: File; url: string } | undefined)[] = [undefined, undefined];
  private plan?: DishPlan;
  private stream?: MediaStream;
  /** Development stand-in for the camera, on a page that may not open the real one. */
  private simulated = false;
  private live = false;
  private capturing = false;
  private settled = false;

  constructor(private readonly resolve: (files: File[]) => void) {
    this.dialog.setAttribute('aria-label', 'Two-photo dish scan');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('aria-hidden', 'true');
    this.outline.setAttribute('aria-hidden', 'true');
    this.count.setAttribute('aria-live', 'polite');
    this.hint.setAttribute('aria-live', 'polite');
    this.shutter.setAttribute('aria-label', 'Take the photo');
    const top = el('header', 'sweep-top');
    top.append(iconButton('close', 'Close the scan', () => this.requestClose(), 'sweep-close'), this.count);
    const taken = el('div', 'snap-slots');
    taken.append(...this.slots);
    const bar = el('footer', 'sweep-bar snap-bar');
    bar.append(taken, this.shutter, this.finishButton);
    this.dialog.append(this.video, this.outline, top, this.hint, bar, this.card);
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.requestClose();
    });
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.update();
    this.pickShape();
  }

  private get files() { return this.shots.flatMap((shot) => shot ? [shot.file] : []); }

  private pickShape() {
    this.show({
      title: 'What are you scanning?',
      lines: ['Pick the closest shape. It decides which two sides to photograph.'],
      choices: dishPlans.map((plan) => ({
        glyph: dishGlyphs[plan.shape], title: plan.name, note: plan.examples, action: () => this.introduce(plan),
      })),
      secondary: ['Not now', () => this.settle([])],
    });
  }

  private introduce(plan: DishPlan) {
    this.plan = plan;
    const [width, height] = plan.outline;
    this.outline.style.width = `${width * 100}vmin`;
    this.outline.style.height = `${height * 100}vmin`;
    this.outline.style.borderRadius = plan.shape === 'drink' ? '30% / 16%' : '50%';
    const overhead = plan.rings.some(([elevation]) => elevation >= 90);
    this.show({
      title: 'Just take two photos',
      lines: [
        'Put it on a clear part of the table, with nothing in front of it.',
        overhead ? 'Take one photo from where you sit and one from straight above.'
          : 'Take one photo from where you sit and one from the opposite side.',
        'You do not have to line anything up. The 3D build works out how the two photos fit together.',
      ],
      primary: ['Open camera', () => void this.start()],
      secondary: ['Change shape', () => this.pickShape()],
      link: ['Guide me to each angle instead', () => this.guided(plan)],
    });
  }

  /** Hands over to the scan that leads the phone to each angle with its motion sensors. */
  private guided(plan: DishPlan) {
    if (this.settled) return;
    this.settled = true;
    this.release();
    this.dialog.close();
    this.dialog.remove();
    void openDishScan(1, plan).then(this.resolve);
  }

  private show(card?: Card) {
    this.card.hidden = !card;
    this.dialog.dataset.card = String(Boolean(card));
    if (!card) return;
    const body = el('div', 'sweep-lines');
    body.append(...card.lines.map((line) => el('p', '', line)));
    const parts: HTMLElement[] = [el('h2', '', card.title), body];
    if (card.choices) {
      const list = el('div', 'sweep-choices');
      for (const choice of card.choices) {
        const option = button('', choice.action, 'sweep-choice');
        const glyph = svg('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' });
        glyph.append(svg('path', { d: choice.glyph }));
        const text = el('span');
        text.append(el('strong', '', choice.title), el('small', '', choice.note));
        option.append(glyph, text);
        list.append(option);
      }
      parts.push(list);
    }
    const primary = card.primary && button(card.primary[0], card.primary[1], 'primary');
    const actions = el('div', 'sheet-actions');
    if (primary) actions.append(primary);
    if (card.secondary) actions.append(button(card.secondary[0], card.secondary[1], 'ghost'));
    if (card.link) actions.append(button(card.link[0], card.link[1], 'ghost snap-link'));
    this.card.replaceChildren(...parts, actions);
    (primary ?? this.card.querySelector<HTMLButtonElement>('.sweep-choice'))?.focus();
  }

  private async start() {
    this.show();
    this.hint.textContent = 'Starting the camera…';
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      if (!import.meta.env.DEV) return this.fail('This page cannot open the camera. It needs a secure (https) connection.');
      this.simulated = true;
      this.dialog.dataset.simulated = 'true';
      this.dialog.dataset.simulatedWhy = `This page is not secure (https), so the camera is blocked. Open https://${location.hostname}:5181 for the real one.`;
    } else {
      try {
        await this.connectCamera();
      } catch {
        if (this.settled) return;
        return this.fail('The camera could not be opened. Allow camera access for this site and try again.');
      }
      if (this.settled) return;
    }
    this.live = true;
    this.update();
  }

  private fail(reason: string) {
    this.release();
    this.live = false;
    this.show({
      title: 'The camera is not available',
      lines: [reason, 'You can still add photos with Camera or Library.'],
      primary: ['Back to photos', () => this.settle(this.files)],
    });
  }

  private async connectCamera() {
    this.disconnectCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (this.settled) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', this.onEnded);
    this.video.srcObject = stream;
    await this.video.play();
  }

  private disconnectCamera() {
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', this.onEnded);
      track.stop();
    }
    this.stream = undefined;
    this.video.srcObject = null;
  }

  private readonly onEnded = () => {
    if (this.settled || !this.live) return;
    this.live = false;
    this.update();
    const count = this.files.length;
    this.show({
      title: 'Camera disconnected',
      lines: [count ? 'The photos you took are still in this scan.' : 'Reconnect to keep going.'],
      primary: ['Reconnect camera', () => void this.start()],
      secondary: count ? [`Use ${count} ${count === 1 ? 'photo' : 'photos'}`, () => this.settle(this.files)] : undefined,
    });
  };

  private readonly onVisibility = () => {
    if (document.hidden || !this.live || this.simulated || !this.video.paused) return;
    void this.video.play().catch(this.onEnded);
  };

  /** Development only: a flat frame that says which photo it stands for. */
  private simulatedFrame(index: number) {
    const frame = document.createElement('canvas');
    frame.width = 720;
    frame.height = 1280;
    const context = frame.getContext('2d')!;
    context.fillStyle = `hsl(${index * 150 + 20} 55% 40%)`;
    context.fillRect(0, 0, frame.width, frame.height);
    context.fillStyle = '#fff';
    context.font = '600 44px sans-serif';
    context.fillText(`Simulated photo ${index + 1}`, 40, frame.height / 2);
    return frame;
  }

  private async capture() {
    const index = this.shots.findIndex((shot) => !shot);
    if (index < 0 || !this.live || this.capturing || !this.card.hidden) return;
    const source = this.simulated ? this.simulatedFrame(index) : this.video;
    const width = this.simulated ? 720 : this.video.videoWidth;
    const height = this.simulated ? 1280 : this.video.videoHeight;
    if (!width || !height) return;
    const shot = document.createElement('canvas');
    shot.width = width;
    shot.height = height;
    const context = shot.getContext('2d');
    if (!context) return;
    this.capturing = true;
    let blob: Blob | null = null;
    try {
      context.drawImage(source, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => shot.toBlob(resolve, 'image/jpeg', 0.9));
    } catch { /* A frame that cannot be read is treated like a missed tap. */ } finally {
      this.capturing = false;
    }
    if (!blob || this.settled || this.shots[index]) return;
    const file = new File([blob], `dish-photo-${String(index + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' });
    this.shots[index] = { file, url: URL.createObjectURL(file) };
    haptic(12);
    // A white blink, as a camera does, so the tap is seen to have taken.
    this.dialog.classList.remove('is-flash');
    void this.dialog.offsetWidth;
    this.dialog.classList.add('is-flash');
    this.update();
    if (this.shots.every(Boolean)) this.complete();
  }

  private retake(index: number) {
    const shot = this.shots[index];
    if (!shot || !this.card.hidden) return;
    URL.revokeObjectURL(shot.url);
    this.shots[index] = undefined;
    this.update();
  }

  private complete() {
    haptic([10, 60, 20]);
    this.show({
      title: 'Both photos taken',
      lines: ['The dish is ready to build. If the two photos look alike, retake the second from another side.'],
      primary: ['Use 2 photos', () => this.settle(this.files)],
      secondary: ['Retake the second', () => {
        this.show();
        this.retake(1);
      }],
    });
    // Both photos side by side, so the person can see whether they show two different sides.
    const pair = el('div', 'snap-pair');
    for (const shot of this.shots) {
      const image = el('img');
      image.src = shot!.url;
      image.alt = '';
      pair.append(image);
    }
    this.card.querySelector('.sheet-actions')?.before(pair);
  }

  private update() {
    const done = this.files.length;
    const next = this.shots.findIndex((shot) => !shot);
    this.count.textContent = this.plan ? `${done} / 2` : '';
    this.hint.textContent = this.live && this.plan && next >= 0 ? prompts[this.plan.shape][next] : '';
    this.shutter.disabled = !this.live || next < 0;
    this.finishButton.textContent = done === 1 ? 'Use 1 photo' : 'Finish';
    this.finishButton.disabled = !done;
    for (const [index, slot] of this.slots.entries()) {
      const shot = this.shots[index];
      slot.disabled = !shot;
      slot.style.backgroundImage = shot ? `url("${shot.url}")` : '';
      slot.textContent = shot ? '' : String(index + 1);
      slot.setAttribute('aria-label', shot ? `Retake photo ${index + 1}` : `Photo ${index + 1}, not taken yet`);
      slot.classList.toggle('is-next', index === next && this.live);
    }
  }

  private requestClose() {
    const count = this.files.length;
    if (!count) return this.settle([]);
    this.show({
      title: 'Discard this scan?',
      lines: [`The ${count} ${count === 1 ? 'photo' : 'photos'} taken so far will be lost.`],
      primary: ['Keep going', () => count === 2 ? this.complete() : this.show()],
      secondary: ['Discard', () => this.settle([])],
    });
  }

  private release() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disconnectCamera();
  }

  private settle(files: File[]) {
    if (this.settled) return;
    this.settled = true;
    this.release();
    for (const shot of this.shots) if (shot) URL.revokeObjectURL(shot.url);
    this.dialog.close();
    this.dialog.remove();
    this.resolve(files);
  }
}

/**
 * Opens the two-photo scan of one dish or drink. Resolves with the photos it took, or with none when
 * it is dismissed. The person can switch to the motion-guided scan from its first screens.
 */
export function openTwoPhotoScan(): Promise<File[]> {
  return new Promise((resolve) => { new TwoPhotoScan(resolve); });
}
