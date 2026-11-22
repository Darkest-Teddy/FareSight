import type { Dish } from './types.js';

interface RestaurantDishPreview {
  id: string;
  name: string;
  price: Dish['price'];
  diameter: number;
  portion: string;
  file: `dish-${string}.sog`;
  splats: number;
  photoUrl: string;
}

interface RestaurantDishMenu {
  venueId: string;
  pricingUrl?: string;
  dishes: readonly RestaurantDishPreview[];
}

export const restaurantDishMenus: readonly RestaurantDishMenu[] = [
  {
    venueId: 'kenmore-jefes-01',
    dishes: [
      {
        id: 'kenmore-jefes-tacos', name: 'Tacos (Three)',
        price: null, diameter: 0.22, portion: 'Three tacos with grilled meat, slaw and cheese.',
        file: 'dish-eljefes-tacos.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/09/Menu-Banner-Image-scaled-e1788788307495.jpg',
      },
      {
        id: 'kenmore-jefes-burrito', name: 'Carnitas Burrito',
        price: null, diameter: 0.22, portion: 'One carnitas burrito, shown as a cut half.',
        file: 'dish-eljefes-burrito.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/08/Carnitas-burrito-1-1-e1788790684747.png',
      },
      {
        id: 'kenmore-jefes-bowl', name: 'Burrito Bowl',
        price: null, diameter: 0.24, portion: 'Burrito bowl with rice, beans, meat, slaw and guacamole.',
        file: 'dish-eljefes-bowl.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/08/bowls-1.webp',
      },
      {
        id: 'kenmore-jefes-quesadilla', name: 'Quesadilla',
        price: null, diameter: 0.26, portion: 'Grilled quesadilla cut into wedges.',
        file: 'dish-eljefes-quesadilla.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/08/quesadillas-e1788505222181.webp',
      },
      {
        id: 'kenmore-jefes-taco-salad', name: 'Taco Salad Bowl',
        price: null, diameter: 0.24, portion: 'Taco salad in a fried tortilla bowl.',
        file: 'dish-eljefes-taco-salad.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/08/soups-salads-1.webp',
      },
      {
        id: 'kenmore-jefes-salsas', name: 'Salsas and Sides',
        price: null, diameter: 0.24, portion: 'Six cups of salsas and sauces.',
        file: 'dish-eljefes-salsas.sog', splats: 60_000,
        photoUrl: 'https://eljefestaqueria.com/wp-content/uploads/2026/09/Sides.webp',
      },
    ],
  },
  {
    venueId: 'kenmore-shudaxia-01',
    pricingUrl: 'https://pos.chowbus.com/online-ordering/store/11441',
    dishes: [
      {
        id: 'kenmore-shudaxia-hotpot', name: 'Taiji Shrimp Paste 2.0',
        price: 15.0, diameter: 0.32, portion: 'Two shrimp pastes, one with corn and water chestnut.',
        file: 'dish-shudaxia-hotpot.sog', splats: 59_998,
        photoUrl: 'https://irp.cdn-website.com/ca5864e9/dms3rep/multi/b1cbcf_ca77acf3a9434ccb86bc2e7e0cd634cd-mv2.jpg',
      },
      {
        id: 'kenmore-shudaxia-beef', name: 'Premium Fatty Beef Slice',
        price: 12.5, diameter: 0.26, portion: 'Thin marbled beef slices piled around a dry-ice cup (plate not reconstructed).',
        file: 'dish-shudaxia-beef.sog', splats: 59_938,
        photoUrl: 'https://irp.cdn-website.com/ca5864e9/dms3rep/multi/575e2b_93c110a7e8eb416e8822b39e58cfca57-mv2.png',
      },
      {
        id: 'kenmore-shudaxia-pork-ribs', name: 'Signature Pork Ribs with Warriors’ Spicy Sauce',
        price: 15.0, diameter: 0.24, portion: 'One serving.',
        file: 'dish-shudaxia-pork-ribs.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOREk1TnpJME1nRUVRbXh2WWdBPS0tY1ZteCtyV09GUDhuWnc3REJDVW4wOW8vQXhHeUJHRHVTcTA2aUNYWUZBRT0',
      },
      {
        id: 'kenmore-shudaxia-beef-tripe', name: 'Signature Beef Tripe',
        price: 18.0, diameter: 0.24, portion: 'One serving.',
        file: 'dish-shudaxia-beef-tripe.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOREk1TnpNek9RRUVRbXh2WWdBPS0tcmlaaHhKaFpoZWcxTlhGeW02bkp5bUhTNk9mZ2txKzJ1dnpGVm4ralE4dz0',
      },
      {
        id: 'kenmore-shudaxia-beef-skewers', name: 'Warriors’ Select Beef Skewers',
        price: 13.0, diameter: 0.12, portion: 'Beef skewers in a spicy-sauce cup, served beside the Shu Daxia panda figure (part of the presentation).',
        file: 'dish-shudaxia-beef-skewers.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE15TWpreU13RUVRbXh2WWdBPS0tYjlQK09uZFJHZ2J6bDlhU3p3NUxIc2pvQjNzKzBkanVIdUZFU1Z2SkhqWT0',
      },
      {
        id: 'kenmore-shudaxia-beef-tongue', name: 'Beef Tongue',
        price: 16.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-beef-tongue.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE15TURJd05nRUVRbXh2WWdBPS0tdjg0dlJGWENreUNIVnF0VnFMRkl4S1hiQ29PQllaZjB3L0kyYjVBYzlNRT0',
      },
      {
        id: 'kenmore-shudaxia-ribeye', name: 'Prime Ribeye Slice',
        price: 17.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-ribeye.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TWpVMU13RUVRbXh2WWdBPS0tUkVlK05JMmRYQ1Zka3RWTEtRbGNlRlJ2V1NIa1E1Uzc5aVQxc2Q0alB1ND0',
      },
      {
        id: 'kenmore-shudaxia-lamb', name: 'Lamb Slice',
        price: 13.0, diameter: 0.28, portion: 'One serving.',
        file: 'dish-shudaxia-lamb.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TWpVMU5RRUVRbXh2WWdBPS0tNnFvbVRqQmtmN3F4Z2ZMcUFuN2pCUHB5S1FYT2s3RW5RRmFLcXpDTlA5RT0',
      },
      {
        id: 'kenmore-shudaxia-beef-duo', name: 'Beef Duo (Ribeye & Boneless Short Rib)',
        price: 24.0, diameter: 0.28, portion: 'One serving.',
        file: 'dish-shudaxia-beef-duo.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOVGsyTlRBeU1BRUVRbXh2WWdBPS0tMFEvZ2V3VkNuenBFQUIwVXd3N0hacUlGUlVwT2tlL3BWZmVLcWFqUFlIMD0',
      },
      {
        id: 'kenmore-shudaxia-short-rib', name: 'Boneless Short Rib',
        price: 21.0, diameter: 0.28, portion: 'One serving.',
        file: 'dish-shudaxia-short-rib.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TWpVMU5BRUVRbXh2WWdBPS0tSzQvTkgrNEdJTVBOcVJEOU14a210UmZxc2ZWKytLOHZtM0lMNkR3amdDaz0',
      },
      {
        id: 'kenmore-shudaxia-marinated-beef', name: 'Prime Marinated Beef Slices',
        price: 12.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-marinated-beef.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOREk1TnpJeE5RRUVRbXh2WWdBPS0tQ2lZTnM2aHhXNktWNDIzLzFnUmVmWmpRbEFPR212dDFPa2cwOTQzOVF4dz0',
      },
      {
        id: 'kenmore-shudaxia-shrimp', name: 'White Shrimp (Head-On)',
        price: 9.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-shrimp.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE14TmpJME5RRUVRbXh2WWdBPS0tQ0J4Z0JYKzRLNHNkNEMrWlNUaitjdkN3d0QvdUVRZ3hKbUxwRWdFNTJIQT0',
      },
      {
        id: 'kenmore-shudaxia-abalone', name: 'Abalone',
        price: 15.0, diameter: 0.2, portion: 'One serving.',
        file: 'dish-shudaxia-abalone.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORFl4TVRjM01BRUVRbXh2WWdBPS0tUVowWEdpRmRHMzhhdVBkNEQ0Z243R0J1NHVpcktOazZEYXVxZFZYT0NNST0',
      },
      {
        id: 'kenmore-shudaxia-fish-fillets', name: 'Kung Fu Snakehead Fish Fillets',
        price: 13.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-fish-fillets.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOREk1TnpNMU1RRUVRbXh2WWdBPS0tRG5qNXFTTUV4R2Nvbmh3aTNlZUR5d3gzYTRmKzQ5SjNoZkRLOW5adWNGRT0',
      },
      {
        id: 'kenmore-shudaxia-shrimp-roll', name: 'Tiger Shrimp Paste Beancurd Roll',
        price: 10.0, diameter: 0.22, portion: 'One serving.',
        file: 'dish-shudaxia-shrimp-roll.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORGMxTlRnNE13RUVRbXh2WWdBPS0tNHJ0em5aZmsyNXNkZUdyTi9KSUpPcGZYb2N3SWJyWm1lZGg4Q3RpalQxWT0',
      },
      {
        id: 'kenmore-shudaxia-mushroom-platter', name: 'Assorted Mushroom Platter',
        price: 14.0, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-mushroom-platter.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpFNE53RUVRbXh2WWdBPS0tWTdLZ2RuK0VLVDg0QXRBczlKVFlrY1ltMGFsZW55WDhPNmxVWDU0QXplTT0',
      },
      {
        id: 'kenmore-shudaxia-crispy-pork', name: 'Crispy Fried Pork',
        price: 9.5, diameter: 0.22, portion: 'One serving.',
        file: 'dish-shudaxia-crispy-pork.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpJd053RUVRbXh2WWdBPS0tdDNDSDlEVEYyemJSOE1ZUnpxSEh1WmE2N0U3U2JKZmZjNUxCU0M0QlRpOD0',
      },
      {
        id: 'kenmore-shudaxia-sticky-rice', name: 'Fried Sticky Rice with Brown Sugar',
        price: 8.0, diameter: 0.24, portion: 'One serving.',
        file: 'dish-shudaxia-sticky-rice.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpJd013RUVRbXh2WWdBPS0tMlM1bUVOUzBTSTlUNktadW5JM0MwVTZLemdXN2kwSGpwZm5UbS9DRmRaQT0',
      },
      {
        id: 'kenmore-shudaxia-sichuan-fries', name: 'Sichuan-Style French Fries',
        price: 7.0, diameter: 0.24, portion: 'One serving.',
        file: 'dish-shudaxia-sichuan-fries.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpJd05BRUVRbXh2WWdBPS0tYldCMDN2K0hqQ2Z5THgyQ1M4U043djA0Wi9KRmw4SDNCb0dXZzU1eGZ4ST0',
      },
      {
        id: 'kenmore-shudaxia-dumplings', name: 'Mini Pork & Cabbage Dumplings (10)',
        price: 5.0, diameter: 0.22, portion: 'One serving.',
        file: 'dish-shudaxia-dumplings.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhOVFF5TlRJME53RUVRbXh2WWdBPS0tUzFpZVU2eS95ZXNOSXpEMzNJTFhvS090dSt0ZFA1ZmZ3cFd2L1VNVXNCcz0',
      },
      {
        id: 'kenmore-shudaxia-beef-fried-rice', name: 'Beef Fried Rice',
        price: 14.5, diameter: 0.26, portion: 'One serving.',
        file: 'dish-shudaxia-beef-fried-rice.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE01TnprMk9BRUVRbXh2WWdBPS0tb1lKdGNvbjM4ZkF6Um5oUEYwSFRxSU9TcElFM2k4NXFRczVaRkhsQmwrOD0',
      },
      {
        id: 'kenmore-shudaxia-noodles', name: 'Hand-Pulled Noodles',
        price: 4.5, diameter: 0.22, portion: 'One serving.',
        file: 'dish-shudaxia-noodles.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORGN5TVRVM09RRUVRbXh2WWdBPS0tTWZJTjJCY0pmWE1sUDlyYmFOUlR6NENmb1BtZGl2VW9zdzlIaHFCZFF3WT0',
      },
      {
        id: 'kenmore-shudaxia-malatang', name: 'Malatang',
        price: 15.5, diameter: 0.24, portion: 'One serving.',
        file: 'dish-shudaxia-malatang.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORFF5TWpJNU9RRUVRbXh2WWdBPS0tZllzZ3BFODJwaDJTMXE4WEgvOXNtVFRtSmM1MkpUZGtUdlczVVA1dUpLaz0',
      },
      {
        id: 'kenmore-shudaxia-ice-pudding', name: 'Brown Sugar Ice Pudding with Seasonal Fruit',
        price: 4.0, diameter: 0.2, portion: 'One serving.',
        file: 'dish-shudaxia-ice-pudding.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpVek9RRUVRbXh2WWdBPS0tWTFyQVFpaldPZ0pjc21zNWcwMjdRVElKQ2h5R2hnNzVKd2FJMW1vRi92dz0',
      },
      {
        id: 'kenmore-shudaxia-tofu-pudding', name: 'Tofu Pudding',
        price: 6.5, diameter: 0.08, portion: 'One serving. Limited daily availability.',
        file: 'dish-shudaxia-tofu-pudding.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE16T1RZM05nRUVRbXh2WWdBPS0telNGZmF1UEZuNWVjZXpUV0hVdWJYOVBabVNPejhTVkNVVG43Vjh6azVZND0',
      },
      {
        id: 'kenmore-shudaxia-cheesecake', name: 'Key Lime Cheesecake',
        price: 12.0, diameter: 0.18, portion: 'One serving.',
        file: 'dish-shudaxia-cheesecake.sog', splats: 59_989,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhNelF6TVRBME9BRUVRbXh2WWdBPS0tSWpHRUUza3FDc1dxNnY5UnMvOGwvOTI1WTNLUU15VzlYc0pMSVBJejZTaz0',
      },
      {
        id: 'kenmore-shudaxia-strawberry-matcha', name: 'Strawberry Matcha Latte',
        price: 7.0, diameter: 0.09, portion: 'One serving.',
        file: 'dish-shudaxia-strawberry-matcha.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpRMk13RUVRbXh2WWdBPS0tNFZXU25HS3l2bXExU2k0UWRidncxbjRJNy9DZldUZGZCdGFqUDdtdjd2cz0',
      },
      {
        id: 'kenmore-shudaxia-mango-tea', name: 'Mango Iced Lemon Tea',
        price: 6.0, diameter: 0.09, portion: 'One serving.',
        file: 'dish-shudaxia-mango-tea.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpRMk5nRUVRbXh2WWdBPS0taGk1dnhJU0phd0R3cGlHOXJkNmVWWkd3VStOVjMwZFlXdFAzOXc5ZWxjQT0',
      },
      {
        id: 'kenmore-shudaxia-lime-tea', name: 'Hand-Beaten Iced Lime Tea',
        price: 6.5, diameter: 0.09, portion: 'One serving.',
        file: 'dish-shudaxia-lime-tea.sog', splats: 60_000,
        photoUrl: 'https://api.chowbus.com/compendium/api/v1/image_proxy/blobs/Skg4REFRRUhiV1Z6YzJGblpRSC9nQUFCQWdFQ1NVUUJEQUFCQkZSNWNHVUJEQUFBQUJML2dBRUhORE13TXpRMk1BRUVRbXh2WWdBPS0tMnFFUnY4REhXTDBuRXpVK3d4N0pOK0xwOHVZR1NOdUVsZHV2dmxBcTVzdz0',
      },
    ],
  },
  {
    venueId: 'bu-starbucks-01',
    dishes: [
      {
        id: 'bu-starbucks-macchiato', name: 'Iced Caramel Macchiato',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-drink.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedCaramelMacchiato',
      },
      {
        id: 'bu-starbucks-croissant', name: 'Butter Croissant',
        price: null, diameter: 0.16, portion: 'One serving.',
        file: 'dish-starbucks-pastry.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20210915_Croissant-onGreen',
      },
      {
        id: 'bu-starbucks-caffe-latte', name: 'Caffè Latte',
        price: null, diameter: 0.09, portion: 'One serving.',
        file: 'dish-starbucks-caff-latte.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/CaffeLatte',
      },
      {
        id: 'bu-starbucks-cappuccino', name: 'Cappuccino',
        price: null, diameter: 0.09, portion: 'One serving.',
        file: 'dish-starbucks-cappuccino.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20190617_Cappuccino',
      },
      {
        id: 'bu-starbucks-caramel-macchiato', name: 'Caramel Macchiato',
        price: null, diameter: 0.09, portion: 'One serving.',
        file: 'dish-starbucks-caramel-macchiato.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20211029_CaramelMacchiato',
      },
      {
        id: 'bu-starbucks-cold-brew', name: 'Cold Brew',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-cold-brew.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/ColdBrew',
      },
      {
        id: 'bu-starbucks-iced-matcha-latte', name: 'Iced Matcha Latte',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-iced-matcha-latte.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedMatchaTeaLatte',
      },
      {
        id: 'bu-starbucks-strawberry-acai-refresher', name: 'Strawberry Açaí Refresher',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-strawberry-a-a-refresher.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/StrawberryAcai',
      },
      {
        id: 'bu-starbucks-mango-dragonfruit-refresher', name: 'Mango Dragonfruit Refresher',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-mango-dragonfruit-refresher.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/MangoDragonfruitRefreshers',
      },
      {
        id: 'bu-starbucks-pink-drink', name: 'Pink Drink',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-pink-drink.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/PinkDrink',
      },
      {
        id: 'bu-starbucks-caramel-frappuccino-blended-beverage', name: 'Caramel Frappuccino Blended Beverage',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-caramel-frappuccino-blended-beverage.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20220323_CaramelFrapp',
      },
      {
        id: 'bu-starbucks-mocha-frappuccino-blended-beverage', name: 'Mocha Frappuccino Blended Beverage',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-mocha-frappuccino-blended-beverage.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/MochaFrappuccino',
      },
      {
        id: 'bu-starbucks-hot-chocolate', name: 'Hot Chocolate',
        price: null, diameter: 0.09, portion: 'One serving.',
        file: 'dish-starbucks-hot-chocolate.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20190617_SignatureHotChocolate',
      },
      {
        id: 'bu-starbucks-iced-brown-sugar-oatmilk-shaken-espresso', name: 'Iced Brown Sugar Oatmilk Shaken Espresso',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-iced-brown-sugar-oatmilk-shaken-espresso.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedBrownSugarOatmilkShakenEspresso',
      },
      {
        id: 'bu-starbucks-bacon-gouda-and-egg-sandwich', name: 'Bacon, Gouda & Egg Sandwich',
        price: null, diameter: 0.12, portion: 'One serving.',
        file: 'dish-starbucks-bacon-gouda-and-egg-sandwich.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20210915_BaconGoudaEggSandwich',
      },
      {
        id: 'bu-starbucks-sausage-cheddar-and-egg-sandwich', name: 'Sausage, Cheddar & Egg Sandwich',
        price: null, diameter: 0.12, portion: 'One serving.',
        file: 'dish-starbucks-sausage-cheddar-and-egg-sandwich.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SausageCheddarandEggSandwich',
      },
      {
        id: 'bu-starbucks-bacon-and-gruyere-egg-bites', name: 'Bacon & Gruyère Egg Bites',
        price: null, diameter: 0.1, portion: 'One serving.',
        file: 'dish-starbucks-bacon-and-gruy-re-egg-bites.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/BaconGruyereEggBites',
      },
      {
        id: 'bu-starbucks-birthday-cake-pop', name: 'Birthday Cake Pop',
        price: null, diameter: 0.045, portion: 'One serving.',
        file: 'dish-starbucks-birthday-cake-pop.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20181129_BirthdayCakePop',
      },
      {
        id: 'bu-starbucks-chocolate-croissant', name: 'Chocolate Croissant',
        price: null, diameter: 0.15, portion: 'One serving.',
        file: 'dish-starbucks-chocolate-croissant.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20220607_ChocolateCroissant-onGreen',
      },
      {
        id: 'bu-starbucks-cheese-danish', name: 'Cheese Danish',
        price: null, diameter: 0.11, portion: 'One serving.',
        file: 'dish-starbucks-cheese-danish.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20220125_CheeseDanish-onGreen',
      },
      {
        id: 'bu-starbucks-iced-lemon-loaf', name: 'Iced Lemon Loaf',
        price: null, diameter: 0.1, portion: 'One serving.',
        file: 'dish-starbucks-iced-lemon-loaf.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedLemonLoaf',
      },
      {
        id: 'bu-starbucks-chocolate-chip-cookie', name: 'Chocolate Chip Cookie',
        price: null, diameter: 0.09, portion: 'One serving.',
        file: 'dish-starbucks-chocolate-chip-cookie.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20190129_ChocolateChipCookie',
      },
      {
        id: 'bu-starbucks-plain-bagel', name: 'Plain Bagel',
        price: null, diameter: 0.1, portion: 'One serving.',
        file: 'dish-starbucks-plain-bagel.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20190715_PlainBagel',
      },
      {
        id: 'bu-starbucks-impossible-breakfast-sandwich', name: 'Impossible Breakfast Sandwich',
        price: null, diameter: 0.12, portion: 'One serving.',
        file: 'dish-starbucks-impossible-breakfast-sandwich.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20200225_ImpossibleBreakfastSandwich',
      },
      {
        id: 'bu-starbucks-iced-chai-latte', name: 'Iced Chai Latte',
        price: null, diameter: 0.095, portion: 'One serving.',
        file: 'dish-starbucks-iced-chai-latte.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedChaiTeaLatte',
      },
      {
        id: 'bu-starbucks-banana-walnut-and-pecan-loaf', name: 'Banana, Walnut & Pecan Loaf',
        price: null, diameter: 0.1, portion: 'One serving.',
        file: 'dish-starbucks-banana-walnut-and-pecan-loaf.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/BananaWalnutPecanLoafUS',
      },
      {
        id: 'bu-starbucks-turkey-bacon-cheddar-and-egg-white-sandwich', name: 'Turkey Bacon, Cheddar & Egg White Sandwich',
        price: null, diameter: 0.12, portion: 'One serving.',
        file: 'dish-starbucks-turkey-bacon-cheddar-and-egg-white-sandw.sog', splats: 60_000,
        photoUrl: 'https://cloudassets.starbucks.com/is/image/sbuxcorp/SmokedTurkeyBaconSandwich',
      },
    ],
  },
];
