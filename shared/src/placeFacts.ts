import type { Place, PlaceDetails } from './types.js';

export interface PlaceFacts {
  /** Current public name when it differs from the catalog listing. */
  name?: string;
  vibe?: string;
  /** Published weekly hours. Absent days are closed; null keeps the catalog's planning hours. */
  hours: Place['hours'] | null;
  details: PlaceDetails;
}

/**
 * Researched 2026-11-21 from official sites, listings and press (see each entry's sources).
 * Ratings are snapshots of third-party listings and drift over time. Demo venues have no entry.
 */
export const PLACE_FACTS: Record<string, PlaceFacts> = {
  'bu-starbucks-01': {
    hours: {
      mon: ['07:00', '20:00'], tue: ['07:00', '20:00'], wed: ['07:00', '20:00'],
      thu: ['07:00', '20:00'], fri: ['07:00', '20:00'],
      sat: ['09:00', '19:00'], sun: ['09:00', '19:00'],
    },
    details: {
      checked_on: '2026-11-21', address: '700 Commonwealth Ave', website: null, phone: null,
      hours_verified: false, hours_note: null, hours_source: null,
      awards: [], ratings: [], review_highlights: [], review_sources: [],
    },
  },
  'kenmore-shudaxia-01': {
    hours: null,
    details: {
      checked_on: '2026-11-21', address: '580 Commonwealth Ave', website: null, phone: null,
      hours_verified: false, hours_note: null, hours_source: null,
      awards: [], ratings: [], review_highlights: [], review_sources: [],
    },
  },
  "bu-pavement-01": {
    "hours": {
      "mon": [
        "07:00",
        "19:00"
      ],
      "tue": [
        "07:00",
        "19:00"
      ],
      "wed": [
        "07:00",
        "19:00"
      ],
      "thu": [
        "07:00",
        "19:00"
      ],
      "fri": [
        "07:00",
        "19:00"
      ],
      "sat": [
        "07:00",
        "14:00"
      ],
      "sun": [
        "07:00",
        "14:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "736 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://pavementcoffeehouse.com/pages/boston_university",
      "phone": "617-766-6048",
      "hours_verified": true,
      "hours_note": "BU location page hours; the official locations directory instead lists 07:00–19:00 daily. Confirm weekend closing before visiting.",
      "hours_source": "https://pavementcoffeehouse.com/pages/boston_university",
      "awards": [
        {
          "title": "The best bagels in Boston",
          "org": "Time Out Boston",
          "year": 2026,
          "url": "https://www.timeout.com/boston/restaurants/best-bagels-in-boston"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.7,
          "count": 14,
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d9763872-Reviews-Pavement_Coffee_House-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Bagels, breakfast sandwiches and coffee receive repeated praise.",
        "Customers like the comfortable atmosphere for studying or lingering, although one recent reviewer wanted more electrical outlets.",
        "High prices and uneven counter service recur in complaints."
      ],
      "review_sources": [
        "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d9763872-Reviews-Pavement_Coffee_House-Boston_Massachusetts.html",
        "https://restaurantguru.com/Pavement-Coffeehouse-Boston-4"
      ]
    }
  },
  "bu-nudpob-01": {
    "hours": {
      "mon": [
        "11:00",
        "22:00"
      ],
      "tue": [
        "11:00",
        "22:00"
      ],
      "wed": [
        "11:00",
        "22:00"
      ],
      "thu": [
        "11:00",
        "22:00"
      ],
      "fri": [
        "11:00",
        "22:00"
      ],
      "sat": [
        "12:00",
        "22:00"
      ],
      "sun": [
        "12:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "738 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.nudpob.us/",
      "phone": "617-232-9992",
      "hours_verified": true,
      "hours_note": "Advertised outer span. Restaurantji reports a daily 15:00–16:00 break; online ordering may stop at 21:30.",
      "hours_source": "https://www.nudpobthaicuisine.com/contact-us/",
      "awards": [
        {
          "title": "Iconic Boston University restaurants: Then and now",
          "org": "Boston University Alumni & Friends",
          "year": 2025,
          "url": "https://www.bu.edu/alumni/2025/02/21/blog-iconic-bu-restaurants/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.8,
          "count": 17,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d323800-Reviews-Nud_POB_Thai_Restaurant-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Customers repeatedly praise quick preparation and affordable, filling meals.",
        "Pad Thai, pad see ew and Indonesian fried rice are recurring favorites.",
        "Older critical reviews describe greasy food, mushy noodles and uneven service."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d323800-Reviews-Nud_POB_Thai_Restaurant-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/nud-pob-thai-cuisine-/",
        "https://www.bu.edu/alumni/2025/02/21/blog-iconic-bu-restaurants/"
      ]
    }
  },
  "bu-halal-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "George Sherman Union Food Hall, 775 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.bu.edu/dining/location/the-halal-shack/",
      "phone": "617-358-1885",
      "hours_verified": false,
      "hours_note": "Thanksgiving 2026: closed November 21; open November 22–23, 11:00–19:00; closed November 24–29.",
      "hours_source": "https://www.bu.edu/dining/thanksgiving-week-2026/",
      "awards": [],
      "ratings": [],
      "review_highlights": [
        "BU Today's 2023 reviewers praised filling portions, seasoned rice and spicy chicken, although one found the beef dry.",
        "Crispy cauliflower with tahini and fresh vegetable toppings stood out among the vegetarian options.",
        "The reviewers flagged extra charges for premium additions, and one found the falafel small and bland."
      ],
      "review_sources": [
        "https://www.bu.edu/articles/2023/gsu-halal-shack-restaurant-review/"
      ]
    }
  },
  "bu-beach-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "270 Bay State Road, Boston, MA 02215",
      "website": "https://butodayevents.bu.edu/bu-beach",
      "phone": null,
      "hours_verified": false,
      "hours_note": "BU's 2024 guide says open daily without specifying opening or closing times. Current fixed visitor hours were not verified.",
      "hours_source": "https://www.bu.edu/articles/2024/best-summer-study-spots-on-bu-campus/",
      "awards": [
        {
          "title": "Best Summer Study Spots on BU's Campus",
          "org": "BU Today",
          "year": 2024,
          "url": "https://www.bu.edu/articles/2024/best-summer-study-spots-on-bu-campus/"
        }
      ],
      "ratings": [
        {
          "source": "Google",
          "rating": 4.6,
          "count": 139,
          "url": "https://wanderlog.com/place/details/1244689/bu-beach"
        }
      ],
      "review_highlights": [
        "Visitors like the grassy space for studying, picnicking and relaxing in good weather.",
        "Picnic tables and flowering trees in spring receive praise.",
        "Trees obstruct some views toward the river and city, and passing Storrow Drive traffic is audible."
      ],
      "review_sources": [
        "https://wanderlog.com/place/details/1244689/bu-beach",
        "https://www.bu.edu/articles/2024/best-summer-study-spots-on-bu-campus/"
      ]
    }
  },
  "bu-grill-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "712 Commonwealth Avenue, Suite 2, Boston, MA 02215",
      "website": "https://ugrillboston.com/",
      "phone": "617-247-7120",
      "hours_verified": false,
      "hours_note": "Published listings disagree substantially about closing times. Call to confirm current hours.",
      "hours_source": null,
      "awards": [],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 12,
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Gyros receive repeated praise for flavorful meat and handmade pita.",
        "Reviewers often highlight friendly staff and good value across pizza, subs and Greek dishes.",
        "The setting is informal and suited to takeout; one older reviewer reported slow service and very limited seating."
      ],
      "review_sources": [
        "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html"
      ]
    }
  },
  "allston-brownsugar-01": {
    "hours": {
      "mon": [
        "16:00",
        "21:30"
      ],
      "wed": [
        "11:30",
        "21:30"
      ],
      "thu": [
        "11:30",
        "21:30"
      ],
      "fri": [
        "11:30",
        "21:30"
      ],
      "sat": [
        "12:00",
        "21:30"
      ],
      "sun": [
        "12:00",
        "21:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "1033 Commonwealth Ave, Boston, MA 02215",
      "website": "https://www.brownsugarcafe.com/",
      "phone": "617-787-4242",
      "hours_verified": true,
      "hours_note": "Wednesday–Friday closed between lunch and dinner, 14:30–16:00. Closed Tuesdays.",
      "hours_source": "https://www.brownsugarcafe.com/",
      "awards": [
        {
          "title": "Readers' favorite Thai restaurants in Greater Boston (5th)",
          "org": "Boston.com",
          "year": 2022,
          "url": "https://www.boston.com/community/readers-say/best-thai-food-in-greater-boston/"
        },
        {
          "title": "The 15 Best Thai Restaurants in Boston",
          "org": "Boston Magazine",
          "year": 2021,
          "url": "https://www.bostonmagazine.com/restaurants/the-best-thai-restaurants-in-boston/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": 185,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d323080-Reviews-Brown_Sugar_Cafe-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Readers particularly recommend the pad see ew, yellow curry and lemongrass shrimp tom yum soup.",
        "Time Out recommends exploring the clay-pot dishes and minced-pork omelet, with staff helping explain less familiar choices.",
        "Boston Magazine highlights the fried shrimp cakes and charcoal-grilled meatballs."
      ],
      "review_sources": [
        "https://www.boston.com/community/readers-say/best-thai-food-in-greater-boston/",
        "https://www.timeout.com/boston/restaurants/brown-sugar-cafe",
        "https://www.bostonmagazine.com/restaurants/the-best-thai-restaurants-in-boston/"
      ]
    }
  },
  "allston-bostongoods-01": {
    "hours": {
      "mon": [
        "11:00",
        "19:00"
      ],
      "tue": [
        "11:00",
        "19:00"
      ],
      "wed": [
        "11:00",
        "19:00"
      ],
      "thu": [
        "11:00",
        "20:00"
      ],
      "fri": [
        "11:00",
        "20:00"
      ],
      "sat": [
        "11:00",
        "20:00"
      ],
      "sun": [
        "11:00",
        "17:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "318 Lincoln St, Allston, MA 02134",
      "website": "https://bostongoods.co/",
      "phone": "617-987-5708",
      "hours_verified": true,
      "hours_note": "Hours published in BU Today's 2026 shopping guide.",
      "hours_source": "https://www.bu.edu/articles/2026/thrift-stores-boston/",
      "awards": [
        {
          "title": "Guide to the Best Secondhand Shops in and around Boston",
          "org": "BU Today",
          "year": 2026,
          "url": "https://www.bu.edu/articles/2026/thrift-stores-boston/"
        }
      ],
      "ratings": [],
      "review_highlights": [
        "BU Today highlights inexpensive secondhand clothing alongside vintage pieces and deadstock.",
        "Its guide recommends the $2-per-pound section for bargain hunters willing to spend time digging."
      ],
      "review_sources": [
        "https://www.bu.edu/articles/2026/thrift-stores-boston/"
      ]
    }
  },
  "allston-super88-01": {
    "hours": {
      "mon": [
        "09:00",
        "20:45"
      ],
      "tue": [
        "09:00",
        "20:45"
      ],
      "wed": [
        "09:00",
        "20:45"
      ],
      "thu": [
        "09:00",
        "20:45"
      ],
      "fri": [
        "09:00",
        "20:45"
      ],
      "sat": [
        "09:00",
        "20:45"
      ],
      "sun": [
        "09:00",
        "20:45"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "1 Brighton Ave, Allston, MA 02134",
      "website": null,
      "phone": "617-787-2288",
      "hours_verified": true,
      "hours_note": "Supermarket hours only. Food-court reopening and vendor hours remain unverified.",
      "hours_source": "https://www.chaoshiweekly.com/en/store/hongkong-allston",
      "awards": [],
      "ratings": [],
      "review_highlights": [
        "Shoppers praise the selection of Asian noodles, sauces, mushrooms and specialty ingredients.",
        "Free parking is useful, while some reviewers complain about obstructed aisles, rising prices and product freshness."
      ],
      "review_sources": [
        "https://www.loc8nearme.com/massachusetts/boston/hong-kong-supermarket/2420748/"
      ]
    },
    "name": "Hong Kong Supermarket",
    "vibe": "Asian grocery in the former Super 88 building. Food-court stalls have opened and closed, so check what is serving."
  },
  "allston-coreanos-01": {
    "hours": {
      "mon": [
        "11:30",
        "21:30"
      ],
      "wed": [
        "11:30",
        "21:30"
      ],
      "thu": [
        "11:30",
        "21:30"
      ],
      "fri": [
        "11:30",
        "22:30"
      ],
      "sat": [
        "11:30",
        "22:30"
      ],
      "sun": [
        "12:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "172 Brighton Ave, Allston, MA 02134",
      "website": "https://www.coreanosallston.com/",
      "phone": "617-208-8822",
      "hours_verified": true,
      "hours_note": "Closed Tuesdays.",
      "hours_source": "https://www.coreanosma.com/",
      "awards": [
        {
          "title": "8 Best Korean BBQ Restaurants in Boston",
          "org": "Time Out Boston",
          "year": 2026,
          "url": "https://www.timeout.com/boston/restaurants/best-korean-restaurants-in-boston"
        },
        {
          "title": "Best Restaurants in Allston",
          "org": "Boston Magazine",
          "year": 2023,
          "url": "https://www.bostonmagazine.com/restaurants/best-restaurants-allston/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 20,
          "url": "https://www.tripadvisor.com/Restaurants-g60745-c10661-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Critics recommend the crisp Korean fried chicken, kimchi fried rice and bulgogi dishes.",
        "Bulgogi tacos and loaded kimchi fries are frequently recommended fusion choices.",
        "Reviewers describe quick service but limited seating, making takeout a practical option."
      ],
      "review_sources": [
        "https://www.timeout.com/boston/restaurants/best-korean-restaurants-in-boston",
        "https://www.bostonmagazine.com/restaurants/best-restaurants-allston/",
        "https://www.coreanosma.com/"
      ]
    }
  },
  "allston-brightonmusic-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "158 Brighton Ave, Boston, MA 02134",
      "website": "https://brightonmusichall.com/pages/brighton-music-hall-inner",
      "phone": "617-208-8786",
      "hours_verified": false,
      "hours_note": "Event-based admission; doors typically open one hour before showtime. Confirm box-office hours before visiting.",
      "hours_source": "https://brightonmusichall.com/pages/brighton-music-hall-inner",
      "awards": [
        {
          "title": "Best live music venues in Boston",
          "org": "Time Out Boston",
          "year": 2026,
          "url": "https://www.timeout.com/boston/music/best-live-music-boston"
        },
        {
          "title": "Best of Boston: Best Small Music Venue",
          "org": "Boston Magazine",
          "year": 2022,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2022/brighton-music-hall-4/"
        },
        {
          "title": "Best of Boston: Best Music Venue, Alt/Pop/Rock",
          "org": "Boston Magazine",
          "year": 2014,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/award/music-venue/page/2/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.1,
          "count": 33,
          "url": "https://www.tripadvisor.co.uk/Attractions-g60745-Activities-c58-zfn15565954-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers value the intimate room and the chance to get close to performers.",
        "Several bars help spread out drink orders, and visitors frequently praise the sound.",
        "The audience area is mainly standing room, with limited seating for people who need a rest."
      ],
      "review_sources": [
        "https://www.tripadvisor.co.uk/Attractions-g60745-Activities-c58-zfn15565954-Boston_Massachusetts.html",
        "https://www.concerthotels.com/venue-hotels/brighton-music-hall-hotels/332143",
        "https://maps.roadtrippers.com/us/allston-ma/entertainment/brighton-music-hall-allston",
        "https://www.timeout.com/boston/music/best-live-music-boston"
      ]
    }
  },
  "kenmore-fenway-01": {
    "hours": {
      "mon": [
        "10:00",
        "17:00"
      ],
      "tue": [
        "10:00",
        "17:00"
      ],
      "wed": [
        "10:00",
        "17:00"
      ],
      "thu": [
        "10:00",
        "17:00"
      ],
      "fri": [
        "10:00",
        "17:00"
      ],
      "sat": [
        "10:00",
        "17:00"
      ],
      "sun": [
        "10:00",
        "17:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "4 Jersey Street, Boston, MA 02215",
      "website": "https://www.mlb.com/redsox/ballpark",
      "phone": "617-226-6660",
      "hours_verified": true,
      "hours_note": "November–March tour schedule; hourly departures. April–October starts at 09:00. Last game-day tour departs three hours before first pitch.",
      "hours_source": "https://www.mlb.com/redsox/ballpark/tours",
      "awards": [
        {
          "title": "Travelers' Choice",
          "org": "Tripadvisor",
          "year": 2026,
          "url": "https://www.tripadvisor.com/Attraction_Review-g60745-d105250-Reviews-Fenway_Park-Boston_Massachusetts.html"
        },
        {
          "title": "Sports Facility of the Year",
          "org": "Sports Business Journal",
          "year": 2023,
          "url": "https://www.cbsnews.com/boston/news/fenway-park-sports-facility-of-the-year-award/"
        },
        {
          "title": "National Register of Historic Places listing",
          "org": "National Park Service",
          "year": 2012,
          "url": "https://www.bostonpreservation.org/advocacy-project/fenway-park"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.7,
          "count": 17951,
          "url": "https://www.tripadvisor.com/AttractionsNear-g60745-d1382434-House_of_Blues_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Visitors praise the guides' baseball knowledge and stories, especially during stops around the Green Monster.",
        "The historic atmosphere is a major draw, but older seats can feel cramped and support columns obstruct some views.",
        "Some tour reviewers report groups large enough to make hearing the guide difficult."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Attraction_Review-g60745-d105250-Reviews-Fenway_Park-Boston_Massachusetts.html"
      ]
    }
  },
  "kenmore-hob-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "15 Lansdowne Street, Boston, MA 02215",
      "website": "https://boston.houseofblues.com/",
      "phone": "888-693-2583",
      "hours_verified": false,
      "hours_note": "Box office opens only on show days, one hour before doors. Check the individual event for door time.",
      "hours_source": "https://boston.houseofblues.com/faq",
      "awards": [
        {
          "title": "No. 7, Year End Worldwide Top 200 Clubs by tickets sold",
          "org": "Pollstar",
          "year": 2024,
          "url": "https://www.bostonplans.org/getattachment/0e557ae1-7b22-4b02-8331-9f3a64d32006"
        },
        {
          "title": "No. 1, Q1 Worldwide Top 50 Clubs by gross",
          "org": "Pollstar",
          "year": 2022,
          "url": "https://data.pollstar.com/Chart/2022/03/Top50CLubs_1015.pdf"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.5,
          "count": 278,
          "url": "https://www.tripadvisor.com/Attraction_Review-g60745-d1382434-Reviews-or10-House_of_Blues_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Positive reviews describe an intimate concert setting and praise the views from some box seats.",
        "Sightlines vary substantially: reviewers report railings and standing patrons blocking views in some upper sections."
      ],
      "review_sources": [
        "https://www.concerthotels.com/venue-hotels/citizens-house-of-blues-boston-hotels/328117",
        "https://www.tripadvisor.com/Attraction_Review-g60745-d1382434-Reviews-or10-House_of_Blues_Boston-Boston_Massachusetts.html"
      ]
    }
  },
  "kenmore-jefes-01": {
    "hours": {
      "mon": [
        "08:00",
        "03:00"
      ],
      "tue": [
        "08:00",
        "03:00"
      ],
      "wed": [
        "08:00",
        "03:00"
      ],
      "thu": [
        "08:00",
        "03:00"
      ],
      "fri": [
        "08:00",
        "03:00"
      ],
      "sat": [
        "08:00",
        "03:00"
      ],
      "sun": [
        "08:00",
        "03:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "533 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://eljefestaqueria.com/locations/kenmore-square/",
      "phone": "617-644-0126",
      "hours_verified": true,
      "hours_note": "Open daily until 03:00 the following morning.",
      "hours_source": "https://eljefestaqueria.com/locations/",
      "awards": [],
      "ratings": [
        {
          "source": "Google",
          "rating": 4.8,
          "count": 733,
          "url": "https://restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston"
        }
      ],
      "review_highlights": [
        "Reviewers praise generous burritos and bowls, fresh toppings, and good value.",
        "Customers frequently mention quick service, including during the lunch rush.",
        "Some delivery reviewers report missing toppings or incorrect ingredients."
      ],
      "review_sources": [
        "https://restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston",
        "https://es.restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston"
      ]
    }
  },
  "kenmore-eastern-01": {
    "hours": {
      "mon": [
        "11:30",
        "22:00"
      ],
      "tue": [
        "11:30",
        "22:00"
      ],
      "wed": [
        "11:30",
        "22:00"
      ],
      "thu": [
        "11:30",
        "22:00"
      ],
      "fri": [
        "11:30",
        "23:00"
      ],
      "sat": [
        "11:00",
        "23:00"
      ],
      "sun": [
        "11:00",
        "20:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "775 Beacon Street, Boston, MA 02215",
      "website": "https://www.easternstandardboston.com/",
      "phone": "617-530-1590",
      "hours_verified": true,
      "hours_note": "Dining hours shown. Limited menu 15:00–16:00 daily. Bar closes 23:00 Mon–Thu, midnight Fri–Sat, and 21:00 Sun.",
      "hours_source": "https://www.easternstandardboston.com/location/hours/",
      "awards": [],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.6,
          "count": 1382,
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        }
      ],
      "review_highlights": [
        "Critics praise the return of brasserie staples such as lamb-sausage rigatoni, steak frites, and roast chicken.",
        "Diners frequently commend attentive service and cocktails, though some consider the meal expensive.",
        "The larger, polished dining room suits celebrations and meals before Fenway events."
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/eastern-standard-kitchen-bar",
        "https://www.opentable.com/r/eastern-standard-boston-1",
        "https://www.bostonmagazine.com/restaurants/best-restaurants-fenway-neighborhood/"
      ]
    }
  },
  "kenmore-esplanade-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-21",
      "address": "Storrow Drive, Boston, MA",
      "website": "https://esplanade.org/",
      "phone": "617-727-4708",
      "hours_verified": false,
      "hours_note": "Open dawn to dusk daily, with exceptions for walk-through traffic and permitted events.",
      "hours_source": "https://esplanade.org/the-esplanade/esplanade-faqs/",
      "awards": [
        {
          "title": "Boston Landmark designation",
          "org": "City of Boston",
          "year": 2009,
          "url": "https://www.boston.gov/news/enhancing-boston-landmark-charlesbank-and-smith-family-pavilion-charles-river-esplanade"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.6,
          "count": 764,
          "url": "https://www.tripadvisor.com/AttractionsNear-g60745-d1382434-House_of_Blues_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Visitors praise the river views, sunset photography, and long paths for walking, running, and cycling.",
        "Shaded lawns and waterside docks are popular for picnics and relaxing.",
        "Some reviewers mention traffic noise from Storrow Drive and difficulty finding parking."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Attraction_Review-g60745-d142572-Reviews-Charles_River_Esplanade-Boston_Massachusetts.html"
      ]
    }
  },
  "harvard-bookstore-01": {
    "hours": {
      "mon": [
        "09:00",
        "22:00"
      ],
      "tue": [
        "09:00",
        "22:00"
      ],
      "wed": [
        "09:00",
        "22:00"
      ],
      "thu": [
        "09:00",
        "22:00"
      ],
      "fri": [
        "09:00",
        "22:00"
      ],
      "sat": [
        "09:00",
        "22:00"
      ],
      "sun": [
        "10:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "1256 Massachusetts Avenue, Cambridge, MA 02138",
      "website": "https://www.harvard.com/",
      "phone": "617-661-1515",
      "hours_verified": true,
      "hours_note": "Regular store hours; used-book buying has a separate schedule.",
      "hours_source": "https://www.harvard.com/about/hours_directions",
      "awards": [
        {
          "title": "Eight best bookstores around Boston",
          "org": "The Boston Globe",
          "year": 2024,
          "url": "https://www.bostonglobe.com/2024/07/11/magazine/best-bookstores-in-boston-brookline-cambridge-somerville/"
        },
        {
          "title": "Best of Boston: Best Old-School Bookstore",
          "org": "Boston Magazine",
          "year": 2022,
          "url": "https://www.bostonmagazine.com/best-of-boston-2022/shopping/"
        },
        {
          "title": "Best of Boston: Best Virtual Author Series",
          "org": "Boston Magazine",
          "year": 2021,
          "url": "https://www.harvard.com/about/history"
        },
        {
          "title": "Bookseller of the Year",
          "org": "Publishers Weekly",
          "year": 2002,
          "url": "https://www2.publishersweekly.com/pw/print/20020304/36540-harvard-book-store-is-pw-s-bookseller-of-the-year.html"
        }
      ],
      "ratings": [
        {
          "source": "Google",
          "rating": 4.7,
          "count": 2849,
          "url": "https://wanderlog.com/place/details/421970/harvard-book-store"
        },
        {
          "source": "Yelp",
          "rating": 4.4,
          "count": 375,
          "url": "https://www.giftly.com/gift-card/harvard-book-store-cambridge"
        }
      ],
      "review_highlights": [
        "Readers praise the selection of new books upstairs and used titles downstairs.",
        "The basement draws repeat visits for inexpensive finds, including art books and cookbooks.",
        "Critics highlight staff recommendations and substantial philosophy and cultural-theory sections."
      ],
      "review_sources": [
        "https://www.giftly.com/gift-card/harvard-book-store-cambridge",
        "https://www.timeout.com/boston/shopping/harvard-book-store",
        "https://wanderlog.com/place/details/421970/harvard-book-store"
      ]
    }
  },
  "harvard-felipes-01": {
    "hours": {
      "mon": [
        "07:00",
        "01:00"
      ],
      "tue": [
        "07:00",
        "01:00"
      ],
      "wed": [
        "07:00",
        "01:00"
      ],
      "thu": [
        "07:00",
        "02:00"
      ],
      "fri": [
        "07:00",
        "02:00"
      ],
      "sat": [
        "07:00",
        "02:00"
      ],
      "sun": [
        "07:00",
        "01:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "21 Brattle Street, Cambridge, MA 02138",
      "website": "https://www.felipesboston.com/",
      "phone": "617-354-9944",
      "hours_verified": true,
      "hours_note": "Official contact section lists a 07:00 opening, but its footer says 11:00; confirm morning service. Rooftop availability is seasonal.",
      "hours_source": "https://www.felipesboston.com/contact",
      "awards": [
        {
          "title": "The Best Restaurants and Cafes in Harvard Square",
          "org": "Boston Magazine",
          "year": 2026,
          "url": "https://www.bostonmagazine.com/restaurants/best-harvard-square-restaurants/"
        },
        {
          "title": "The Top Rooftop Bars and Restaurants in Boston",
          "org": "Boston Magazine",
          "year": 2026,
          "url": "https://www.bostonmagazine.com/restaurants/best-rooftop-restaurants-bars-boston/"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Harvard Square",
          "org": "Boston Magazine",
          "year": 2019,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2019/felipes-taqueria/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 232,
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60890-d883879-Reviews-or15-Felipe_s_Taqueria-Cambridge_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers praise filling burritos and tacos for their value and freshly prepared ingredients.",
        "The Infatuation recommends the chimichanga topped with queso and notes that ordering lines generally move quickly.",
        "Frozen margaritas and the rooftop draw a lively crowd; seating can be limited when the roof is busy."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d883879-Reviews-Felipe_s_Taqueria-Cambridge_Massachusetts.html",
        "https://www.theinfatuation.com/boston/reviews/felipes-mexican-taqueria",
        "https://www.bostonmagazine.com/restaurants/best-rooftop-restaurants-bars-boston/"
      ]
    }
  },
  "harvard-tatte-01": {
    "hours": {
      "mon": [
        "07:00",
        "20:30"
      ],
      "tue": [
        "07:00",
        "20:30"
      ],
      "wed": [
        "07:00",
        "19:00"
      ],
      "thu": [
        "07:00",
        "20:30"
      ],
      "fri": [
        "07:00",
        "20:30"
      ],
      "sat": [
        "07:00",
        "20:30"
      ],
      "sun": [
        "07:30",
        "19:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "1288 Massachusetts Avenue, Cambridge, MA 02138",
      "website": "https://tattebakery.com/locations/ma/cambridge/1288-massachusetts-ave/",
      "phone": "617-714-4956",
      "hours_verified": true,
      "hours_note": "Official page currently lists Wednesday closing at 19:00. Holiday hours may differ.",
      "hours_source": "https://tattebakery.com/locations/ma/cambridge/1288-massachusetts-ave/",
      "awards": [
        {
          "title": "Where To Eat And Drink In Harvard Square",
          "org": "The Infatuation",
          "year": 2019,
          "url": "https://www.theinfatuation.com/boston/guides/where-to-eat-and-drink-in-harvard-square"
        }
      ],
      "ratings": [
        {
          "source": "Google",
          "rating": 4.4,
          "count": 2948,
          "url": "https://www.google.com/maps/search/Breakfast%2Bat%2BTatte%2BBakery%2C%2BBoston%2C%2BMA"
        },
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 193,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60890-d11698527-Reviews-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Critics praise the chocolate hazelnut brioche and espresso mocha mousse, alongside savory choices such as shakshuka and tartines.",
        "The two-story seating area attracts students with laptops and books, and tables can be crowded.",
        "Customers frequently praise pastries and breakfast sandwiches, though some report slow service or incomplete takeaway orders."
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/tatte-bakery-cafe",
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d11698527-Reviews-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
      ]
    }
  },
  "harvard-art-01": {
    "hours": {
      "tue": [
        "10:00",
        "17:00"
      ],
      "wed": [
        "10:00",
        "17:00"
      ],
      "thu": [
        "10:00",
        "17:00"
      ],
      "fri": [
        "10:00",
        "17:00"
      ],
      "sat": [
        "10:00",
        "17:00"
      ],
      "sun": [
        "10:00",
        "17:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "32 Quincy Street, Cambridge, MA 02138",
      "website": "https://harvardartmuseums.org/",
      "phone": "617-495-9400",
      "hours_verified": true,
      "hours_note": "Last Thursday of each month until 21:00, holidays permitting. Closed Mondays, Thanksgiving, and selected holidays.",
      "hours_source": "https://harvardartmuseums.org/visit/policies/hours-closings",
      "awards": [
        {
          "title": "Harleston Parker Medal for the museums' renovation and expansion",
          "org": "Boston Society for Architecture",
          "year": 2021,
          "url": "https://www.architects.org/harleston-parker-medal"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.6,
          "count": 563,
          "url": "https://www.tripadvisor.ca/Attractions-g60890-Activities-c49-Cambridge_Massachusetts.html"
        },
        {
          "source": "Google",
          "rating": 4.8,
          "count": 3896,
          "url": "https://wanderlog.com/place/details/28415/museus-de-arte-de-harvard"
        }
      ],
      "review_highlights": [
        "Visitors praise the range of paintings and historic objects across several floors, particularly with free admission.",
        "The glass-roofed courtyard and natural light are recurring highlights, with places to rest between galleries.",
        "Reviewers often describe a manageable visit of around two hours and enough space to view the collections comfortably."
      ],
      "review_sources": [
        "https://wanderlog.com/place/details/28415/museus-de-arte-de-harvard",
        "https://www.timeout.com/boston/museums/harvard-art-museums"
      ]
    }
  },
  "chinatown-heila-01": {
    "hours": {
      "mon": [
        "10:00",
        "21:00"
      ],
      "tue": [
        "10:00",
        "21:00"
      ],
      "wed": [
        "10:00",
        "21:00"
      ],
      "thu": [
        "10:00",
        "21:00"
      ],
      "fri": [
        "10:00",
        "22:00"
      ],
      "sat": [
        "09:00",
        "22:00"
      ],
      "sun": [
        "09:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "83 Essex St, Boston, MA 02111",
      "website": "https://www.heilamoonrestaurant.com/",
      "phone": "617-338-8813",
      "hours_verified": true,
      "hours_note": "Published business hours; dim sum carts operate on weekends. Conflicting schedules exist, so confirm before visiting.",
      "hours_source": "https://www.heilamoonrestaurant.com/",
      "awards": [
        {
          "title": "The Best Places to Eat in Boston's Chinatown",
          "org": "Eater Boston",
          "year": 2026,
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "The Best Chinese Restaurants Around Boston",
          "org": "Eater Boston",
          "year": 2025,
          "url": "https://boston.eater.com/maps/best-chinese-food-boston"
        },
        {
          "title": "Best of Boston: Best Brunch, with Foodie Friends",
          "org": "Boston Magazine",
          "year": 2006,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2006/hei-la-moon/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.7,
          "count": 322,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d535527-Reviews-Hei_La_Moon-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Critics recommend the taro dumplings, steamed roast pork buns, and bok choy with oyster sauce.",
        "Diners appreciate the substantial dumpling portions and weekend cart service.",
        "Recurring complaints concern uneven table service and dim sum arriving lukewarm."
      ],
      "review_sources": [
        "https://boston.eater.com/maps/best-chinese-food-boston",
        "https://boston.eater.com/maps/best-restaurants-chinatown-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d535527-Reviews-Hei_La_Moon-Boston_Massachusetts.html"
      ]
    }
  },
  "chinatown-winsor-01": {
    "hours": {
      "mon": [
        "10:00",
        "20:00"
      ],
      "tue": [
        "10:00",
        "20:00"
      ],
      "wed": [
        "10:00",
        "20:00"
      ],
      "thu": [
        "10:00",
        "20:00"
      ],
      "fri": [
        "10:00",
        "20:00"
      ],
      "sat": [
        "10:00",
        "20:00"
      ],
      "sun": [
        "10:00",
        "20:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "10 Tyler St, Boston, MA 02111",
      "website": null,
      "phone": "617-338-1688",
      "hours_verified": true,
      "hours_note": "Eater lists 10:00–20:00 daily; other listings disagree, so confirm before visiting.",
      "hours_source": "https://boston.eater.com/venue/49145/winsor-dim-sum-caf",
      "awards": [
        {
          "title": "The Best Places to Eat in Boston's Chinatown",
          "org": "Eater Boston",
          "year": 2026,
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "The Best Brunches Around Boston",
          "org": "Eater Boston",
          "year": 2026,
          "url": "https://boston.eater.com/maps/best-boston-brunch-restaurants"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 230,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d1048503-Reviews-Winsor_Dim_Sum_Cafe-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Critics particularly praise the turnip cakes, rice noodle rolls, and preserved egg and pork congee.",
        "Dim sum is ordered from a checklist and made to order rather than selected from rolling carts.",
        "The small dining room can mean waits and shared tables; diners report mixed service experiences."
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/winsor-dim-sum-cafe",
        "https://boston.eater.com/maps/best-boston-brunch-restaurants",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d1048503-Reviews-Winsor_Dim_Sum_Cafe-Boston_Massachusetts.html"
      ]
    }
  },
  "chinatown-genes-01": {
    "hours": {
      "mon": [
        "11:00",
        "18:30"
      ],
      "tue": [
        "11:00",
        "18:30"
      ],
      "wed": [
        "11:00",
        "18:30"
      ],
      "thu": [
        "11:00",
        "18:30"
      ],
      "fri": [
        "11:00",
        "18:30"
      ],
      "sat": [
        "11:00",
        "18:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "86 Bedford St, Boston, MA 02111",
      "website": "https://www.genescafeboston.com/",
      "phone": "617-482-1888",
      "hours_verified": true,
      "hours_note": "Closed Sundays; published hours cover lunch and early dinner.",
      "hours_source": "https://www.genescafeboston.com/contact.shtml",
      "awards": [
        {
          "title": "The Best Chinese Restaurants Around Boston",
          "org": "Eater Boston",
          "year": 2025,
          "url": "https://boston.eater.com/maps/best-chinese-food-boston"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": 41,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d6033876-Reviews-Gene_s_Chinese_Flatbread_Cafe-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "The thick, chewy hand-pulled noodles are the main draw, particularly the garlicky chile version and cumin lamb noodles.",
        "Reviewers praise the filling portions and value, while noting the tiny, basic counter-service space.",
        "The pork flatbread sandwiches have fans, although critics describe them as oily."
      ],
      "review_sources": [
        "https://boston.eater.com/maps/best-chinese-food-boston",
        "https://www.theinfatuation.com/boston/reviews/genes-chinese-flatbread-cafe",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d6033876-Reviews-Gene_s_Chinese_Flatbread_Cafe-Boston_Massachusetts.html"
      ]
    }
  },
  "chinatown-hoyuen-01": {
    "hours": {
      "mon": [
        "08:00",
        "18:00"
      ],
      "tue": [
        "08:00",
        "18:00"
      ],
      "wed": [
        "08:00",
        "18:00"
      ],
      "thu": [
        "08:00",
        "18:00"
      ],
      "fri": [
        "08:00",
        "18:00"
      ],
      "sat": [
        "08:00",
        "18:00"
      ],
      "sun": [
        "08:00",
        "18:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "54 Beach St, Suite 1, Boston, MA 02111",
      "website": null,
      "phone": "617-426-8320",
      "hours_verified": true,
      "hours_note": "Listing hours are 08:00–18:00 daily; no official hours page was verified.",
      "hours_source": "https://www.tripadvisor.com/Restaurant_Review-g60745-d8845585-Reviews-Ho_Yuen-Boston_Massachusetts.html",
      "awards": [
        {
          "title": "9 Great Bakeries in Boston's Chinatown",
          "org": "Eater Boston",
          "year": 2022,
          "url": "https://boston.eater.com/maps/best-bakeries-boston-chinatown"
        },
        {
          "title": "Best of Boston: Best Pastry, Chinese",
          "org": "Boston Magazine",
          "year": 1982,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1982/ho-yuen-bakery/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.9,
          "count": 12,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d8845585-Reviews-Ho_Yuen-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers repeatedly recommend the pineapple buns, coconut buns, egg tarts, and roast pork buns.",
        "Eater highlights the curry beef buns and mooncakes available throughout the year.",
        "Customers value the inexpensive traditional pastries; the shop is small and counter service is brisk."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d8845585-Reviews-Ho_Yuen-Boston_Massachusetts.html",
        "https://boston.eater.com/maps/best-bakeries-boston-chinatown",
        "https://www.restaurantji.com/ma/boston/ho-yuen-bakery-inc-/"
      ]
    }
  },
  "chinatown-q-01": {
    "hours": {
      "mon": [
        "11:30",
        "22:00"
      ],
      "tue": [
        "11:30",
        "22:00"
      ],
      "wed": [
        "11:30",
        "22:00"
      ],
      "thu": [
        "11:30",
        "23:00"
      ],
      "fri": [
        "11:30",
        "00:00"
      ],
      "sat": [
        "11:30",
        "00:00"
      ],
      "sun": [
        "11:30",
        "23:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "660 Washington St, Boston, MA 02111",
      "website": "https://thequsa.com/",
      "phone": "857-350-3968",
      "hours_verified": true,
      "hours_note": "Friday and Saturday service ends at midnight. Holiday hours may differ.",
      "hours_source": "https://thequsa.com/",
      "awards": [
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Chinatown",
          "org": "Boston Magazine",
          "year": 2022,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2022/q-restaurant-2/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.5,
          "count": 589,
          "url": "https://www.tripadvisor.com/Restaurants-g60745-zfn8393201-Boston_Massachusetts.html"
        },
        {
          "source": "OpenTable",
          "rating": 4.8,
          "count": 747,
          "url": "https://www.opentable.com/r/the-q-restaurant-boston"
        }
      ],
      "review_highlights": [
        "Diners praise the choice of hot-pot broths, divided pots for two flavors, and fresh meat and vegetables.",
        "Helpful servers receive repeated praise for explaining hot pot to first-time customers.",
        "Sushi and cocktails are additional draws; busy evening service can bring substantial waits for walk-ins."
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d2285799-Reviews-Q_Restaurant-Boston_Massachusetts.html",
        "https://www.bostonmagazine.com/best-of-boston-archive/2022/q-restaurant-2/"
      ]
    }
  },
  "chinatown-taiwan-01": {
    "hours": {
      "mon": [
        "11:00",
        "00:00"
      ],
      "tue": [
        "11:00",
        "00:00"
      ],
      "wed": [
        "11:00",
        "00:00"
      ],
      "thu": [
        "11:00",
        "00:00"
      ],
      "fri": [
        "11:00",
        "01:00"
      ],
      "sat": [
        "11:00",
        "01:00"
      ],
      "sun": [
        "11:00",
        "00:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-21",
      "address": "34 Oxford St, Boston, MA 02111",
      "website": "https://ordertaiwancafe.com/",
      "phone": "617-426-8181",
      "hours_verified": true,
      "hours_note": "Closes at midnight Sunday–Thursday and at 01:00 the following morning Friday–Saturday.",
      "hours_source": "https://ordertaiwancafe.com/Home/index",
      "awards": [
        {
          "title": "The Best Places to Eat in Boston's Chinatown",
          "org": "Eater Boston",
          "year": 2026,
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Chinatown",
          "org": "Boston Magazine",
          "year": 2024,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2024/taiwan-cafe/"
        },
        {
          "title": "Best of Boston: Best Chinese Restaurant",
          "org": "Boston Magazine",
          "year": 2014,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2014/taiwan-caf-2/"
        },
        {
          "title": "Best of Boston: Best Chinese Restaurant",
          "org": "Boston Magazine",
          "year": 2002,
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2002/taiwan-caf/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 176,
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d321563-Reviews-Taiwan_Cafe-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Critics recommend the Taiwan-style pan-fried dumplings, roast beef scallion-pancake rolls, and beef noodle soup.",
        "Diners frequently praise generous portions and food arriving quickly.",
        "The small dining room can be crowded and noisy, with shared tables; several diners find the spicy dishes hotter than expected."
      ],
      "review_sources": [
        "https://www.bostonmagazine.com/best-of-boston-archive/2024/taiwan-cafe/",
        "https://boston.eater.com/maps/best-restaurants-chinatown-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321563-Reviews-Taiwan_Cafe-Boston_Massachusetts.html"
      ]
    }
  }
};

/** Overlays researched hours, names and details onto a catalog place. */
export function applyPlaceFacts(place: Place): Place {
  const facts = PLACE_FACTS[place.id];
  if (!facts) return place;
  if (facts.name) place.name = facts.name;
  if (facts.vibe) place.vibe = facts.vibe;
  if (facts.hours) place.hours = structuredClone(facts.hours);
  place.details = structuredClone(facts.details);
  return place;
}
