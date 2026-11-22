import type { Place } from '@faresight/shared';
import { api } from '../api';
import { reviewSummary } from '../data';
import { button, el, errorText, haptic, icon, replay, timeAgo } from '../dom';
import { sentReviews } from '../store';

/** Five stars, filled up to a rating. A fraction rounds to the nearest whole star. */
export function stars(rating: number) {
  const node = el('span', 'stars');
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `${rating.toFixed(1)} out of 5`);
  node.append(el('b', '', '★'.repeat(filled)), '★'.repeat(5 - filled));
  return node;
}

/** Bottom sheet with what people say about a place, and the form to add a review of your own. */
class ReviewSheet {
  private readonly dialog = el('dialog', 'sheet-dialog review-sheet');
  private readonly summary = el('p', 'sheet-note');
  private readonly list = el('ul', 'review-list');
  private readonly picker = el('div', 'star-picker');
  private readonly name = el('input', 'text-input');
  private readonly text = el('textarea', 'text-input review-text');
  private readonly feedback = el('p', 'form-error');
  private readonly thanks = el('p', 'form-ok');
  private readonly send: HTMLButtonElement;
  private place?: Place;
  private rating = 0;
  private busy = false;

  constructor() {
    const form = el('form', 'sheet-form');
    const head = el('header', 'sheet-head');
    const badge = el('span', 'sheet-badge');
    badge.append(icon('star'));
    const title = el('h2', '', 'Reviews');
    title.id = 'review-sheet-title';
    head.append(badge, title);
    this.dialog.setAttribute('aria-labelledby', title.id);

    this.picker.setAttribute('role', 'radiogroup');
    this.picker.setAttribute('aria-label', 'Your rating');
    for (let value = 1; value <= 5; value++) {
      const star = button('★', () => {
        this.rating = value;
        this.feedback.textContent = '';
        haptic(6);
        this.renderPicker();
      });
      star.setAttribute('role', 'radio');
      star.setAttribute('aria-label', `${value} ${value === 1 ? 'star' : 'stars'}`);
      this.picker.append(star);
    }
    this.name.type = 'text';
    this.name.maxLength = 80;
    this.name.setAttribute('autocomplete', 'nickname');
    this.name.placeholder = 'Your name';
    this.name.setAttribute('aria-label', 'Your name');
    this.text.maxLength = 1000;
    this.text.rows = 3;
    this.text.placeholder = 'What should people know before they go?';
    this.text.setAttribute('aria-label', 'Your review');
    for (const field of [this.name, this.text]) field.addEventListener('input', () => { this.feedback.textContent = ''; });
    this.feedback.setAttribute('role', 'alert');
    this.thanks.setAttribute('role', 'status');

    this.send = el('button', 'primary', 'Send review');
    this.send.type = 'submit';
    const actions = el('div', 'sheet-actions');
    actions.append(this.send, button('Close', () => this.dialog.close(), 'ghost'));
    form.append(head, this.summary, this.list, el('h3', 'review-yours', 'Your review'),
      this.picker, this.name, this.text, this.feedback, this.thanks, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.dialog.append(form);
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
  }

  open(place: Place) {
    this.place = place;
    this.rating = 0;
    this.name.value = sentReviews.author;
    this.text.value = '';
    this.feedback.textContent = this.thanks.textContent = '';
    this.renderPicker();
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector('.sheet-form')?.scrollTo({ top: 0 });
  }

  private renderPicker() {
    [...this.picker.children].forEach((star, index) => {
      star.classList.toggle('is-on', index < this.rating);
      star.setAttribute('aria-checked', String(index + 1 === this.rating));
    });
  }

  private render() {
    const place = this.place;
    if (!place) return;
    const { rating, source } = reviewSummary(place);
    this.summary.textContent = rating ? `${place.name} · ${rating.toFixed(1)} ★ on ${source}` : place.name;

    const entry = (author: string, text: string, rating: number, note: string, chip?: [label: string, className: string]) => {
      const item = el('li', 'review');
      const head = el('div', 'review-head');
      head.append(el('strong', '', author));
      if (rating > 0) head.append(stars(rating));
      if (chip) head.append(el('span', `review-chip ${chip[1]}`.trim(), chip[0]));
      if (note) head.append(el('small', '', note));
      item.append(head, el('p', '', text));
      return item;
    };
    // The newest first: what this phone sent and is still waiting, then what is already public.
    const waiting = sentReviews.waiting(place.id, place.reviews)
      .map((review) => entry(review.author, review.text, review.rating, '', ['Waiting for approval', 'is-waiting']));
    const published = [...place.reviews].reverse()
      .map((review) => entry(review.author, review.text, review.rating, review.sample ? '' : timeAgo(review.created_at), review.sample ? ['Sample', ''] : undefined));
    this.list.replaceChildren(...waiting, ...published);
    if (!this.list.children.length) this.list.append(el('li', 'review-empty', 'No reviews yet. Be the first to write one.'));
  }

  private fail(text: string, field?: HTMLElement) {
    this.feedback.textContent = text;
    if (field) replay(field, 'is-shaking');
  }

  private async submit() {
    const place = this.place;
    if (!place || this.busy) return;
    const author = this.name.value.trim();
    const text = this.text.value.trim();
    this.thanks.textContent = '';
    if (!this.rating) return this.fail('Pick a star rating first.', this.picker);
    if (!author) return this.fail('Add your name.', this.name);
    if (!text) return this.fail('Write a few words about your visit.', this.text);
    this.busy = true;
    this.send.disabled = true;
    this.send.textContent = 'Sending…';
    try {
      const sent = await api.review(place.id, { author_label: author, text, rating: this.rating });
      sentReviews.add({ id: sent.id, placeId: place.id, author, text, rating: this.rating, createdAt: sent.created_at });
      haptic([8, 40, 12]);
      this.rating = 0;
      this.text.value = '';
      this.renderPicker();
      this.render();
      this.thanks.textContent = 'Thanks. Everyone sees your review once a FareSight admin approves it.';
    } catch (error) {
      this.fail(errorText(error));
    } finally {
      this.busy = false;
      this.send.disabled = false;
      this.send.textContent = 'Send review';
    }
  }
}

export const reviewSheet = new ReviewSheet();
