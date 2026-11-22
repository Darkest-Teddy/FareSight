import { demoDishPhotoSources, demoDishPriceSources } from '@faresight/shared';
import { button, element, link, modal, section } from './dom';

export function attribution(openModeration: () => void) {
  const surface = modal('Credits & privacy');
  const credits = section('Credits');
  const links = element('ul', 'credit-list');
  for (const [label, url] of [
    ['OpenStreetMap contributors (ODbL)', 'https://www.openstreetmap.org/copyright'],
    ['MBTA V3 API and GTFS', 'https://www.mbta.com/developers'],
    ['PlayCanvas', 'https://playcanvas.com/'],
    ['WebXR Input Profiles (MIT)', 'https://github.com/immersive-web/webxr-input-profiles'],
    ['World Labs Atlas', 'https://docs.atlas.worldlabs.ai/'],
    ['Replicate TRELLIS', 'https://replicate.com/firtoz/trellis'],
    ['Google Gemini', 'https://ai.google.dev/'],
    ['OpenAI Live API (gpt-live-1.1)', 'https://platform.openai.com/'],
    ['SplatTransform', 'https://github.com/playcanvas/splat-transform'],
    ['Inter', 'https://rsms.me/inter/'],
  ]) {
    const item = element('li');
    item.append(link(label, url));
    links.append(item);
  }
  credits.append(links);
  const roomCredits = section('Dining room previews');
  roomCredits.append(element('p', '', 'The El Jefe’s Taqueria, Shu Daxia Hot Pot, and Starbucks (Warren Towers) previews were AI-completed with World Labs Atlas from restaurant photos. Room dimensions are approximate.'));
  const dishCredits = section('Demo-only dish preview sources');
  dishCredits.append(element('p', '', 'These previews were reconstructed from restaurant marketing photos. Copyright belongs to the respective owners. The previews are for demo use only. Public release requires permission.'));
  for (const { venue, pricingUrl, items } of demoDishPhotoSources) {
    const group = element('details', 'dish-source-group');
    group.append(element('summary', '', `${venue} · ${items.length} dishes`));
    if (pricingUrl) {
      const pricing = element('p', 'muted', 'Published prices from ');
      pricing.append(link('the restaurant’s Chowbus menu', pricingUrl), '.');
      group.append(pricing);
    }
    const sourcePhotos = element('ul', 'credit-list');
    for (const { name, url } of items) {
      const item = element('li');
      item.append(link(name, url));
      sourcePhotos.append(item);
    }
    group.append(sourcePhotos);
    dishCredits.append(group);
  }
  const priceCredits = section('Menu price sources');
  if (demoDishPriceSources.length) {
    priceCredits.append(element('p', '', 'Where a venue publishes no price of its own, a web-search agent looked the price up and recorded the page it read. Prices drift, and a third-party listing can be stale or carry a delivery markup, so treat these as a guide rather than a quote.'));
    for (const { venue, items } of demoDishPriceSources) {
      const group = element('details', 'dish-source-group');
      group.append(element('summary', '', `${venue} · ${items.length} prices`));
      const list = element('ul', 'credit-list');
      for (const { name, price, source, url } of items) {
        const item = element('li');
        item.append(`${name} — $${price.toFixed(2)} from `, link(source, url));
        list.append(item);
      }
      group.append(list);
      priceCredits.append(group);
    }
  }
  const privacy = section('Photos and privacy');
  privacy.append(
    element('p', '', 'Upload photos you own or have permission to use. Avoid faces, addresses, and other private details. In live mode, the generation services may receive your photos to select references or produce a 3D preview.'),
    element('p', '', 'The team reviews previews before they appear in the restaurant catalog. To request removal of a photo, preview, or visit note, contact the FareSight team at the demo with the venue and item name.'),
    element('p', '', 'GPS is optional. FareSight uses your position to find a nearby stop and estimate the walk there. Pairing shares the venue or trip you choose with the device using your code.'),
    element('p', '', 'Live AI voice streams your microphone audio directly to OpenAI over WebRTC only while a live session is active. End the session at any time to disconnect the microphone.'),
  );
  surface.body.append(credits, roomCredits, dishCredits,
    ...(demoDishPriceSources.length ? [priceCredits] : []), privacy, button('Open moderation', () => { surface.dialog.close(); openModeration(); }, 'quiet'));
  return surface;
}
