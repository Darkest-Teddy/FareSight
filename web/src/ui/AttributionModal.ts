import { button, element, link, modal, section } from './dom';

export function attribution(openModeration: () => void) {
  const surface = modal('Credits & privacy');
  const credits = section('Credits');
  const links = element('ul', 'credit-list');
  for (const [label, url] of [
    ['OpenStreetMap contributors (ODbL)', 'https://www.openstreetmap.org/copyright'],
    ['MBTA V3 API and GTFS', 'https://www.mbta.com/developers'],
    ['PlayCanvas', 'https://playcanvas.com/'],
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
  const privacy = section('Photos and privacy');
  privacy.append(
    element('p', '', 'Upload photos you own or have permission to use. Avoid faces, addresses, and other private details. In live mode, the generation services may receive your photos to select references or produce a 3D preview.'),
    element('p', '', 'The team reviews previews before they appear in the restaurant catalog. To request removal of a photo, preview, or visit note, contact the FareSight team at the demo with the venue and item name.'),
    element('p', '', 'GPS is optional. FareSight uses your position to find a nearby stop and estimate the walk there. Pairing shares the venue or trip you choose with the device using your code.'),
    element('p', '', 'Live AI voice streams your microphone audio directly to OpenAI over WebRTC only while a live session is active. End the session at any time to disconnect the microphone.'),
  );
  surface.body.append(credits, privacy, button('Open moderation', () => { surface.dialog.close(); openModeration(); }, 'quiet'));
  return surface;
}
