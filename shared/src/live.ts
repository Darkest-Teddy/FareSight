export const LIVE_VOICES = ['marin', 'quartz', 'ripple', 'vesper'] as const;
export type LiveVoice = typeof LIVE_VOICES[number];

export interface LiveStatusResponse {
  configured: boolean;
  model: string;
  backend_model: string;
  voice: string;
  voices: readonly string[];
}

export interface LiveSessionRequest {
  sdp: string;
  voice?: string;
  context?: string;
}

export interface LiveSessionResponse {
  session_id: string;
  sdp: string;
  model: string;
  backend_model: string;
  voice: string;
}

export interface LiveFunctionTool {
  type: 'function';
  name: LiveToolName;
  description: string;
  parameters: Record<string, unknown>;
}

export type LiveToolName =
  | 'get_app_state'
  | 'search_catalog'
  | 'navigate_to_map'
  | 'highlight_map_stops'
  | 'open_station'
  | 'highlight_station_places'
  | 'open_place'
  | 'show_menu'
  | 'open_dish'
  | 'compare_dishes'
  | 'rotate_dish'
  | 'set_filters'
  | 'set_will_we_fit'
  | 'get_transit_info'
  | 'control_camera'
  | 'control_ui';

export const FARESIGHT_LIVE_TOOLS: LiveFunctionTool[] = [
  {
    type: 'function',
    name: 'get_app_state',
    description:
      'Read the full current UI and 3D scene state of FareSight: active scene (map, station, venue, dish), current stop, place, dish, comparison dish, filters, highlights, audio state, XR mode, and loaded menu/trip details.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_catalog',
    description:
      'Search FareSight stops, venues, dishes, and rooms by keyword, stop, craving, category, max budget, group size, 3D preview availability, family-friendly, or evening availability. Use this to answer discovery questions and find exact IDs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search across venue names, cravings, vibes, dishes, and stop names.' },
        stop_id: { type: 'string', description: 'Optional stop ID or stop name to restrict results (e.g. place-bucen, place-chncl, Harvard Square).' },
        craving: {
          type: 'string',
          enum: ['all', 'ramen', 'cheap', 'study', 'groups', 'music', 'shops', 'parks'],
          description: 'Optional craving filter.',
        },
        max_budget: { type: 'number', description: 'Optional maximum one-way cost per person including T fare.' },
        has_3d_room: { type: 'boolean', description: 'If true, only return places with a published 3D room splat.' },
        has_3d_dish: { type: 'boolean', description: 'If true, only return places with at least one published 3D dish splat.' },
        family_friendly: { type: 'boolean', description: 'If true, only return family-friendly venues.' },
        evening_only: { type: 'boolean', description: 'If true, only return evening venues.' },
        min_capacity: { type: 'number', description: 'Minimum group capacity needed.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'navigate_to_map',
    description:
      'Return the 3D viewer to the Boston MBTA map sculpture overview. Optionally highlight and pulse one or more stops once on the map.',
    parameters: {
      type: 'object',
      properties: {
        highlight_stop_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional stop IDs or names to highlight on the map after returning.',
        },
        pulse: { type: 'boolean', description: 'Whether to fire expanding pulse rings on highlighted stops. Default true.' },
        clear_highlights: { type: 'boolean', description: 'If true, clear any existing map highlights.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'highlight_map_stops',
    description:
      'Highlight and pulse one or more MBTA stops and their transit lines on the 3D Boston map sculpture and stop board. Pass an empty array to clear map highlights.',
    parameters: {
      type: 'object',
      properties: {
        stop_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Stop IDs or names to highlight (e.g. ["place-chncl", "place-harsq"] or ["Chinatown"]). Empty array clears highlights.',
        },
        pulse: { type: 'boolean', description: 'Trigger expanding ring bursts on each highlighted stop. Default true.' },
        return_to_map: { type: 'boolean', description: 'If true and not currently on the map, return to the map view first. Default true.' },
        focus_camera: { type: 'boolean', description: 'If true and a single primary stop is highlighted, smoothly angle the camera toward it.' },
        note: { type: 'string', description: 'Optional short on-screen notice describing what is highlighted.' },
      },
      required: ['stop_ids'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'open_station',
    description:
      'Dive smoothly from the Boston map into a specific MBTA station neighborhood diorama (BU Central, Packards Corner, Kenmore, Harvard Square, or Chinatown). Optionally highlight specific venue pins in that station.',
    parameters: {
      type: 'object',
      properties: {
        stop: { type: 'string', description: 'Stop ID (e.g. place-bucen, place-brico, place-kencl, place-harsq, place-chncl) or stop name.' },
        highlight_place_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional place IDs or names to highlight as glowing pins inside the station diorama.',
        },
      },
      required: ['stop'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'highlight_station_places',
    description:
      'Highlight one or more venue pins with glowing beacons inside a station diorama and highlight them in the station drawer. Automatically opens the station if needed. Pass an empty array to clear highlights.',
    parameters: {
      type: 'object',
      properties: {
        place_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Place IDs or names to highlight in the station diorama. Empty array clears highlights.',
        },
        note: { type: 'string', description: 'Optional short on-screen banner explaining the highlighted spots.' },
      },
      required: ['place_ids'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'open_place',
    description:
      'Open a venue or restaurant in FareSight: loads its 3D Gaussian splat room (if published), photo gallery, 3D physical menu book, live MBTA trip estimate, and cost breakdown.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Place ID (e.g. bu-ramen-01, allston-karaoke-01, harvard-cafe-01) or place name.' },
        step_inside: { type: 'boolean', description: 'Whether to enter the 3D room splat immediately when available. Default true.' },
        highlight_dish: { type: 'string', description: 'Optional dish ID or name to highlight on the 3D menu book and drawer.' },
      },
      required: ['place'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'show_menu',
    description:
      'Show and focus a venue menu in both the 3D linen menu book and the side drawer, optionally highlighting a specific dish item. Returns all menu items, prices, portion notes, and which items have 3D tabletop previews.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Optional place ID or name. Omit to use the currently open venue.' },
        highlight_dish: { type: 'string', description: 'Optional dish ID or name to spotlight on the 3D menu book and drawer.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'open_dish',
    description:
      'Place a menu item onto the 3D tabletop viewer so the user can inspect it in real-scale 3D. Automatically opens its venue first if needed. Optionally compare it side-by-side with a second dish or set turntable rotation.',
    parameters: {
      type: 'object',
      properties: {
        dish: { type: 'string', description: 'Dish ID (e.g. bu-ramen-tonkotsu, bu-ramen-katsu, harvard-matcha-tiramisu) or dish name.' },
        place: { type: 'string', description: 'Optional place ID or name if disambiguation is needed.' },
        compare_dish: { type: 'string', description: 'Optional second published 3D dish ID or name from any venue.' },
        compare_place: { type: 'string', description: 'Optional exact venue ID for the comparison dish.' },
        rotation_deg: { type: 'number', description: 'Optional turntable rotation angle in degrees (0 to 360).' },
        table_mode: { type: 'string', enum: ['virtual', 'passthrough'], description: 'Optional tabletop backdrop mode.' },
      },
      required: ['dish'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'compare_dishes',
    description:
      'Put two published 3D dishes from any venues side-by-side on the table, or clear the comparison by omitting compare_dish.',
    parameters: {
      type: 'object',
      properties: {
        primary_dish: { type: 'string', description: 'Optional primary dish ID or name. Defaults to the currently shown dish.' },
        compare_dish: { type: 'string', description: 'Second dish ID or name to compare against. Pass empty string to return to single-dish view.' },
        compare_place: { type: 'string', description: 'Optional exact venue ID for the comparison dish.' },
        place: { type: 'string', description: 'Optional place ID or name.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'rotate_dish',
    description:
      'Rotate the 3D dish turntable on the table to an exact angle or by a relative number of degrees.',
    parameters: {
      type: 'object',
      properties: {
        degrees: { type: 'number', description: 'Absolute turntable angle in degrees (0 to 360).' },
        delta_degrees: { type: 'number', description: 'Relative angle change in degrees (e.g. 90, -45, 180).' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'set_filters',
    description:
      'Update FareSight explore filters: craving chip, total per-person budget (8 to 50, includes $2.40 T fare), starting MBTA stop, group size (1 to 20), family visit toggle, or reset all filters.',
    parameters: {
      type: 'object',
      properties: {
        craving: {
          type: 'string',
          enum: ['all', 'ramen', 'cheap', 'study', 'groups', 'music', 'shops', 'parks'],
        },
        max_budget: { type: 'number', description: 'Maximum budget per person in dollars (8 to 50).' },
        start_stop: { type: 'string', description: 'Starting stop ID or name (e.g. place-bucen or Harvard Square).' },
        group_size: { type: 'number', description: 'Group size from 1 to 20.' },
        family_visit: { type: 'boolean', description: 'Toggle family-friendly visit mode.' },
        reset: { type: 'boolean', description: 'If true, reset filters to defaults before applying any other provided fields.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'set_will_we_fit',
    description:
      'Toggle and configure the 3D "Will we fit?" floor-space capacity visualizer inside a venue room (such as Echo Box Karaoke Lounge), updating group size and seated/standing layout.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Show or hide the 3D guest silhouettes and floor-space capacity estimate.' },
        group_size: { type: 'number', description: 'Optional group size (1 to 20) to test in the room.' },
        seating: { type: 'string', enum: ['seated', 'standing'], description: 'Seated (0.75 m spacing) or standing (0.60 m spacing).' },
        place: { type: 'string', description: 'Optional place ID or name to open first if not already in a room.' },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_transit_info',
    description:
      'Get live MBTA train arrivals and service alerts for a stop, or calculate a full door-to-door MBTA trip estimate (walk, train wait, ride, transfers, fare, last train home) to any stop or venue.',
    parameters: {
      type: 'object',
      properties: {
        stop: { type: 'string', description: 'Stop ID or name to check train arrivals and service alerts.' },
        to_place: { type: 'string', description: 'Optional destination place ID or name to compute a full trip estimate.' },
        from_stop: { type: 'string', description: 'Optional origin stop ID or name. Defaults to the current start stop filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'control_camera',
    description:
      'Move, orbit, zoom, focus, or reset the 3D viewport camera smoothly.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['reset', 'orbit', 'zoom', 'focus_stop'],
          description: 'Camera action to perform.',
        },
        yaw_delta_deg: { type: 'number', description: 'Horizontal orbit angle in degrees (positive turns right, negative turns left).' },
        pitch_delta_deg: { type: 'number', description: 'Vertical tilt change in degrees (positive looks from higher above).' },
        zoom_factor: { type: 'number', description: 'Zoom multiplier (< 1 zooms closer, e.g. 0.72; > 1 zooms out, e.g. 1.35).' },
        stop: { type: 'string', description: 'Stop ID or name to focus the camera on when action is focus_stop.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'control_ui',
    description:
      'Control UI panels, sound effects, modals, device pairing handoff, tabletop backdrop, XR exit, highlight clearing, and on-screen announcements.',
    parameters: {
      type: 'object',
      properties: {
        drawer: { type: 'string', enum: ['open', 'close', 'expand', 'collapse'] },
        filter_panel: { type: 'string', enum: ['open', 'close'] },
        audio_sfx: { type: 'string', enum: ['on', 'off'], description: 'Toggle FareSight Web Audio UI sound effects.' },
        modal: { type: 'string', enum: ['none', 'upload', 'pair', 'credits', 'debug'], description: 'Open a specific modal or close open modals (none).' },
        send_to_paired_device: { type: 'string', enum: ['current', 'trip'], description: 'Send current venue/dish or trip estimate to a paired Quest headset.' },
        table_mode: { type: 'string', enum: ['virtual', 'passthrough'], description: 'Switch dish tabletop between virtual table and AR passthrough.' },
        xr_action: { type: 'string', enum: ['enter_vr', 'enter_ar', 'exit_xr'], description: 'Exit XR or attempt to launch VR/AR.' },
        clear_highlights: { type: 'boolean', description: 'Clear all map, station, and menu highlights.' },
        announce: { type: 'string', description: 'Optional brief status toast shown at the top of the screen.' },
      },
      additionalProperties: false,
    },
  },
];
