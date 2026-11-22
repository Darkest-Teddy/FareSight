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
 * Researched from official sites, public review platforms and press (see each entry's sources and checked_on date).
 * Ratings are snapshots of third-party listings and drift over time. Demo venues have no entry.
 */
export const PLACE_FACTS: Record<string, PlaceFacts> = {
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
      "checked_on": "2026-11-22",
      "address": "736 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://pavementcoffeehouse.com/pages/boston_university",
      "phone": "617-766-6048",
      "hours_verified": true,
      "hours_note": "BU location page hours; the official locations directory instead lists 07:00–19:00 daily. Confirm weekend closing before visiting.",
      "hours_source": "https://pavementcoffeehouse.com/pages/boston_university",
      "awards": [
        {
          "title": "Global Tastemakers: featured Boston café in The Top US Cities for Coffee",
          "org": "Food & Wine",
          "year": 2026,
          "scope": "national",
          "url": "https://www.foodandwine.com/top-united-states-cities-for-coffee-in-2026-11930933"
        },
        {
          "title": "Boston city guide: Pavement Coffeehouse",
          "org": "Bon Appétit",
          "year": null,
          "scope": "national",
          "url": "https://www.bonappetit.com/city-guides/boston/venue/pavement-coffeehouse"
        },
        {
          "title": "The best bagels in Boston",
          "org": "Time Out Boston",
          "year": 2026,
          "scope": "local",
          "url": "https://www.timeout.com/boston/restaurants/best-bagels-in-boston"
        },
        {
          "title": "Where to Eat at BU When You’re Hungry",
          "org": "BU Today",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bu.edu/articles/2026/where-to-eat-when-youre-hungry-at-bu/"
        },
        {
          "title": "The Top Places People Go in Boston: No. 2 for coffee",
          "org": "Boston Magazine / Foursquare",
          "year": 2013,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/news/2013/02/05/foursquare-top-places-to-go-boston-2012/"
        },
        {
          "title": "Best of Boston: Best Coffee Shop (Berklee branch)",
          "org": "Boston Magazine",
          "year": 2012,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2012/pavement-coffeehouse/"
        },
        {
          "title": "Best Coffee Shops Around Boston",
          "org": "Boston Magazine",
          "year": null,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-coffee-boston/"
        },
        {
          "title": "Where to Wake Up with the Perfect Breakfast Sandwich in Boston",
          "org": "Boston Magazine",
          "year": null,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-breakfast-sandwiches-boston/"
        },
        {
          "title": "Best Cafés for Studying and Working (Brighton branch)",
          "org": "Boston Magazine",
          "year": null,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-cafes-studying/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.7,
          "count": 14,
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d9763872-Reviews-Pavement_Coffee_House-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.2,
          "count": 388,
          "url": "https://restaurantguru.com/Pavement-Coffeehouse-Boston-4"
        },
        {
          "source": "Zomato (via Restaurant Guru)",
          "rating": 3.9,
          "count": 31,
          "url": "https://restaurantguru.com/Pavement-Coffeehouse-Boston-4"
        },
        {
          "source": "Toast",
          "rating": 4.7,
          "count": 237,
          "url": "https://toast.app/r/pavement-coffeehouse-boston-university-736-commonwealth-avenue"
        }
      ],
      "review_highlights": [
        "Bagels, breakfast sandwiches and coffee receive repeated praise.",
        "Customers like the comfortable atmosphere for studying or lingering, although one recent reviewer wanted more electrical outlets.",
        "High prices and uneven counter service recur in complaints.",
        "One reviewer returned the next day for another elote bagel with veggie cream cheese."
      ],
      "review_excerpts": [
        {
          "author": "s k",
          "source": "Google",
          "text": "The bagels were good, but the service was just so bad.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Pavement-Coffeehouse-Boston-4"
        },
        {
          "author": "Cami C.",
          "source": "Yelp",
          "text": "Pavement is always a good choice for coffee and bagels!",
          "rating": null,
          "date_label": "February 15, 2026",
          "url": "https://maps.roadtrippers.com/us/boston-ma/food-drink/pavement-coffeehouse"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d9763872-Reviews-Pavement_Coffee_House-Boston_Massachusetts.html",
        "https://restaurantguru.com/Pavement-Coffeehouse-Boston-4",
        "https://maps.roadtrippers.com/us/boston-ma/food-drink/pavement-coffeehouse",
        "https://toast.app/r/pavement-coffeehouse-boston-university-736-commonwealth-avenue"
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
      "checked_on": "2026-11-22",
      "address": "738 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.nudpob.us/",
      "phone": "617-232-9992",
      "hours_verified": true,
      "hours_note": "Advertised outer span. Restaurantji reports a daily 15:00–16:00 break; online ordering may stop at 21:30.",
      "hours_source": "https://www.nudpobthaicuisine.com/contact-us/",
      "awards": [
        {
          "title": "Where to Eat at BU When You’re Hungry",
          "org": "BU Today",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bu.edu/articles/2026/where-to-eat-when-youre-hungry-at-bu/"
        },
        {
          "title": "Iconic Boston University restaurants: Then and now",
          "org": "Boston University Alumni & Friends",
          "year": 2025,
          "scope": "local",
          "url": "https://www.bu.edu/alumni/2025/02/21/blog-iconic-bu-restaurants/"
        },
        {
          "title": "Guide to Commonwealth Ave Shops, Dining, and Spots",
          "org": "BU Today",
          "year": 2024,
          "scope": "local",
          "url": "https://www.bu.edu/articles/2024/guide-to-commonwealth-ave-shops-dining/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.8,
          "count": 17,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d323800-Reviews-Nud_POB_Thai_Restaurant-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.1,
          "count": 208,
          "url": "https://www.restaurantji.com/ma/boston/nud-pob-thai-cuisine-/"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.4,
          "count": 478,
          "url": "https://restaurantguru.com/Nud-Pob-Thai-Cuisine-Boston"
        },
        {
          "source": "Zomato (via Restaurant Guru)",
          "rating": 3.5,
          "count": 22,
          "url": "https://restaurantguru.com/Nud-Pob-Thai-Cuisine-Boston"
        }
      ],
      "review_highlights": [
        "Customers repeatedly praise quick preparation and affordable, filling meals.",
        "Pad Thai, pad see ew and Indonesian fried rice are recurring favorites.",
        "Older critical reviews describe greasy food, mushy noodles and uneven service."
      ],
      "review_excerpts": [
        {
          "author": "Natalia Fominykh",
          "source": "Google",
          "text": "Pretty tasty food, nice and friendly staff, and the food was ready very quickly.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Nud-Pob-Thai-Cuisine-Boston"
        },
        {
          "author": "John Hegger",
          "source": "Google",
          "text": "Pineapple Fried Rice, Red Curry with Seafood and Crispy Pork Basil. Very affordable!",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Nud-Pob-Thai-Cuisine-Boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d323800-Reviews-Nud_POB_Thai_Restaurant-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/nud-pob-thai-cuisine-/",
        "https://www.bu.edu/alumni/2025/02/21/blog-iconic-bu-restaurants/",
        "https://restaurantguru.com/Nud-Pob-Thai-Cuisine-Boston"
      ]
    }
  },
  "bu-halal-01": {
    "hours": null,
    "details": {
      "checked_on": "2026-11-22",
      "address": "George Sherman Union Food Hall, 775 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.bu.edu/dining/location/the-halal-shack/",
      "phone": "617-358-1885",
      "hours_verified": false,
      "hours_note": "Thanksgiving 2026: closed November 21; open November 22–23, 11:00–19:00; closed November 24–29.",
      "hours_source": "https://www.bu.edu/dining/thanksgiving-week-2026/",
      "awards": [
        {
          "title": "Restaurant review: The Halal Shack at the GSU",
          "org": "BU Today",
          "year": 2023,
          "scope": "local",
          "url": "https://www.bu.edu/articles/2023/gsu-halal-shack-restaurant-review/"
        }
      ],
      "ratings": [
        {
          "source": "GuideToBU",
          "rating": 4.5,
          "count": 234,
          "url": "https://www.guidetobu.com/food/halal-shack/"
        }
      ],
      "review_highlights": [
        "BU Today's 2023 reviewers praised filling portions, seasoned rice and spicy chicken, although one found the beef dry.",
        "Crispy cauliflower with tahini and fresh vegetable toppings stood out among the vegetarian options.",
        "The reviewers flagged extra charges for premium additions, and one found the falafel small and bland.",
        "One BU Today reviewer received his bowl within a few minutes."
      ],
      "review_excerpts": [
        {
          "author": "Sam Thomas",
          "source": "BU Today",
          "text": "My meal was ready within a few minutes",
          "rating": null,
          "date_label": "November 3, 2023",
          "url": "https://www.bu.edu/articles/2023/gsu-halal-shack-restaurant-review/"
        },
        {
          "author": "Sujena Soumyanath",
          "source": "BU Today",
          "text": "Coated in golden batter, the cauliflower blended perfectly with the wrap’s tangy tahini sauce.",
          "rating": null,
          "date_label": "November 3, 2023",
          "url": "https://www.bu.edu/articles/2023/gsu-halal-shack-restaurant-review/"
        }
      ],
      "review_sources": [
        "https://www.bu.edu/articles/2023/gsu-halal-shack-restaurant-review/",
        "https://www.guidetobu.com/food/halal-shack/"
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
          "scope": "local",
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
      "checked_on": "2026-11-22",
      "address": "712 Commonwealth Avenue, Suite 2, Boston, MA 02215",
      "website": "https://ugrillboston.com/",
      "phone": "617-247-7120",
      "hours_verified": false,
      "hours_note": "Restaurantji lists closing at 20:00 weekdays and 15:00 Saturday. MenuPix lists 22:00 Monday–Saturday. Both list Sunday closed. Call for current hours.",
      "hours_source": "https://www.restaurantji.com/ma/boston/university-grill-and-pizza-/",
      "awards": [
        {
          "title": "Terrier Favorites: Pizza Edition (first-round contender)",
          "org": "Boston University Alumni & Friends",
          "year": 2023,
          "scope": "local",
          "url": "https://www.bu.edu/alumni/2023/02/22/blog-terrier-favorites-pizza-edition/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 12,
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.2,
          "count": 82,
          "url": "https://www.restaurantji.com/ma/boston/university-grill-and-pizza-/"
        },
        {
          "source": "MenuPix",
          "rating": 4.2,
          "count": 28,
          "url": "https://www.menupix.com/boston/restaurants/1134/University-Grill-Boston-MA"
        }
      ],
      "review_highlights": [
        "Gyros receive repeated praise for flavorful meat and handmade pita.",
        "Reviewers often highlight friendly staff and good value across pizza, subs and Greek dishes.",
        "The setting is informal and suited to takeout; one older reviewer reported slow service and very limited seating."
      ],
      "review_excerpts": [
        {
          "author": "shellshock422",
          "source": "Tripadvisor",
          "text": "These were the best gyros next to the ones we had in Greece.",
          "rating": 5,
          "date_label": "November 2021",
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html"
        },
        {
          "author": "TravelinFamilyBoston",
          "source": "Tripadvisor",
          "text": "Subs, chicken parm, pizza, moussaka are all delicious.",
          "rating": 5,
          "date_label": "May 2020",
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.ca/Restaurant_Review-g60745-d323521-Reviews-University_Grill_Pizza-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/university-grill-and-pizza-/",
        "https://www.menupix.com/boston/restaurants/1134/University-Grill-Boston-MA"
      ]
    }
  },
  "bu-starbucks-01": {
    "hours": {
      "mon": [
        "07:00",
        "20:00"
      ],
      "tue": [
        "07:00",
        "20:00"
      ],
      "wed": [
        "07:00",
        "20:00"
      ],
      "thu": [
        "07:00",
        "20:00"
      ],
      "fri": [
        "07:00",
        "20:00"
      ],
      "sat": [
        "09:00",
        "19:00"
      ],
      "sun": [
        "09:00",
        "19:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "700 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.bu.edu/dining/location/starbucks/",
      "phone": "617-358-5450",
      "hours_verified": true,
      "hours_note": "Typical hours match OpenHours and BU Dining’s published November 22–23 hours. BU lists 07:00–16:00 on November 24 and closure November 25–27. Check BU Dining for holiday hours.",
      "hours_source": "https://www.bu.edu/dining/location/starbucks/",
      "awards": [],
      "ratings": [
        {
          "source": "Restaurantji",
          "rating": 2.3,
          "count": 47,
          "url": "https://www.restaurantji.com/ma/boston/starbucks-49/"
        },
        {
          "source": "MenuPix",
          "rating": 3.8,
          "count": 15,
          "url": "https://www.menupix.com/boston/restaurants/31639969/Starbucks-Boston-MA"
        },
        {
          "source": "Tripadvisor",
          "rating": 4.8,
          "count": 4,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d5075065-Reviews-Starbucks-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "One regular reported repeated iced drinks when ordering hot through the app.",
        "A reviewer reported a roughly 15-minute wait during a rush and a billing correction after a remake.",
        "Another reviewer praised staff for remembering regulars’ drinks and keeping up between classes.",
        "An older Tripadvisor review singled out the hot peppermint latte."
      ],
      "review_excerpts": [
        {
          "author": "Aby Normal",
          "source": "Google",
          "text": "They keep giving me an iced drink when I order a hot one.",
          "rating": null,
          "date_label": null,
          "url": "https://www.restaurantji.com/ma/boston/starbucks-49/comments/"
        },
        {
          "author": "Penny Byte",
          "source": "Tripadvisor",
          "text": "the warm peppermint latte I had warmed me up from the inside out.",
          "rating": null,
          "date_label": "March 2019",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d5075065-Reviews-Starbucks-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.restaurantji.com/ma/boston/starbucks-49/comments/",
        "https://www.restaurantji.com/ma/boston/starbucks/",
        "https://www.restaurantji.com/ma/boston/starbucks-49/",
        "https://www.menupix.com/boston/restaurants/31639969/Starbucks-Boston-MA",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d5075065-Reviews-Starbucks-Boston_Massachusetts.html"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://www.boston.com/community/readers-say/best-thai-food-in-greater-boston/"
        },
        {
          "title": "The 15 Best Thai Restaurants in Boston",
          "org": "Boston Magazine",
          "year": 2021,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/the-best-thai-restaurants-in-boston/"
        },
        {
          "title": "Best of Boston: Best Thai Restaurant",
          "org": "Boston Magazine",
          "year": 2012,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2012/brown-sugar-caf-4/"
        },
        {
          "title": "Best of Boston: Best Thai Restaurant",
          "org": "Boston Magazine",
          "year": 2008,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2008/brown-sugar-caf-3/"
        },
        {
          "title": "Best of Boston: Best Thai Restaurant",
          "org": "Boston Magazine",
          "year": 2001,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2001/brown-sugar-caf/"
        },
        {
          "title": "Best of Boston: Best Thai Restaurant",
          "org": "Boston Magazine",
          "year": 2000,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2000/brown-sugar-cafe/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": 185,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d323080-Reviews-Brown_Sugar_Cafe-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Wanderlog)",
          "rating": 4.5,
          "count": 785,
          "url": "https://wanderlog.com/place/details/1216535/brown-sugar-cafe"
        },
        {
          "source": "Restaurantji",
          "rating": 4.4,
          "count": 253,
          "url": "https://www.restaurantji.com/ma/boston/brown-sugar-cafe-/"
        }
      ],
      "review_highlights": [
        "Readers particularly recommend the pad see ew, yellow curry and lemongrass shrimp tom yum soup.",
        "Time Out recommends exploring the clay-pot dishes and minced-pork omelet, with staff helping explain less familiar choices.",
        "Boston Magazine highlights the fried shrimp cakes and charcoal-grilled meatballs.",
        "Google reviewers praise Thai iced tea and attentive service. Ask staff about gluten-free dishes and fish sauce in vegetarian orders."
      ],
      "review_excerpts": [
        {
          "author": "Oceana H",
          "source": "Google (via Wanderlog)",
          "text": "My Lady in Green dish was absolutely delicious, probably the best yellow curry I've tasted in a dish.",
          "rating": 5,
          "date_label": "Jul 7, 2025",
          "url": "https://wanderlog.com/place/details/1216535/brown-sugar-cafe"
        },
        {
          "author": "Kirtan S",
          "source": "Google (via Wanderlog)",
          "text": "The Thai iced tea is absolutely amazing, probably one of the best around.",
          "rating": 5,
          "date_label": "Jul 17, 2025",
          "url": "https://wanderlog.com/place/details/1216535/brown-sugar-cafe"
        }
      ],
      "review_sources": [
        "https://www.boston.com/community/readers-say/best-thai-food-in-greater-boston/",
        "https://www.timeout.com/boston/restaurants/brown-sugar-cafe",
        "https://www.bostonmagazine.com/restaurants/the-best-thai-restaurants-in-boston/",
        "https://wanderlog.com/place/details/1216535/brown-sugar-cafe",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d323080-Reviews-Brown_Sugar_Cafe-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/brown-sugar-cafe-/"
      ]
    }
  },
  "allston-super88-01": {
    "name": "Hong Kong Supermarket",
    "vibe": "Asian grocery in the former Super 88 building. Food-court stalls have opened and closed, so check what is serving.",
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
      "checked_on": "2026-11-22",
      "address": "1 Brighton Ave, Allston, MA 02134",
      "website": null,
      "phone": "617-787-2288",
      "hours_verified": true,
      "hours_note": "Supermarket hours only, as listed by Chaoshi Weekly and Loc8NearMe. Other directories list later closing times. Food-court reopening and vendor hours remain unverified.",
      "hours_source": "https://www.chaoshiweekly.com/en/store/hongkong-allston",
      "awards": [
        {
          "title": "Where To Eat For Really, Really Cheap In Boston (historic food-court inclusion)",
          "org": "The Infatuation",
          "year": 2022,
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/guides/where-to-eat-for-really-really-cheap-in-Boston"
        },
        {
          "title": "Cheap Eats in Boston: Affordable Dishes from A to Z (historic food-court inclusion)",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/guides/2014/01/28/cheap-eats-boston/3/"
        }
      ],
      "ratings": [
        {
          "source": "Loc8NearMe",
          "rating": 3.6,
          "count": 184,
          "url": "https://www.loc8nearme.com/massachusetts/boston/hong-kong-supermarket/2420748/"
        }
      ],
      "review_highlights": [
        "Shoppers praise the range of Asian noodles, sauces, mushrooms and specialty ingredients.",
        "The free parking lot and Green Line stop make grocery trips convenient.",
        "Some shoppers report inconsistent produce and seafood freshness or higher prices than they expected.",
        "Older reviews cover inexpensive meals at the food court. Check individual stalls before making a food-court trip."
      ],
      "review_excerpts": [
        {
          "author": "Qiu Jessie",
          "source": "Local business directory",
          "text": "Meats are generally good, seafood sometimes is not as fresh, prices are fair.",
          "rating": 3,
          "date_label": null,
          "url": "https://local.ilacfiyati.org/e/hong-kong-supermarket-1"
        },
        {
          "author": "Ben Jen",
          "source": "Local business directory",
          "text": "Free parking lot and next to the Packards Corner Green Line T stop.",
          "rating": 3,
          "date_label": null,
          "url": "https://local.ilacfiyati.org/e/hong-kong-supermarket-1"
        }
      ],
      "review_sources": [
        "https://www.loc8nearme.com/massachusetts/boston/hong-kong-supermarket/2420748/",
        "https://local.ilacfiyati.org/e/hong-kong-supermarket-1",
        "https://www.boston.com/food/food-news/2025/08/05/super-88-food-court-closed/",
        "https://www.theinfatuation.com/boston/reviews/super-88-market-food-connection"
      ]
    }
  },
  "allston-shabuzen-01": {
    "hours": {
      "mon": [
        "11:30",
        "22:30"
      ],
      "tue": [
        "11:30",
        "22:30"
      ],
      "wed": [
        "11:30",
        "22:30"
      ],
      "thu": [
        "11:30",
        "22:30"
      ],
      "fri": [
        "11:30",
        "23:15"
      ],
      "sat": [
        "11:30",
        "23:15"
      ],
      "sun": [
        "11:30",
        "22:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "80 Brighton Ave, Allston, MA 02134",
      "website": "https://www.shabuzen.com/allston-ma-location",
      "phone": "617-203-7378",
      "hours_verified": true,
      "hours_note": "Hours are from the Allston location page. A September 2026 license-transfer filing names a proposed successor at the address. Confirm service before visiting.",
      "hours_source": "https://www.shabuzen.com/allston-ma-location",
      "awards": [
        {
          "title": "Getting to Know Your Neighborhood: Allston",
          "org": "BU Today",
          "year": 2025,
          "scope": "local",
          "url": "https://www.bu.edu/articles/2025/getting-to-know-your-neighborhood-allston/"
        },
        {
          "title": "Best Asian Restaurants in Allston Boston (No. 3 at time of check)",
          "org": "Tripadvisor",
          "year": null,
          "scope": "local",
          "url": "https://www.tripadvisor.com/Restaurants-g60745-c3-zfn15565954-Boston_Massachusetts.html"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.1,
          "count": 73,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d1053064-Reviews-Shabu_Zen-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.3,
          "count": 324,
          "url": "https://www.restaurantji.com/ma/allston/shabu-zen-/"
        }
      ],
      "review_highlights": [
        "Diners praise the original broth, thinly sliced beef and assortment of mushrooms and vegetables.",
        "Individual pots at the counter let diners choose their own broth and ingredients.",
        "Some reviewers find the service slow or the process hard to follow on a first visit.",
        "A parking lot behind the restaurant helps, though it can get crowded at dinner."
      ],
      "review_excerpts": [
        {
          "author": "gcvsd-cy",
          "source": "Tripadvisor",
          "text": "They have tables or you can choose to sit at the counter where each person has their own pot.",
          "rating": null,
          "date_label": "February 19, 2019",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d1053064-Reviews-Shabu_Zen-Boston_Massachusetts.html"
        },
        {
          "author": "emshabem",
          "source": "Tripadvisor",
          "text": "Prices are totally reasonable and it's a lot of food.",
          "rating": null,
          "date_label": "July 4, 2018",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d1053064-Reviews-Shabu_Zen-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d1053064-Reviews-Shabu_Zen-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/allston/shabu-zen-/",
        "https://www.bu.edu/articles/2025/getting-to-know-your-neighborhood-allston/",
        "https://content.boston.gov/public-notices/16624541"
      ]
    }
  },
  "allston-clearflour-01": {
    "hours": {
      "mon": [
        "08:00",
        "17:00"
      ],
      "tue": [
        "08:00",
        "17:00"
      ],
      "wed": [
        "08:00",
        "17:00"
      ],
      "thu": [
        "08:00",
        "17:00"
      ],
      "fri": [
        "08:00",
        "17:00"
      ],
      "sat": [
        "08:00",
        "17:00"
      ],
      "sun": [
        "08:00",
        "17:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "178 Thorndike St, Brookline, MA 02446",
      "website": "https://www.clearflourbread.com/",
      "phone": "617-739-0060",
      "hours_verified": true,
      "hours_note": "Current homepage lists the bakery 08:00–17:00 daily and the coffee bar 08:00–15:00 daily. The press page still shows older bakery hours.",
      "hours_source": "https://www.clearflourbread.com/",
      "awards": [
        {
          "title": "Best cookies across the U.S. and Canada (Massachusetts pick)",
          "org": "Yelp",
          "year": 2021,
          "scope": "international",
          "url": "https://www.boston.com/food/food-news/2021/12/01/clear-flour-bread-best-cookies-in-mass-according-to-yelp/"
        },
        {
          "title": "Best Bread Bakery in Massachusetts (50-state list)",
          "org": "Fast Food Club",
          "year": 2026,
          "scope": "national",
          "url": "https://brooklinerecord.com/articles/clear-flour-bread-named-massachusetts-best-in-national-bakery-ranking-mrlcv0j9"
        },
        {
          "title": "The Absolute Best Bakery In Each State (Massachusetts)",
          "org": "The Takeout",
          "year": 2025,
          "scope": "national",
          "url": "https://wbznewsradio.iheart.com/content/beloved-brookline-bakery-is-named-best-in-massachusetts-on-nationwide-list/"
        },
        {
          "title": "The 100 Best Bakeries in America",
          "org": "Food & Wine",
          "year": 2020,
          "scope": "national",
          "url": "https://s3-us-west-2.amazonaws.com/sites.cahnrs.wsu.edu/wp-content/uploads/sites/17/2020/03/23082741/foodandwine.com-The-100-Best-Bakeries-in-America.pdf"
        },
        {
          "title": "Outstanding Baker semifinalists (Abe Faber and Christy Timon)",
          "org": "James Beard Foundation",
          "year": 2015,
          "scope": "national",
          "url": "https://www.jamesbeard.org/stories/the-2015-restaurant-and-chef-award-semifinalists"
        },
        {
          "title": "Best Croissants in America (listed on bakery press page)",
          "org": "Food & Wine",
          "year": null,
          "scope": "national",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Le Grand Prix Elmendorf du Pain, professional division winner",
          "org": "Elmendorf Baking Supplies & Cafe",
          "year": 2023,
          "scope": "local",
          "url": "https://www.cambridgeday.com/2023/06/12/first-le-grand-prix-elmendorf-du-pain-calls-it-brooklines-clear-flour-has-the-best-baguette/"
        },
        {
          "title": "Greater Boston’s Best Bread Bakeries",
          "org": "Eater Boston",
          "year": 2022,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-bread-bakeries-boston"
        },
        {
          "title": "Ethel Weiss Service Award (Christy Timon and Abe Faber)",
          "org": "Brookline Youth Awards",
          "year": 2017,
          "scope": "local",
          "url": "https://brookline.com/brooklines-clear-flour-bread-bakery-wins-another-award/"
        },
        {
          "title": "Best of Boston: Best Bread Bakery",
          "org": "Boston Magazine",
          "year": 2016,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bakery for Sweets",
          "org": "Boston Magazine",
          "year": 2015,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Croissant",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bakery for Sweets",
          "org": "Boston Magazine",
          "year": 2013,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread Bakery",
          "org": "Boston Magazine",
          "year": 2012,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread Bakery",
          "org": "Boston Magazine",
          "year": 2011,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bakery",
          "org": "Boston Magazine",
          "year": 2010,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread Bakery",
          "org": "Boston Magazine",
          "year": 2009,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread Bakery",
          "org": "Boston Magazine",
          "year": 2007,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Sticky Bun",
          "org": "Boston Magazine",
          "year": 1997,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Sticky Bun",
          "org": "Boston Magazine",
          "year": 1994,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread",
          "org": "Boston Magazine",
          "year": 1990,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread",
          "org": "Boston Magazine",
          "year": 1989,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        },
        {
          "title": "Best of Boston: Best Bread",
          "org": "Boston Magazine",
          "year": 1988,
          "scope": "local",
          "url": "https://www.clearflourbread.com/press"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.8,
          "count": 168,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60823-d858952-Reviews-Clear_Flour_Bread-Brookline_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.8,
          "count": 1069,
          "url": "https://restaurantguru.com/Clear-Flour-Bakery-Boston"
        },
        {
          "source": "Restaurantji",
          "rating": 4.7,
          "count": 372,
          "url": "https://www.restaurantji.com/ma/brookline/clear-flour-bakery-/"
        }
      ],
      "review_highlights": [
        "Reviewers recommend the olive rolls, multigrain sourdough and raspberry tarts.",
        "The pretzel croissant, blueberry scone and baguettes all get praise.",
        "Expect a line outside at busy times. Some breads are available only on specific days or after a posted bake time."
      ],
      "review_excerpts": [
        {
          "author": "leilane menezes",
          "source": "Google (via Restaurant Guru)",
          "text": "Everything in this bakery is flawless.",
          "rating": null,
          "date_label": "a month ago",
          "url": "https://restaurantguru.com/Clear-Flour-Bakery-Boston"
        },
        {
          "author": "Kevin Lee",
          "source": "Google (via Restaurant Guru)",
          "text": "Highlights : Blueberry Scone, Pretzel Croissant.",
          "rating": null,
          "date_label": "2 months ago",
          "url": "https://restaurantguru.com/Clear-Flour-Bakery-Boston"
        }
      ],
      "review_sources": [
        "https://restaurantguru.com/Clear-Flour-Bakery-Boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60823-d858952-Reviews-Clear_Flour_Bread-Brookline_Massachusetts.html",
        "https://www.restaurantji.com/ma/brookline/clear-flour-bakery-/",
        "https://boston.eater.com/maps/best-bread-bakeries-boston",
        "https://www.clearflourbread.com/bread-menu"
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
          "scope": "international",
          "url": "https://www.tripadvisor.com/Attraction_Review-g60745-d105250-Reviews-Fenway_Park-Boston_Massachusetts.html"
        },
        {
          "title": "Sports Facility of the Year",
          "org": "Sports Business Journal",
          "year": 2023,
          "scope": "national",
          "url": "https://www.cbsnews.com/boston/news/fenway-park-sports-facility-of-the-year-award/"
        },
        {
          "title": "National Register of Historic Places listing",
          "org": "National Park Service",
          "year": 2012,
          "scope": "national",
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
          "scope": "international",
          "url": "https://www.bostonplans.org/getattachment/0e557ae1-7b22-4b02-8331-9f3a64d32006"
        },
        {
          "title": "No. 1, Q1 Worldwide Top 50 Clubs by gross",
          "org": "Pollstar",
          "year": 2022,
          "scope": "international",
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
      "checked_on": "2026-11-22",
      "address": "533 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://eljefestaqueria.com/locations/kenmore-square/",
      "phone": "617-644-0126",
      "hours_verified": true,
      "hours_note": "Official location page lists 03:00 the next morning daily. January 2025 licensing minutes recorded a 02:00 indoor close.",
      "hours_source": "https://eljefestaqueria.com/locations/kenmore-square/",
      "awards": [],
      "ratings": [
        {
          "source": "Google via Restaurant Guru",
          "rating": 4.8,
          "count": 733,
          "url": "https://restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston"
        },
        {
          "source": "Uber Eats",
          "rating": 4.6,
          "count": null,
          "url": "https://airbnb.failover.uber.com/store/el-jefes-taqueria-kenmore-sq/bRdYWfycUAKYpqw5V3FShQ"
        }
      ],
      "review_highlights": [
        "Reviewers praise generous burritos and bowls, fresh toppings, and good value.",
        "Customers frequently mention quick service, including during the lunch rush.",
        "Some delivery reviewers report missing toppings or incorrect ingredients."
      ],
      "review_excerpts": [
        {
          "author": "David D.",
          "source": "Uber Eats",
          "text": "The food is great and made quickly !",
          "rating": null,
          "date_label": "Oct 23, 2026",
          "url": "https://airbnb.failover.uber.com/store/el-jefes-taqueria-kenmore-sq/bRdYWfycUAKYpqw5V3FShQ"
        },
        {
          "author": "Leslie S",
          "source": "Google via Restaurant Guru",
          "text": "The food was exceptionally delicious and at a great price!",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston"
        }
      ],
      "review_sources": [
        "https://restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston",
        "https://es.restaurantguru.com/El-Jefes-Taqueria-Kenmore-Square-Boston",
        "https://airbnb.failover.uber.com/store/el-jefes-taqueria-kenmore-sq/bRdYWfycUAKYpqw5V3FShQ"
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
      "checked_on": "2026-11-22",
      "address": "775 Beacon Street, Boston, MA 02215",
      "website": "https://www.easternstandardboston.com/",
      "phone": "617-530-1590",
      "hours_verified": true,
      "hours_note": "Dining hours shown. Limited menu 15:00–16:00 daily. Bar closes 23:00 Mon–Thu, midnight Fri–Sat, and 21:00 Sun.",
      "hours_source": "https://www.easternstandardboston.com/location/hours/",
      "awards": [
        {
          "title": "Spirited Awards — Best Bar Team, U.S. East regional top 10 (original location)",
          "org": "Tales of the Cocktail Foundation",
          "year": 2019,
          "scope": "international",
          "url": "https://talesofthecocktail.org/13th-annual-spirited-awards-regional-top-10-honorees/"
        },
        {
          "title": "Spirited Awards — Best American Restaurant Bar winner (original location)",
          "org": "Tales of the Cocktail Foundation",
          "year": 2015,
          "scope": "international",
          "url": "https://talesofthecocktail.org/spirited-awards-archive/"
        },
        {
          "title": "Spirited Awards — Best High Volume Cocktail Bar winner (original location)",
          "org": "Tales of the Cocktail Foundation",
          "year": 2012,
          "scope": "international",
          "url": "https://talesofthecocktail.org/spirited-awards-archive/"
        },
        {
          "title": "OpenTable Icons",
          "org": "OpenTable",
          "year": 2026,
          "scope": "national",
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        },
        {
          "title": "OpenTable Icons",
          "org": "OpenTable",
          "year": 2025,
          "scope": "national",
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        },
        {
          "title": "OpenTable Icons",
          "org": "OpenTable",
          "year": 2024,
          "scope": "national",
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        },
        {
          "title": "Outstanding Restaurateur semifinalist — Garrett Harker (portfolio included original Eastern Standard)",
          "org": "James Beard Foundation",
          "year": 2018,
          "scope": "national",
          "url": "https://www.bostonmagazine.com/restaurants/2018/02/15/james-beard-semifinalists-2018-boston/"
        },
        {
          "title": "Outstanding Restaurateur semifinalist — Garrett Harker (portfolio included original Eastern Standard)",
          "org": "James Beard Foundation",
          "year": 2017,
          "scope": "national",
          "url": "https://archive.jamesbeard.org/blog/meet-the-2017-restaurant-and-chef-award-semifinalists"
        },
        {
          "title": "Outstanding Service semifinalist (original location)",
          "org": "James Beard Foundation",
          "year": 2017,
          "scope": "national",
          "url": "https://archive.jamesbeard.org/blog/meet-the-2017-restaurant-and-chef-award-semifinalists"
        },
        {
          "title": "Outstanding Restaurateur semifinalist — Garrett Harker (portfolio included original Eastern Standard)",
          "org": "James Beard Foundation",
          "year": 2016,
          "scope": "national",
          "url": "https://www.bostonmagazine.com/restaurants/2016/02/17/james-beard-semifinalists-2016-boston/"
        },
        {
          "title": "Outstanding Restaurateur semifinalist — Garrett Harker (portfolio included original Eastern Standard)",
          "org": "James Beard Foundation",
          "year": 2015,
          "scope": "national",
          "url": "https://www.bostonmagazine.com/restaurants/2015/02/18/2015-james-beard-semifinalists-announced/"
        },
        {
          "title": "Outstanding Restaurateur semifinalist — Garrett Harker (portfolio included original Eastern Standard)",
          "org": "James Beard Foundation",
          "year": 2014,
          "scope": "national",
          "url": "https://www.jamesbeard.org/stories/the-2014-restaurant-and-chef-award-semifinalists"
        },
        {
          "title": "Best of Boston — Best Comeback — Harkertown, including Eastern Standard",
          "org": "Boston Magazine",
          "year": 2024,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2024/harkertown/"
        },
        {
          "title": "Best of Boston — Best Sommelier — Colleen Hein (original location)",
          "org": "Boston Magazine",
          "year": 2015,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2015/colleen-hein-eastern-standard/"
        },
        {
          "title": "Best of Boston — Best Service (original location)",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2014/eastern-standard-11/"
        },
        {
          "title": "Best of Boston — Best Late-Night Dining (original location)",
          "org": "Boston Magazine",
          "year": 2011,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2011/eastern-standard-8/"
        },
        {
          "title": "Best of Boston — Best Brasserie (original location)",
          "org": "Boston Magazine",
          "year": 2010,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2010/eastern-standard-7/"
        },
        {
          "title": "Best of Boston — Best Group Dining (original location)",
          "org": "Boston Magazine",
          "year": 2007,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2007/eastern-standard-10/"
        },
        {
          "title": "Best of Boston — Best Group Dining (original location)",
          "org": "Boston Magazine",
          "year": 2006,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2006/eastern-standard-4/"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.6,
          "count": 1382,
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        },
        {
          "source": "Restaurantji",
          "rating": 4.3,
          "count": 570,
          "url": "https://www.restaurantji.com/ma/boston/eastern-standard-/"
        }
      ],
      "review_highlights": [
        "Critics praise the return of brasserie staples such as lamb-sausage rigatoni, steak frites, and roast chicken.",
        "Diners frequently commend attentive service and cocktails, though some consider the meal expensive.",
        "The larger, polished dining room suits celebrations and meals before Fenway events."
      ],
      "review_excerpts": [
        {
          "author": "kaitsplatess",
          "source": "OpenTable",
          "text": "Go check them out and don’t forget to order the layered chocolate cake 💌",
          "rating": null,
          "date_label": null,
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        },
        {
          "author": "OpenTable editors",
          "source": "OpenTable",
          "text": "the baked rigatoni and roasted bone marrow",
          "rating": null,
          "date_label": null,
          "url": "https://www.opentable.com/r/eastern-standard-boston-1"
        }
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/eastern-standard-kitchen-bar",
        "https://www.opentable.com/r/eastern-standard-boston-1",
        "https://www.bostonmagazine.com/restaurants/best-restaurants-fenway-neighborhood/",
        "https://www.restaurantji.com/ma/boston/eastern-standard-/"
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
          "scope": "local",
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
  "kenmore-shudaxia-01": {
    "hours": {
      "mon": [
        "12:00",
        "22:30"
      ],
      "tue": [
        "12:00",
        "22:30"
      ],
      "wed": [
        "12:00",
        "22:30"
      ],
      "thu": [
        "12:00",
        "22:30"
      ],
      "fri": [
        "12:00",
        "22:30"
      ],
      "sat": [
        "12:00",
        "22:30"
      ],
      "sun": [
        "12:00",
        "22:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "580 Commonwealth Avenue, Boston, MA 02215",
      "website": "https://www.shudaxiaboston.com/",
      "phone": "617-377-4198",
      "hours_verified": true,
      "hours_note": "Daily dining hours.",
      "hours_source": "https://www.shudaxiaboston.com/general-8",
      "awards": [],
      "ratings": [
        {
          "source": "Google via Restaurant Guru",
          "rating": 4.8,
          "count": 925,
          "url": "https://restaurantguru.com/Shu-Da-Xia-Hotpot-%E8%9C%80%E5%A4%A7%E4%BE%A0%E7%81%AB%E9%94%85-Boston"
        },
        {
          "source": "Restaurantji",
          "rating": 4.7,
          "count": 224,
          "url": "https://www.restaurantji.com/ma/boston/shu-daxia-hotpot-/"
        }
      ],
      "review_highlights": [
        "Diners praise spicy beef-oil broth and milder tomato broth for a split pot.",
        "Reviews highlight fresh sliced beef, seafood, and shrimp paste.",
        "Guests describe attentive service and a lively dining room for group meals."
      ],
      "review_excerpts": [
        {
          "author": "Daniel Than",
          "source": "Google via Restaurant Guru",
          "text": "The hotpot was rich, flavorful, and easily one of the best I’ve had in Boston.",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/Shu-Da-Xia-Hotpot-%E8%9C%80%E5%A4%A7%E4%BE%A0%E7%81%AB%E9%94%85-Boston"
        },
        {
          "author": "Kennedi LeBlanc",
          "source": "Google via Restaurant Guru",
          "text": "I'm always able to get a table without a reservation even when they're busy.",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/Shu-Da-Xia-Hotpot-%E8%9C%80%E5%A4%A7%E4%BE%A0%E7%81%AB%E9%94%85-Boston"
        }
      ],
      "review_sources": [
        "https://secretboston.co/places/shu-da-xia-hot-pot/",
        "https://restaurantguru.com/Shu-Da-Xia-Hotpot-%E8%9C%80%E5%A4%A7%E4%BE%A0%E7%81%AB%E9%94%85-Boston",
        "https://www.restaurantji.com/ma/boston/shu-daxia-hotpot-/"
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
          "scope": "local",
          "url": "https://www.bostonglobe.com/2024/07/11/magazine/best-bookstores-in-boston-brookline-cambridge-somerville/"
        },
        {
          "title": "Best of Boston: Best Old-School Bookstore",
          "org": "Boston Magazine",
          "year": 2022,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-2022/shopping/"
        },
        {
          "title": "Best of Boston: Best Virtual Author Series",
          "org": "Boston Magazine",
          "year": 2021,
          "scope": "local",
          "url": "https://www.harvard.com/about/history"
        },
        {
          "title": "Bookseller of the Year",
          "org": "Publishers Weekly",
          "year": 2002,
          "scope": "national",
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-harvard-square-restaurants/"
        },
        {
          "title": "The Top Rooftop Bars and Restaurants in Boston",
          "org": "Boston Magazine",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-rooftop-restaurants-bars-boston/"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Harvard Square",
          "org": "Boston Magazine",
          "year": 2019,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2019/felipes-taqueria/"
        },
        {
          "title": "Harvard Square restaurant recommendation",
          "org": "Time Out Boston",
          "year": 2019,
          "scope": "local",
          "url": "https://www.timeout.com/boston/restaurants/felipes-taqueria"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 232,
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60890-d883879-Reviews-or15-Felipe_s_Taqueria-Cambridge_Massachusetts.html"
        },
        {
          "source": "Google via Restaurant Guru",
          "rating": 4.4,
          "count": 4185,
          "url": "https://restaurantguru.com/Filipes-Cambridge"
        }
      ],
      "review_highlights": [
        "Reviewers praise filling burritos and tacos for their value and freshly prepared ingredients.",
        "The Infatuation recommends the chimichanga topped with queso and notes that ordering lines generally move quickly.",
        "Frozen margaritas and the rooftop draw a lively crowd; seating can be limited when the roof is busy."
      ],
      "review_excerpts": [
        {
          "author": "Alex Issokson (Boston Foodie)",
          "source": "Google via Restaurant Guru",
          "text": "Phenomenal burrito and great prices!",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/Filipes-Cambridge"
        },
        {
          "author": "Aadit Engineer",
          "source": "Google via Restaurant Guru",
          "text": "Best burrito/bowl spot in Boston area I’ve been to so far.",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/Filipes-Cambridge"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d883879-Reviews-Felipe_s_Taqueria-Cambridge_Massachusetts.html",
        "https://www.theinfatuation.com/boston/reviews/felipes-mexican-taqueria",
        "https://www.bostonmagazine.com/restaurants/best-rooftop-restaurants-bars-boston/",
        "https://www.tripadvisor.co.uk/Restaurant_Review-g60890-d883879-Reviews-or15-Felipe_s_Taqueria-Cambridge_Massachusetts.html",
        "https://restaurantguru.com/Filipes-Cambridge"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/guides/where-to-eat-and-drink-in-harvard-square"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 192,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60890-d11698527-Reviews-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.2,
          "count": 543,
          "url": "https://www.restaurantji.com/ma/cambridge/tatte-bakery-and-caf-/"
        }
      ],
      "review_highlights": [
        "Critics praise the chocolate hazelnut brioche and espresso mocha mousse, alongside savory choices such as shakshuka and tartines.",
        "The two-story seating area attracts students with laptops and books, and tables can be crowded.",
        "Customers frequently praise pastries and breakfast sandwiches, though some report slow service or incomplete takeaway orders."
      ],
      "review_excerpts": [
        {
          "author": "christopherbO9687MP",
          "source": "Tripadvisor",
          "text": "Both were good, and service was reasonably prompt (allowing me to catch an earlier train).",
          "rating": null,
          "date_label": "Mar 11, 2026",
          "url": "https://www.tripadvisor.com/ShowUserReviews-g60890-d11698527-r1052627709-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
        },
        {
          "author": "Eva-Edith",
          "source": "Tripadvisor",
          "text": "Amazing breakfast",
          "rating": null,
          "date_label": "Mar 31, 2025",
          "url": "https://www.tripadvisor.com/ShowUserReviews-g60890-d11698527-r1000572444-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/tatte-bakery-cafe",
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d11698527-Reviews-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html",
        "https://www.restaurantji.com/ma/cambridge/tatte-bakery-and-caf-/",
        "https://www.tripadvisor.com/ShowUserReviews-g60890-d11698527-r1052627709-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html",
        "https://www.tripadvisor.com/ShowUserReviews-g60890-d11698527-r1000572444-Tatte_Bakery_Cafe_Harvard_Square-Cambridge_Massachusetts.html"
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
          "scope": "local",
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "The Best Chinese Restaurants Around Boston",
          "org": "Eater Boston",
          "year": 2025,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-chinese-food-boston"
        },
        {
          "title": "Best of Boston: Best Brunch, with Foodie Friends",
          "org": "Boston Magazine",
          "year": 2006,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2006/hei-la-moon/"
        },
        {
          "title": "Hei La Moon restaurant review",
          "org": "The Infatuation",
          "year": null,
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/reviews/hei-la-moon"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.7,
          "count": 322,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d535527-Reviews-Hei_La_Moon-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4,
          "count": 2856,
          "url": "https://restaurantguru.com/Hei-La-Moon-Boston"
        }
      ],
      "review_highlights": [
        "Critics recommend the taro dumplings, steamed roast pork buns, and bok choy with oyster sauce.",
        "Diners appreciate the substantial dumpling portions and weekend cart service.",
        "Recurring complaints concern uneven table service and dim sum arriving lukewarm."
      ],
      "review_excerpts": [
        {
          "author": "KC Wong",
          "source": "Google (via Restaurant Guru)",
          "text": "If you want the authentic dimsum in Boston Chinatown, here is the spot.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Hei-La-Moon-Boston"
        },
        {
          "author": "Potjamarn Arpornratn",
          "source": "Google (via Restaurant Guru)",
          "text": "Food price is reasonable.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Hei-La-Moon-Boston"
        }
      ],
      "review_sources": [
        "https://boston.eater.com/maps/best-chinese-food-boston",
        "https://boston.eater.com/maps/best-restaurants-chinatown-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d535527-Reviews-Hei_La_Moon-Boston_Massachusetts.html",
        "https://restaurantguru.com/Hei-La-Moon-Boston"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "The Best Brunches Around Boston",
          "org": "Eater Boston",
          "year": 2026,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-boston-brunch-restaurants"
        },
        {
          "title": "Winsor Dim Sum Cafe restaurant review",
          "org": "The Infatuation",
          "year": null,
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/reviews/winsor-dim-sum-cafe"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 230,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d1048503-Reviews-Winsor_Dim_Sum_Cafe-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 3.9,
          "count": 1401,
          "url": "https://restaurantguru.com/Winsor-Dim-Sum-Cafe-Boston"
        }
      ],
      "review_highlights": [
        "Critics particularly praise the turnip cakes, rice noodle rolls, and preserved egg and pork congee.",
        "Dim sum is ordered from a checklist and made to order rather than selected from rolling carts.",
        "The small dining room can mean waits and shared tables; diners report mixed service experiences."
      ],
      "review_excerpts": [
        {
          "author": "Nikki Afshar",
          "source": "Google (via Restaurant Guru)",
          "text": "The food honestly wasn’t good at all and I love dim sum so I would know.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Winsor-Dim-Sum-Cafe-Boston"
        },
        {
          "author": "Hritik",
          "source": "Google (via Restaurant Guru)",
          "text": "The service was pretty fast, but things were a little chaotic sometimes.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Winsor-Dim-Sum-Cafe-Boston"
        }
      ],
      "review_sources": [
        "https://www.theinfatuation.com/boston/reviews/winsor-dim-sum-cafe",
        "https://boston.eater.com/maps/best-boston-brunch-restaurants",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d1048503-Reviews-Winsor_Dim_Sum_Cafe-Boston_Massachusetts.html",
        "https://restaurantguru.com/Winsor-Dim-Sum-Cafe-Boston"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-chinese-food-boston"
        },
        {
          "title": "Best Hand-Pulled Noodles in Boston",
          "org": "Eater Boston",
          "year": null,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-hand-pulled-noodles-boston"
        },
        {
          "title": "Gene’s Chinese Flatbread Cafe restaurant review",
          "org": "The Infatuation",
          "year": null,
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/reviews/genes-chinese-flatbread-cafe"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": 41,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d6033876-Reviews-Gene_s_Chinese_Flatbread_Cafe-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.3,
          "count": 981,
          "url": "https://restaurantguru.com/Genes-Boston"
        }
      ],
      "review_highlights": [
        "The thick, chewy hand-pulled noodles are the main draw, particularly the garlicky chile version and cumin lamb noodles.",
        "Reviewers praise the filling portions and value, while noting the tiny, basic counter-service space.",
        "The pork flatbread sandwiches have fans, although critics describe them as oily."
      ],
      "review_excerpts": [
        {
          "author": "Ying Xiao",
          "source": "Google (via Restaurant Guru)",
          "text": "The noodles were authentic Xi'an belt-shape hand-pulled noodles, wide and thick, very chewy.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Genes-Boston"
        },
        {
          "author": "Joseph Carpman",
          "source": "Google (via Restaurant Guru)",
          "text": "there is very little space in the restaurant, but I don't really mind.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Genes-Boston"
        }
      ],
      "review_sources": [
        "https://boston.eater.com/maps/best-chinese-food-boston",
        "https://www.theinfatuation.com/boston/reviews/genes-chinese-flatbread-cafe",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d6033876-Reviews-Gene_s_Chinese_Flatbread_Cafe-Boston_Massachusetts.html",
        "https://restaurantguru.com/Genes-Boston"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-bakeries-boston-chinatown"
        },
        {
          "title": "Cheap Eats in Boston: Affordable Dishes from A to Z",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/guides/2014/01/28/cheap-eats-boston/5/"
        },
        {
          "title": "Best of Boston: Best Pastry, Chinese",
          "org": "Boston Magazine",
          "year": 1982,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1982/ho-yuen-bakery/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.9,
          "count": 12,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d8845585-Reviews-Ho_Yuen-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.5,
          "count": 206,
          "url": "https://restaurantguru.com/Ho-Yuen-Boston"
        }
      ],
      "review_highlights": [
        "Reviewers repeatedly recommend the pineapple buns, coconut buns, egg tarts, and roast pork buns.",
        "Eater highlights the curry beef buns and mooncakes available throughout the year.",
        "Customers value the inexpensive traditional pastries; the shop is small and counter service is brisk."
      ],
      "review_excerpts": [
        {
          "author": "Jade",
          "source": "Google (via Restaurant Guru)",
          "text": "The cocktail buns (especially) and the egg tarts were under cooked/baked.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Ho-Yuen-Boston"
        },
        {
          "author": "Sheba",
          "source": "Google (via Restaurant Guru)",
          "text": "I recommend the black seed sesame moo cake and the portoguese tarts !",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Ho-Yuen-Boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d8845585-Reviews-Ho_Yuen-Boston_Massachusetts.html",
        "https://boston.eater.com/maps/best-bakeries-boston-chinatown",
        "https://www.restaurantji.com/ma/boston/ho-yuen-bakery-inc-/",
        "https://restaurantguru.com/Ho-Yuen-Boston"
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
      "checked_on": "2026-11-22",
      "address": "660 Washington St, Boston, MA 02111",
      "website": "https://thequsa.com/",
      "phone": "857-350-3968",
      "hours_verified": true,
      "hours_note": "Friday and Saturday service ends at midnight. Holiday hours may differ.",
      "hours_source": "https://thequsa.com/",
      "awards": [
        {
          "title": "Travelers’ Choice",
          "org": "Tripadvisor",
          "year": null,
          "scope": "international",
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d2285799-Reviews-Q_Restaurant-Boston_Massachusetts.html"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Chinatown",
          "org": "Boston Magazine",
          "year": 2022,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2022/q-restaurant-2/"
        },
        {
          "title": "Q Restaurant review",
          "org": "The Infatuation",
          "year": null,
          "scope": "local",
          "url": "https://www.theinfatuation.com/boston/reviews/q-restaurant"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.5,
          "count": 589,
          "url": "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d2285799-Reviews-Q_Restaurant-Boston_Massachusetts.html"
        },
        {
          "source": "OpenTable",
          "rating": 4.8,
          "count": 747,
          "url": "https://www.opentable.com/r/the-q-restaurant-boston"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.6,
          "count": 3595,
          "url": "https://restaurantguru.com/Q-Restaurant-Boston"
        }
      ],
      "review_highlights": [
        "Diners praise the choice of hot-pot broths, divided pots for two flavors, and fresh meat and vegetables.",
        "Helpful servers receive repeated praise for explaining hot pot to first-time customers.",
        "Sushi and cocktails are additional draws; busy evening service can bring substantial waits for walk-ins."
      ],
      "review_excerpts": [
        {
          "author": "Juan Se",
          "source": "Google (via Restaurant Guru)",
          "text": "Very authentic and tasty food with a wide variety to choose from.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Q-Restaurant-Boston"
        },
        {
          "author": "Jonathan Heard",
          "source": "Google (via Restaurant Guru)",
          "text": "The soup dumplings were a stand out along with the Q roll.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Q-Restaurant-Boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d2285799-Reviews-Q_Restaurant-Boston_Massachusetts.html",
        "https://www.bostonmagazine.com/best-of-boston-archive/2022/q-restaurant-2/",
        "https://www.tripadvisor.co.uk/Restaurant_Review-g60745-d2285799-Reviews-Q_Restaurant-Boston_Massachusetts.html",
        "https://www.opentable.com/r/the-q-restaurant-boston",
        "https://restaurantguru.com/Q-Restaurant-Boston"
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
      "checked_on": "2026-11-22",
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
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-restaurants-chinatown-boston"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Chinatown",
          "org": "Boston Magazine",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston/dining/"
        },
        {
          "title": "Best of Boston: Best Neighborhood Restaurant, Chinatown",
          "org": "Boston Magazine",
          "year": 2024,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2024/taiwan-cafe/"
        },
        {
          "title": "Best of Boston: Best Chinese Restaurant",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2014/taiwan-caf-2/"
        },
        {
          "title": "Best of Boston: Best Chinese Restaurant",
          "org": "Boston Magazine",
          "year": 2002,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2002/taiwan-caf/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 176,
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60745-d321563-Reviews-Taiwan_Cafe-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 3.9,
          "count": 546,
          "url": "https://restaurantguru.com/Taiwan-Cafe-Boston"
        }
      ],
      "review_highlights": [
        "Critics recommend the Taiwan-style pan-fried dumplings, roast beef scallion-pancake rolls, and beef noodle soup.",
        "Diners frequently praise generous portions and food arriving quickly.",
        "The small dining room can be crowded and noisy, with shared tables; several diners find the spicy dishes hotter than expected."
      ],
      "review_excerpts": [
        {
          "author": "Daniel Anner",
          "source": "Google (via Restaurant Guru)",
          "text": "We shared the Sauteed Pork Belly With Veggie & Pepper",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Taiwan-Cafe-Boston"
        },
        {
          "author": "Kevin Cheng",
          "source": "Google (via Restaurant Guru)",
          "text": "Good quality food, especially the spicy fried fish, which was outstandingly tender and crispy.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Taiwan-Cafe-Boston"
        }
      ],
      "review_sources": [
        "https://www.bostonmagazine.com/best-of-boston-archive/2024/taiwan-cafe/",
        "https://boston.eater.com/maps/best-restaurants-chinatown-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321563-Reviews-Taiwan_Cafe-Boston_Massachusetts.html",
        "https://restaurantguru.com/Taiwan-Cafe-Boston"
      ]
    }
  },
  "haymarket-neptune-01": {
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
        "11:00",
        "23:00"
      ],
      "sun": [
        "11:00",
        "23:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "63 Salem St, Boston, MA 02113",
      "website": "https://www.neptuneoyster.com/",
      "phone": "+1-617-742-3474",
      "hours_verified": true,
      "hours_note": "Schedule uses the published raw bar closing times and interprets weekdays as Monday–Friday. The kitchen closes 30 minutes earlier.",
      "hours_source": "https://www.neptuneoyster.com/welcome",
      "awards": [
        {
          "title": "MICHELIN Guide selection",
          "org": "MICHELIN Guide",
          "year": null,
          "scope": "international",
          "url": "https://guide.michelin.com/en/massachusetts/boston_2914838/restaurant/neptune-oyster"
        },
        {
          "title": "Best Lobster Roll, Classy",
          "org": "Boston Magazine",
          "year": 2025,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2025/neptune-oyster-16/"
        },
        {
          "title": "Best Reason to Wait in a Really Long Line",
          "org": "Boston Magazine",
          "year": 2024,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2024/neptune-oyster-15/"
        },
        {
          "title": "Best Oyster Bar",
          "org": "Boston Magazine",
          "year": 2016,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2016/neptune-oyster-12/"
        },
        {
          "title": "Best Fried Clams",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2014/neptune-oyster-10/"
        },
        {
          "title": "Best Raw Bar",
          "org": "Boston Magazine",
          "year": 2010,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2010/neptune-oyster-5/"
        },
        {
          "title": "Best Seafood Restaurant",
          "org": "Boston Magazine",
          "year": 2009,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2009/neptune-oyster-4/"
        },
        {
          "title": "Best Lobster Roll",
          "org": "Boston Magazine",
          "year": 2009,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2009/neptune-oyster-3/"
        },
        {
          "title": "Best Clams",
          "org": "Boston Magazine",
          "year": 2008,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2008/neptune-oyster-9/"
        },
        {
          "title": "Best Raw Bar",
          "org": "Boston Magazine",
          "year": 2006,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2006/neptune-oyster/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": null,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d535627-Reviews-Neptune_Oyster-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Diners repeatedly praise the freshness and variety of the oysters.",
        "The lobster roll is a common reason to visit, with reviews differing on how well the bun holds up.",
        "Reviews describe a lively, tightly packed dining room and a line that can extend outside."
      ],
      "review_excerpts": [
        {
          "author": "Dayter",
          "source": "Tripadvisor",
          "text": "The variety is impressive, and everything we tried was incredibly fresh and well prepared.",
          "rating": 5,
          "date_label": "December 17, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d535627-Reviews-Neptune_Oyster-Boston_Massachusetts.html"
        },
        {
          "author": "7Serendipity7",
          "source": "Tripadvisor",
          "text": "There’s a line up outside this place for a reason!",
          "rating": 5,
          "date_label": "March 22, 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d535627-Reviews-Neptune_Oyster-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d535627-Reviews-Neptune_Oyster-Boston_Massachusetts.html",
        "https://guide.michelin.com/en/massachusetts/boston_2914838/restaurant/neptune-oyster"
      ]
    }
  },
  "haymarket-union-oyster-01": {
    "hours": {
      "mon": [
        "11:00",
        "21:30"
      ],
      "tue": [
        "11:00",
        "21:30"
      ],
      "wed": [
        "11:00",
        "21:30"
      ],
      "thu": [
        "11:00",
        "21:30"
      ],
      "fri": [
        "11:00",
        "22:00"
      ],
      "sat": [
        "11:00",
        "22:00"
      ],
      "sun": [
        "11:00",
        "21:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "41 Union St, Boston, MA 02108",
      "website": "https://www.unionoysterhouse.com/",
      "phone": "+1-617-227-2750",
      "hours_verified": true,
      "hours_note": "The venue confirms seven-day service with separate Friday and Saturday hours. The Boston Guide lists the clock times.",
      "hours_source": "https://events.bostonguide.com/places/view/785/union_oyster_house_.html",
      "awards": [
        {
          "title": "World's Best Landmark Restaurant",
          "org": "World Culinary Awards",
          "year": 2025,
          "scope": "international",
          "url": "https://worldculinaryawards.com/award/world-best-landmark-restaurant/2025"
        },
        {
          "title": "North America's Best Landmark Restaurant",
          "org": "World Culinary Awards",
          "year": 2025,
          "scope": "international",
          "url": "https://worldculinaryawards.com/award/north-america-best-landmark-restaurant/2025"
        },
        {
          "title": "North America's Best Landmark Restaurant",
          "org": "World Culinary Awards",
          "year": 2024,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Top 50 Most Legendary Restaurants in the World",
          "org": "TasteAtlas",
          "year": 2023,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "North America's Best Landmark Restaurant",
          "org": "World Culinary Awards",
          "year": 2020,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "The Oldest Restaurants in the World",
          "org": "Condé Nast Traveler",
          "year": 2019,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "500 Best Restaurants in the World",
          "org": "Lonely Planet",
          "year": 2018,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "World's 10 Oldest Restaurants",
          "org": "Condé Nast Traveler",
          "year": 2014,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "10 Classic Great Restaurants in the World",
          "org": "Forbes",
          "year": 2012,
          "scope": "international",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Diners' Choice Award",
          "org": "OpenTable",
          "year": 2019,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Best Restaurants in Boston",
          "org": "Condé Nast Traveler",
          "year": 2018,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Best Clam Chowder in Boston",
          "org": "USA TODAY",
          "year": 2018,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Super Bowl Cook-off Winner",
          "org": "Fox & Friends",
          "year": 2018,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Achievement of Excellence Award",
          "org": "American Culinary Federation",
          "year": 2014,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "10 Best Seafood Restaurants, Readers' Choice",
          "org": "USA TODAY",
          "year": 2013,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "National Historic Landmark",
          "org": "National Park Service",
          "year": 2003,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        },
        {
          "title": "Restaurant of the Year",
          "org": "National Restaurant Association",
          "year": 2001,
          "scope": "national",
          "url": "https://www.unionoysterhouse.com/pages/awards.html"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4,
          "count": null,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321626-Reviews-Union_Oyster_House-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "The historic rooms and memorabilia are a reason to visit in their own right.",
        "Raw oysters and clam chowder are frequently singled out.",
        "Reviews differ on the value and consistency of full seafood entrées."
      ],
      "review_excerpts": [
        {
          "author": "LatteQueen",
          "source": "Tripadvisor",
          "text": "Lovely interior with lots of things to look at.",
          "rating": 3,
          "date_label": "September 27, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321626-Reviews-Union_Oyster_House-Boston_Massachusetts.html"
        },
        {
          "author": "Jeremy",
          "source": "Tripadvisor",
          "text": "The mashed potatoes were cold and flavorless, so I had to add butter and salt to them.",
          "rating": 2,
          "date_label": "January 1, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321626-Reviews-Union_Oyster_House-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321626-Reviews-Union_Oyster_House-Boston_Massachusetts.html"
      ]
    }
  },
  "haymarket-public-market-01": {
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
        "20:00"
      ],
      "thu": [
        "08:00",
        "20:00"
      ],
      "fri": [
        "08:00",
        "20:00"
      ],
      "sat": [
        "08:00",
        "20:00"
      ],
      "sun": [
        "08:00",
        "18:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "100 Hanover St, Boston, MA 02108",
      "website": "https://bostonpublicmarket.org/",
      "phone": "+1-617-973-4909",
      "hours_verified": true,
      "hours_note": "Hours are for the market hall. Individual vendors may keep different hours.",
      "hours_source": "https://bostonpublicmarket.org/faq/",
      "awards": [
        {
          "title": "Travelers' Choice",
          "org": "Tripadvisor",
          "year": null,
          "scope": "international",
          "url": "https://www.tripadvisor.com/Attraction_Review-g60745-d8505238-Reviews-Boston_Public_Market-Boston_Massachusetts.html"
        },
        {
          "title": "10Best Readers' Choice, Best Public Market",
          "org": "USA TODAY",
          "year": 2026,
          "scope": "national",
          "url": "https://www.aol.com/articles/boston-one-best-public-markets-091036000.html"
        },
        {
          "title": "10Best Readers' Choice, Best Public Market",
          "org": "USA TODAY",
          "year": 2025,
          "scope": "national",
          "url": "https://www.boston.com/food/food-news/2025/04/23/boston-public-market-usa-today/"
        },
        {
          "title": "10Best Readers' Choice, Best Public Market",
          "org": "USA TODAY",
          "year": 2024,
          "scope": "national",
          "url": "https://www.boston.com/travel/visiting-boston/2024/04/29/boston-public-market-top-10-usa-today-ranking/"
        },
        {
          "title": "10Best Readers' Choice, Best Public Market, Top 5",
          "org": "USA TODAY",
          "year": 2023,
          "scope": "national",
          "url": "https://bostonpublicmarket.org/wp-content/uploads/2024/08/AnnualReport-2023-Web.pdf"
        },
        {
          "title": "10Best Readers' Choice, Best Public Market, Top 4",
          "org": "USA TODAY",
          "year": 2022,
          "scope": "national",
          "url": "https://www.boston.com/food/shopping/2022/03/11/boston-top-4-public-markets-in-the-country-usa-today-readers/"
        },
        {
          "title": "10Best Readers' Choice, Best Food Market",
          "org": "USA TODAY",
          "year": 2021,
          "scope": "national",
          "url": "https://www.boston.com/food/food-news/2021/04/26/best-food-markets-america-boston-public-market-usa-today/"
        },
        {
          "title": "Best Food Market",
          "org": "Boston Magazine",
          "year": 2018,
          "scope": "local",
          "url": "https://bostonpublicmarket.org/wp-content/uploads/2024/08/2018-Annual-Report.pdf"
        },
        {
          "title": "Boston's Best One-Stop Shop",
          "org": "The Improper Bostonian",
          "year": 2017,
          "scope": "local",
          "url": "https://bostonpublicmarket.org/wp-content/uploads/2024/08/2017-Annual-Report.pdf"
        },
        {
          "title": "AIA New England Design Award for the Boston Public Market project",
          "org": "AIA New England",
          "year": 2015,
          "scope": "local",
          "url": "https://bostonpublicmarket.org/wp-content/uploads/2024/08/2015-Annual-Report.pdf"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 465,
          "url": "https://www.tripadvisor.com/Attraction_Review-g60745-d8505238-Reviews-Boston_Public_Market-Boston_Massachusetts.html"
        },
        {
          "source": "Birdeye",
          "rating": 4.6,
          "count": 7098,
          "url": "https://reviews.birdeye.com/boston-public-market-156637833589515"
        }
      ],
      "review_highlights": [
        "Visitors like buying lunch, dessert, and drinks from different stalls in one stop.",
        "Local produce and specialty goods draw shoppers alongside prepared-food counters.",
        "Reviews describe communal seating that can fill up during busy periods.",
        "Some visitors find prices high, and arriving late can mean fewer open stalls."
      ],
      "review_excerpts": [
        {
          "author": "Mia M",
          "source": "Google Maps",
          "text": "I highly recommend the cold brew coffee!",
          "rating": 5,
          "date_label": "May 17, 2026",
          "url": "https://wanderlog.com/place/details/48313/%E6%B3%A2%E5%A3%AB%E9%A1%BF%E5%85%AC%E5%85%B1%E5%B8%82%E5%9C%BA"
        },
        {
          "author": "Steven Y",
          "source": "Google Maps",
          "text": "Lots of shops and food spots to choose from.",
          "rating": 5,
          "date_label": "June 4, 2026",
          "url": "https://wanderlog.com/place/details/48313/%E6%B3%A2%E5%A3%AB%E9%A1%BF%E5%85%AC%E5%85%B1%E5%B8%82%E5%9C%BA"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Attraction_Review-g60745-d8505238-Reviews-Boston_Public_Market-Boston_Massachusetts.html",
        "https://wanderlog.com/place/details/48313/%E6%B3%A2%E5%A3%AB%E9%A1%BF%E5%85%AC%E5%85%B1%E5%B8%82%E5%9C%BA",
        "https://reviews.birdeye.com/boston-public-market-156637833589515"
      ]
    }
  },
  "haymarket-regina-01": {
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
        "11:00",
        "22:00"
      ],
      "sun": [
        "11:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "11 1/2 Thacher St, Boston, MA 02113",
      "website": "https://reginapizzeria.com/north_end.html",
      "phone": "+1-617-227-0765",
      "hours_verified": true,
      "hours_note": "Published hours for the original North End location.",
      "hours_source": "https://reginapizzeria.com/north_end.html",
      "awards": [
        {
          "title": "America's 10 Best Pizzerias, No. 1",
          "org": "Tripadvisor",
          "year": 2018,
          "scope": "national",
          "url": "https://ir.tripadvisor.com/node/16181/pdf"
        },
        {
          "title": "Best of the Best Pizza selection",
          "org": "The Boston Globe",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bostonglobe.com/2026/06/04/magazine/eat-best-pizza-massachusetts/"
        },
        {
          "title": "Boston area's best slice, readers' poll winner",
          "org": "Axios Boston",
          "year": 2024,
          "scope": "local",
          "url": "https://www.axios.com/local/boston/2024/07/23/best-pizza-boston-area"
        },
        {
          "title": "Best Pizza",
          "org": "Boston Magazine",
          "year": 2003,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2003/pizzeria-regina-north-end-branch/"
        },
        {
          "title": "Best Pizza, Classic",
          "org": "Boston Magazine",
          "year": 1999,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1999/pizzeria-regina-3/"
        },
        {
          "title": "Best Pizza, Traditional",
          "org": "Boston Magazine",
          "year": 1998,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1998/pizzeria-regina-2/"
        },
        {
          "title": "Best Pizza, North End",
          "org": "Boston Magazine",
          "year": 1985,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1985/pizzeria-regina/"
        },
        {
          "title": "Best Pizza",
          "org": "Boston Magazine",
          "year": 1976,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1976/regina-pizzeria/"
        },
        {
          "title": "Best Pizza",
          "org": "Boston Magazine",
          "year": 1974,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1974/reginas/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.5,
          "count": 3041,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322981-Reviews-or15-Regina_Pizzeria-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Diners praise the crisp, charred brick-oven crust and the balance of cheese and sauce.",
        "The original room's old-school atmosphere is part of the draw.",
        "Seating waits recur in reviews, with takeout mentioned as an option.",
        "Service reviews range from warm and efficient to rushed or inattentive."
      ],
      "review_excerpts": [
        {
          "author": "Teacher91 ❤",
          "source": "Tripadvisor",
          "text": "The service and ambiance were spot on, too.",
          "rating": 5,
          "date_label": "August 26, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322981-Reviews-Regina_Pizzeria-Boston_Massachusetts.html"
        },
        {
          "author": "danibee33",
          "source": "Tripadvisor",
          "text": "So, this truly was the best pizza we've ever eaten!",
          "rating": 2,
          "date_label": "October 20, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322981-Reviews-Regina_Pizzeria-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d322981-Reviews-Regina_Pizzeria-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/regina-pizzeria-4/",
        "https://www.theinfatuation.com/boston/reviews/regina-pizzeria"
      ]
    }
  },
  "haymarket-mikes-pastry-01": {
    "hours": {
      "mon": [
        "08:00",
        "22:00"
      ],
      "tue": [
        "08:00",
        "22:00"
      ],
      "wed": [
        "08:00",
        "22:00"
      ],
      "thu": [
        "08:00",
        "22:00"
      ],
      "fri": [
        "08:00",
        "22:00"
      ],
      "sat": [
        "08:00",
        "22:00"
      ],
      "sun": [
        "08:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "300 Hanover St, Boston, MA 02113",
      "website": "https://www.mikespastry.com/",
      "phone": "+1-617-742-3050",
      "hours_verified": true,
      "hours_note": "Published North End hours.",
      "hours_source": "https://www.mikespastry.com/locations/",
      "awards": [
        {
          "title": "Recommended for cannoli",
          "org": "TasteAtlas",
          "year": null,
          "scope": "international",
          "url": "https://www.tasteatlas.com/mikespastry/cannoli"
        },
        {
          "title": "Best Cannoli",
          "org": "Boston Magazine",
          "year": 2021,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2021/mikes-pastry-2/"
        },
        {
          "title": "Best Pies",
          "org": "Boston Magazine",
          "year": 1997,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/1997/mikes-pastry/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": null,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322997-Reviews-Mike_s_Pastry_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Cannoli variety is a recurring draw, especially the chocolate-chip option.",
        "Visitors also single out the lobster tails and large portions of Boston cream pie.",
        "Lines can look long, although some reviewers say counter service moves quickly.",
        "Reviewers mention bringing cash and differ on whether the pastries justify the wait and price."
      ],
      "review_excerpts": [
        {
          "author": "LoveTravel685156",
          "source": "Tripadvisor",
          "text": "My favorite was the chocolate chip.",
          "rating": 5,
          "date_label": "January 29, 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322997-Reviews-Mike_s_Pastry_Boston-Boston_Massachusetts.html"
        },
        {
          "author": "212Moree",
          "source": "Tripadvisor",
          "text": "Don't let the lines scare you. They moved very quickly and it is worth the wait.",
          "rating": 5,
          "date_label": "October 17, 2025",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d322997-Reviews-Mike_s_Pastry_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d322997-Reviews-Mike_s_Pastry_Boston-Boston_Massachusetts.html",
        "https://www.wbur.org/news/2023/12/21/cannoli-italian-boston-north-end-mikes-pastry-bovas"
      ]
    }
  },
  "haymarket-city-winery-01": {
    "hours": {
      "mon": [
        "16:00",
        "22:00"
      ],
      "tue": [
        "16:00",
        "22:00"
      ],
      "wed": [
        "16:00",
        "22:00"
      ],
      "thu": [
        "16:00",
        "22:00"
      ],
      "fri": [
        "16:00",
        "23:00"
      ],
      "sat": [
        "14:00",
        "23:00"
      ],
      "sun": [
        "14:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "80 Beverly St, Boston, MA 02114",
      "website": "https://citywinery.com/pages/locations/boston",
      "phone": "+1-617-933-8047",
      "hours_verified": true,
      "hours_note": "Schedule follows the contact page's dedicated Restaurant & Box Office section. The same page's footer lists 23:00 on Thursday and 10:00 openings on Saturday and Sunday. The venue says special events and show cancellations can change hours. Phone is from Restaurant Week Boston.",
      "hours_source": "https://citywinery.com/pages/boston-contact",
      "awards": [],
      "ratings": [
        {
          "source": "Google (reported by Restaurant Guru)",
          "rating": 4,
          "count": null,
          "url": "https://restaurantguru.com/amp/City-Winery-Boston"
        }
      ],
      "review_highlights": [
        "Concertgoers praise the intimate main stage, clear sound, and sightlines.",
        "Table orientation is a recurring consideration because some seats face other diners.",
        "Food and wine reviews are mixed, with slow service and spending requirements mentioned in some reports."
      ],
      "review_excerpts": [
        {
          "author": "FamilyWithTeen",
          "source": "Tripadvisor",
          "text": "Just a very pleasant atmosphere that is welcoming. Good place to see a show.",
          "rating": 5,
          "date_label": "July 4, 2025",
          "url": "https://www.tripadvisor.ie/Restaurant_Review-g60745-d12421754-Reviews-City_Winery_Boston-Boston_Massachusetts.html"
        },
        {
          "author": "Carol G",
          "source": "Tripadvisor",
          "text": "Bands and venue are fun! But food and wine equally poor, service slow.",
          "rating": 4,
          "date_label": "January 13, 2025",
          "url": "https://www.tripadvisor.ie/Restaurant_Review-g60745-d12421754-Reviews-City_Winery_Boston-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.ie/Restaurant_Review-g60745-d12421754-Reviews-City_Winery_Boston-Boston_Massachusetts.html",
        "https://restaurantguru.com/amp/City-Winery-Boston",
        "https://wanderlog.com/place/details/102566"
      ]
    }
  },
  "copley-levain-01": {
    "hours": {
      "mon": [
        "08:00",
        "22:00"
      ],
      "tue": [
        "08:00",
        "22:00"
      ],
      "wed": [
        "08:00",
        "22:00"
      ],
      "thu": [
        "08:00",
        "22:00"
      ],
      "fri": [
        "08:00",
        "22:00"
      ],
      "sat": [
        "08:00",
        "22:00"
      ],
      "sun": [
        "08:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "180 Newbury St, Boston, MA 02116",
      "website": "https://levainbakery.com/pages/boston",
      "phone": "+1 617-390-7799",
      "hours_verified": true,
      "hours_note": null,
      "hours_source": "https://levainbakery.com/pages/boston",
      "awards": [
        {
          "title": "Worldworthy 100: Bakeries — No. 1 (New York original)",
          "org": "Worldworthy",
          "year": 2026,
          "scope": "international",
          "url": "https://worldworthy.org/lists/bakeries/levain-bakery/"
        },
        {
          "title": "The Best Cookie Bakeries inclusion (New York flagship)",
          "org": "Food Network",
          "year": null,
          "scope": "national",
          "url": "https://www.foodnetwork.com/restaurants/photos/best-cookies-in-the-country"
        },
        {
          "title": "Best of Boston — Best Cookie",
          "org": "Boston Magazine",
          "year": 2025,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2025/levain-bakery/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.7,
          "count": 26,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d23907576-Reviews-Levain_Bakery-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.4,
          "count": 341,
          "url": "https://www.restaurantji.com/ma/boston/levain-bakery-/"
        }
      ],
      "review_highlights": [
        "The double chocolate chip cookie earns praise for its soft, gooey center.",
        "Several reviewers find one cookie large enough to share, though value opinions vary.",
        "Guests mention limited indoor seating and queues at busy times.",
        "Banana chocolate bread and chocolate chip brioche also earn praise."
      ],
      "review_excerpts": [
        {
          "author": "rose c",
          "source": "Tripadvisor",
          "text": "But, the cookie was ooey gooey and amazing.",
          "rating": null,
          "date_label": "June 11, 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d23907576-Reviews-Levain_Bakery-Boston_Massachusetts.html"
        },
        {
          "author": "FQTVLR",
          "source": "Tripadvisor",
          "text": "The brioche with chocolate chips was particularly good.",
          "rating": null,
          "date_label": "December 9, 2024",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d23907576-Reviews-Levain_Bakery-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d23907576-Reviews-Levain_Bakery-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/levain-bakery-/"
      ]
    }
  },
  "copley-thai-basil-01": {
    "hours": {
      "mon": [
        "11:00",
        "21:00"
      ],
      "tue": [
        "11:00",
        "21:00"
      ],
      "wed": [
        "11:00",
        "21:00"
      ],
      "thu": [
        "11:00",
        "21:00"
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
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "132 Newbury St, Suite B, Boston, MA 02116",
      "website": "https://thaibasilma.com/",
      "phone": "+1 617-578-0089",
      "hours_verified": true,
      "hours_note": null,
      "hours_source": "https://thaibasilma.com/",
      "awards": [],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 202,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321998-Reviews-Thai_Basil_Restaurant-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 3.6,
          "count": 325,
          "url": "https://www.restaurantji.com/ma/boston/thai-basil-restaurant-/"
        }
      ],
      "review_highlights": [
        "Diners recommend the drunken noodles and chicken satay.",
        "Reviewers describe generous portions and affordable lunch combinations.",
        "The dining room is downstairs, and guests mention stairs at the entrance."
      ],
      "review_excerpts": [
        {
          "author": "Nelson",
          "source": "Tripadvisor",
          "text": "Very affordable with very tasty food.",
          "rating": null,
          "date_label": "June 11, 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321998-Reviews-Thai_Basil_Restaurant-Boston_Massachusetts.html"
        },
        {
          "author": "JC S",
          "source": "Google (reposted by Thai Basil)",
          "text": "Nice and friendly staff, good taste of food, fair price.",
          "rating": null,
          "date_label": null,
          "url": "https://thaibasilma.com/"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321998-Reviews-Thai_Basil_Restaurant-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/thai-basil-restaurant-/",
        "https://thaibasilma.com/"
      ]
    }
  },
  "copley-lolita-01": {
    "hours": {
      "mon": [
        "11:30",
        "01:00"
      ],
      "tue": [
        "11:30",
        "01:00"
      ],
      "wed": [
        "11:30",
        "01:00"
      ],
      "thu": [
        "11:30",
        "01:00"
      ],
      "fri": [
        "11:30",
        "02:00"
      ],
      "sat": [
        "11:30",
        "02:00"
      ],
      "sun": [
        "11:30",
        "01:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "271 Dartmouth St, Boston, MA 02116",
      "website": "https://www.lolitamexican.com/location/lolita-back-bay/",
      "phone": "+1 617-369-5609",
      "hours_verified": false,
      "hours_note": "Restaurantji supplies the posted schedule. Closing times are after midnight. The official location page confirms the address and phone.",
      "hours_source": "https://www.restaurantji.com/ma/boston/lolita-/",
      "awards": [
        {
          "title": "Best Mexican Restaurants in Boston inclusion",
          "org": "Time Out Boston",
          "year": 2026,
          "scope": "local",
          "url": "https://www.timeout.com/boston/restaurants/best-mexican-restaurants-in-boston"
        },
        {
          "title": "Best Margarita in Fenway contest winner",
          "org": "Time Out Market Boston",
          "year": 2025,
          "scope": "local",
          "url": "https://www.timeout.com/time-out-market-boston/time-out-market/this-is-officially-the-best-margarita-in-fenway"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.6,
          "count": 1071,
          "url": "https://www.opentable.com/r/lolita-cocina-and-tequila-bar-boston-2"
        },
        {
          "source": "Restaurantji",
          "rating": 4.1,
          "count": 676,
          "url": "https://www.restaurantji.com/ma/boston/lolita-/"
        }
      ],
      "review_highlights": [
        "Diners recommend sharing small plates such as street corn and tacos.",
        "Tequila flights and margaritas draw repeat mentions.",
        "Guests describe a dim dining room with music and lively conversation."
      ],
      "review_excerpts": [
        {
          "author": "CarlosF",
          "source": "OpenTable",
          "text": "A great place to meet up with friends and share small plates.",
          "rating": 4,
          "date_label": "December 18, 2019",
          "url": "https://www.opentable.com/r/lolita-cocina-and-tequila-bar-boston-2"
        },
        {
          "author": "OpenTable Diner",
          "source": "OpenTable",
          "text": "Our waiter Matt was friendly and attentive.",
          "rating": 5,
          "date_label": "January 18, 2020",
          "url": "https://www.opentable.com/r/lolita-cocina-and-tequila-bar-boston-2"
        }
      ],
      "review_sources": [
        "https://www.opentable.com/r/lolita-cocina-and-tequila-bar-boston-2",
        "https://www.restaurantji.com/ma/boston/lolita-/"
      ]
    }
  },
  "copley-newsfeed-01": {
    "hours": {
      "mon": [
        "09:00",
        "17:00"
      ],
      "tue": [
        "09:00",
        "17:00"
      ],
      "wed": [
        "09:00",
        "17:00"
      ],
      "thu": [
        "09:00",
        "17:00"
      ],
      "fri": [
        "09:00",
        "17:00"
      ],
      "sat": [
        "09:00",
        "17:00"
      ],
      "sun": [
        "11:00",
        "17:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "700 Boylston St, Boston, MA 02116",
      "website": "https://www.thecateredaffair.com/newsfeed-cafe/",
      "phone": "+1 617-357-7333",
      "hours_verified": true,
      "hours_note": "Inside the Boston Public Library’s Boylston Street building. Library closures may affect access.",
      "hours_source": "https://www.thecateredaffair.com/newsfeed-cafe/",
      "awards": [],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.8,
          "count": 26,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d11728219-Reviews-Newsfeed_Cafe-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 3.8,
          "count": 118,
          "url": "https://www.restaurantji.com/ma/boston/newsfeed-caf-/"
        }
      ],
      "review_highlights": [
        "Visitors like the café as a quick stop while exploring the library.",
        "Diners mention espresso drinks, sandwiches and brownies.",
        "Reviews praise the airy seating and the chance to see a live GBH broadcast."
      ],
      "review_excerpts": [
        {
          "author": "dustythoughts",
          "source": "Tripadvisor",
          "text": "There's plenty of seating in an airy area",
          "rating": null,
          "date_label": "February 15, 2023",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d11728219-Reviews-Newsfeed_Cafe-Boston_Massachusetts.html"
        },
        {
          "author": "BeachStone2C",
          "source": "Tripadvisor",
          "text": "This cafe in the Boston Public Library is a good spot to stop for a quick bite or coffee/tea.",
          "rating": null,
          "date_label": null,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d11728219-Reviews-Newsfeed_Cafe-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d11728219-Reviews-Newsfeed_Cafe-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/newsfeed-caf-/"
      ]
    }
  },
  "copley-oak-01": {
    "hours": {
      "mon": [
        "07:00",
        "00:00"
      ],
      "tue": [
        "07:00",
        "00:00"
      ],
      "wed": [
        "07:00",
        "00:00"
      ],
      "thu": [
        "07:00",
        "00:00"
      ],
      "fri": [
        "07:00",
        "00:00"
      ],
      "sat": [
        "07:00",
        "00:00"
      ],
      "sun": [
        "07:00",
        "00:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "138 St James Ave, Boston, MA 02116",
      "website": "https://www.oaklongbarkitchen.com/",
      "phone": "+1 617-585-7222",
      "hours_verified": true,
      "hours_note": "Midnight closing. Last food order at 11 p.m. and last drink order at 11:45 p.m.",
      "hours_source": "https://www.oaklongbarkitchen.com/",
      "awards": [
        {
          "title": "Award of Excellence",
          "org": "Wine Spectator",
          "year": 2017,
          "scope": "international",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Travelers’ Choice",
          "org": "Tripadvisor",
          "year": null,
          "scope": "international",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321915-Reviews-OAK_Long_Bar_Kitchen-Boston_Massachusetts.html"
        },
        {
          "title": "10Best Readers’ Choice — Best Hotel Bars",
          "org": "USA Today 10Best",
          "year": 2023,
          "scope": "national",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Diners’ Choice",
          "org": "OpenTable",
          "year": 2024,
          "scope": "local",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Diners’ Choice",
          "org": "OpenTable",
          "year": 2023,
          "scope": "local",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Luxe List winner",
          "org": "Boston Common Magazine",
          "year": 2023,
          "scope": "local",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Best Hotel Bar",
          "org": "Boston Common Magazine",
          "year": 2022,
          "scope": "local",
          "url": "https://www.fairmont-copley-plaza.com/awards-accolades/"
        },
        {
          "title": "Best of Boston — Best Hotel Bar",
          "org": "Boston Magazine",
          "year": 2017,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2017/oak-long-bar-kitchen/"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.5,
          "count": 2072,
          "url": "https://www.opentable.com/r/oak-long-bar-and-kitchen-boston"
        },
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 808,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321915-Reviews-OAK_Long_Bar_Kitchen-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Guests praise the historic dining room and lively bar.",
        "The Bee’s Knees, salmon and warm chocolate chip cookie stand out in diner feedback.",
        "Some guests report high noise levels and slow or uneven service during busy periods."
      ],
      "review_excerpts": [
        {
          "author": "Raed",
          "source": "OpenTable",
          "text": "The Bee’s Knees was also outstanding!",
          "rating": 5,
          "date_label": null,
          "url": "https://www.opentable.com/r/oak-long-bar-and-kitchen-boston"
        },
        {
          "author": "Deb",
          "source": "OpenTable",
          "text": "Crazy busy and wayyyyyy too loud.",
          "rating": 2,
          "date_label": null,
          "url": "https://www.opentable.com/r/oak-long-bar-and-kitchen-boston"
        }
      ],
      "review_sources": [
        "https://www.opentable.com/r/oak-long-bar-and-kitchen-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321915-Reviews-OAK_Long_Bar_Kitchen-Boston_Massachusetts.html"
      ]
    }
  },
  "copley-thinking-cup-01": {
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
        "21:00"
      ],
      "sat": [
        "07:00",
        "21:00"
      ],
      "sun": [
        "07:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "85 Newbury St, Boston, MA 02116",
      "website": "https://www.thinkingcup.info/",
      "phone": "+1 617-247-3333",
      "hours_verified": true,
      "hours_note": "The official Back Bay schedule lists a 9 p.m. close Friday through Sunday.",
      "hours_source": "https://www.thinkingcup.info/",
      "awards": [
        {
          "title": "Best of Boston Readers’ Poll — Best Coffee (Thinking Cup)",
          "org": "Boston Magazine",
          "year": 2015,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/news/2015/06/30/best-of-boston-2015-readers-poll-results/"
        },
        {
          "title": "Best of Boston Readers’ Poll — Best Coffee Shop (Thinking Cup)",
          "org": "Boston Magazine",
          "year": 2014,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/news/2014/07/29/best-of-boston-2014-readers-poll-results/"
        },
        {
          "title": "Best of Boston — Best Coffee Shop (Tremont Street location)",
          "org": "Boston Magazine",
          "year": 2011,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2011/thinking-cup/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.5,
          "count": 308,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d6539912-Reviews-Thinking_Cup-Boston_Massachusetts.html"
        },
        {
          "source": "Restaurantji",
          "rating": 4.3,
          "count": 508,
          "url": "https://www.restaurantji.com/ma/boston/thinking-cup-2/"
        }
      ],
      "review_highlights": [
        "Coffee, breakfast sandwiches and avocado toast get positive mentions.",
        "Reviewers praise the pastry selection and vegetarian options.",
        "The shop can fill up on weekends, although guests also report quick service."
      ],
      "review_excerpts": [
        {
          "author": "MaxPeen",
          "source": "Tripadvisor",
          "text": "Great coffee and breakfast. Place was packed on Saturday.",
          "rating": 5,
          "date_label": "October 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d6539912-Reviews-Thinking_Cup-Boston_Massachusetts.html"
        },
        {
          "author": "Frank R",
          "source": "Tripadvisor",
          "text": "Plenty of choice for the vegetarians in our group",
          "rating": null,
          "date_label": "August 7, 2022",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d6539912-Reviews-Thinking_Cup-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d6539912-Reviews-Thinking_Cup-Boston_Massachusetts.html",
        "https://www.restaurantji.com/ma/boston/thinking-cup-2/"
      ]
    }
  },
  "aquarium-legal-01": {
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
        "23:00"
      ],
      "sat": [
        "11:00",
        "23:00"
      ],
      "sun": [
        "11:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "255 State Street, Boston, MA 02109",
      "website": "https://www.legalseafoods.com/locations/boston-long-wharf/",
      "phone": "617-742-5300",
      "hours_verified": true,
      "hours_note": "Regular dining hours from the venue’s OpenTable listing. The restaurant’s location page loads hours dynamically.",
      "hours_source": "https://www.opentable.com/r/legal-sea-foods-long-wharf-reservations-boston",
      "awards": [
        {
          "title": "New England clam chowder served at presidential inaugurations since 1981 (brand tradition)",
          "org": "Legal Sea Foods",
          "year": null,
          "scope": "national",
          "url": "https://www.legalseafoods.com/patriots/"
        },
        {
          "title": "Best of Boston: Best Clam Chowder (brand award)",
          "org": "Boston Magazine",
          "year": 2025,
          "scope": "local",
          "url": "https://www.massport.com/sites/default/files/2025-09/Website-July-Board-Meeting-07-17-25.pdf"
        },
        {
          "title": "Best of Boston: Best Clam Chowder (brand award)",
          "org": "Boston Magazine",
          "year": 2024,
          "scope": "local",
          "url": "https://www.legalseafoods.com/best-of-boston-2024-best-clam-chowder/"
        },
        {
          "title": "Boston Chowderfest Hall of Fame (brand recognition)",
          "org": "Boston Harborfest Chowderfest",
          "year": null,
          "scope": "local",
          "url": "https://www.cbsnews.com/boston/news/best-clam-chowder-in-boston/"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.2,
          "count": 6095,
          "url": "https://www.opentable.com/r/legal-sea-foods-long-wharf-reservations-boston"
        },
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 5551,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321605-Reviews-Legal_Sea_Foods_Long_Wharf-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Clam chowder and lobster are common orders at the Long Wharf location.",
        "One diner praised attentive check-ins and well-cooked seafood.",
        "Diners seated near large groups report that the room can get noisy."
      ],
      "review_excerpts": [
        {
          "author": "Robert Gold",
          "source": "OpenTable",
          "text": "The food was perfectly cooked.",
          "rating": 5,
          "date_label": null,
          "url": "https://www.opentable.com/r/legal-sea-foods-long-wharf-reservations-boston"
        },
        {
          "author": "Blatt",
          "source": "OpenTable",
          "text": "Our food was good, consistent with other visits to Legal Seafood.",
          "rating": 3,
          "date_label": "November 6, 2026",
          "url": "https://www.opentable.com/r/legal-sea-foods-long-wharf-reservations-boston"
        }
      ],
      "review_sources": [
        "https://www.opentable.com/r/legal-sea-foods-long-wharf-reservations-boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321605-Reviews-Legal_Sea_Foods_Long_Wharf-Boston_Massachusetts.html"
      ]
    }
  },
  "aquarium-charthouse-01": {
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
        "23:00"
      ],
      "sat": [
        "11:00",
        "23:00"
      ],
      "sun": [
        "11:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "60 Long Wharf, Boston, MA 02110",
      "website": "https://www.chart-house.com/location/chart-house-boston-ma/",
      "phone": "617-227-1576",
      "hours_verified": true,
      "hours_note": null,
      "hours_source": "https://www.chart-house.com/location/chart-house-boston-ma/",
      "awards": [
        {
          "title": "Travelers’ Choice",
          "org": "Tripadvisor",
          "year": null,
          "scope": "international",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321606-Reviews-Chart_House-Boston_Massachusetts.html"
        },
        {
          "title": "Gardiner Building included in the Long Wharf and Custom House Block National Historic Landmark documentation",
          "org": "National Park Service",
          "year": null,
          "scope": "national",
          "url": "https://npgallery.nps.gov/NRHP/GetAsset/NHLS/66000768_text"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.5,
          "count": 5865,
          "url": "https://www.opentable.com/restaurant/profile/11836/reserve?rid=11836"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.3,
          "count": null,
          "url": "https://restaurantguru.com/Chart-House-Boston?com=1462042"
        },
        {
          "source": "Tripadvisor",
          "rating": 3.9,
          "count": 1595,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321606-Reviews-Chart_House-Boston_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Recent diners praised the prime rib and fresh fish.",
        "The former counting house gives the dining room a historic setting.",
        "Earlier evening seatings tend to be quieter before the dinner crowd arrives."
      ],
      "review_excerpts": [
        {
          "author": "Dang Gold",
          "source": "OpenTable",
          "text": "Fish was very fresh and prime rib was excellent",
          "rating": 5,
          "date_label": null,
          "url": "https://www.opentable.com/restaurant/profile/11836/reserve?rid=11836"
        },
        {
          "author": "Nancy",
          "source": "OpenTable",
          "text": "We ordered the prime rib and it didn’t disappoint.",
          "rating": 5,
          "date_label": null,
          "url": "https://www.opentable.com/restaurant/profile/11836/reserve?rid=11836"
        }
      ],
      "review_sources": [
        "https://www.opentable.com/restaurant/profile/11836/reserve?rid=11836",
        "https://restaurantguru.com/Chart-House-Boston?com=1462042",
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321606-Reviews-Chart_House-Boston_Massachusetts.html",
        "https://www.opentable.com/r/chart-house-restaurant-boston"
      ]
    }
  },
  "aquarium-blackrose-01": {
    "hours": {
      "mon": [
        "11:00",
        "02:00"
      ],
      "tue": [
        "11:00",
        "02:00"
      ],
      "wed": [
        "11:00",
        "02:00"
      ],
      "thu": [
        "11:00",
        "02:00"
      ],
      "fri": [
        "11:00",
        "02:00"
      ],
      "sat": [
        "10:00",
        "02:00"
      ],
      "sun": [
        "10:00",
        "02:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "160 State Street, Boston, MA 02109",
      "website": "https://www.blackroseboston.com/",
      "phone": "857-847-4366",
      "hours_verified": false,
      "hours_note": "The pub publishes opening times and gives closing as ‘Close.’ The 2 a.m. closing time is from Restaurantji and may vary.",
      "hours_source": "https://www.blackroseboston.com/location/the-black-rose/",
      "awards": [
        {
          "title": "The Best Irish Bars in Boston (editorial selection)",
          "org": "Eater Boston",
          "year": 2025,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-irish-bars-boston"
        },
        {
          "title": "Six Best Irish Pubs Around Greater Boston (readers’ selection)",
          "org": "Boston.com",
          "year": 2024,
          "scope": "local",
          "url": "https://www.boston.com/community/readers-say/best-irish-pubs-in-greater-boston/"
        },
        {
          "title": "The Best Irish Pubs in Boston (editorial selection)",
          "org": "Boston Magazine",
          "year": null,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/restaurants/best-irish-pubs-boston/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.1,
          "count": 1096,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d503318-Reviews-The_Black_Rose-Boston_Massachusetts.html"
        },
        {
          "source": "OpenTable",
          "rating": 4.4,
          "count": 85,
          "url": "https://www.opentable.com/r/the-black-rose-boston"
        }
      ],
      "review_highlights": [
        "Live Irish music is a draw for diners looking for a lively pub.",
        "Guinness and traditional Irish dishes anchor the menu.",
        "OpenTable reviewers describe a friendly pub atmosphere and attentive bar staff."
      ],
      "review_excerpts": [
        {
          "author": "BMF2652",
          "source": "OpenTable",
          "text": "bartender/waitstaff was very attentive",
          "rating": 4,
          "date_label": "March 25, 2021",
          "url": "https://www.opentable.com/r/the-black-rose-boston"
        },
        {
          "author": "hawthorn",
          "source": "OpenTable",
          "text": "homey and friendly and inspiring, all at the same time.",
          "rating": 5,
          "date_label": "March 18, 2021",
          "url": "https://www.opentable.com/r/the-black-rose-boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d503318-Reviews-The_Black_Rose-Boston_Massachusetts.html",
        "https://www.opentable.com/r/the-black-rose-boston",
        "https://www.restaurantji.com/ma/boston/the-black-rose-/"
      ]
    }
  },
  "aquarium-saltydog-01": {
    "hours": {
      "mon": [
        "11:00",
        "21:00"
      ],
      "tue": [
        "11:00",
        "21:00"
      ],
      "wed": [
        "11:00",
        "21:00"
      ],
      "thu": [
        "11:00",
        "21:00"
      ],
      "fri": [
        "11:00",
        "22:00"
      ],
      "sat": [
        "11:00",
        "22:00"
      ],
      "sun": [
        "11:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "206 Faneuil Hall Marketplace, Boston, MA 02109",
      "website": "https://faneuilhallmarketplace.com/go/the-salty-dog",
      "phone": "617-742-2094",
      "hours_verified": false,
      "hours_note": "Restaurantji posts venue hours. Tripadvisor differs, and the marketplace directory repeats general market hours. The restaurant domain linked by the marketplace was inaccessible.",
      "hours_source": "https://www.restaurantji.com/ma/boston/salty-dog-seafood-grille-and-bar-/",
      "awards": [],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 3.8,
          "count": 687,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321619-Reviews-Salty_Dog_Seafood_Grille_Bar-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.1,
          "count": 820,
          "url": "https://restaurantguru.com/Salty-Dog-Seafood-Grille-and-Bar-Boston"
        }
      ],
      "review_highlights": [
        "Oysters and fish tacos drew praise even in a review critical of service.",
        "The Lobsterman’s Casserole drew praise for seafood that stayed tender, though one diner wanted more seasoning.",
        "Reports on service vary from friendly and fast to a slow, unwelcoming start."
      ],
      "review_excerpts": [
        {
          "author": "Brookie Kilgore",
          "source": "Google (via Restaurant Guru)",
          "text": "the oysters and fish tacos were very good",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Salty-Dog-Seafood-Grille-and-Bar-Boston"
        },
        {
          "author": "Jacob Robertson",
          "source": "Google (via Restaurant Guru)",
          "text": "Service was friendly and fast.",
          "rating": null,
          "date_label": null,
          "url": "https://restaurantguru.com/Salty-Dog-Seafood-Grille-and-Bar-Boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321619-Reviews-Salty_Dog_Seafood_Grille_Bar-Boston_Massachusetts.html",
        "https://restaurantguru.com/Salty-Dog-Seafood-Grille-and-Bar-Boston"
      ]
    }
  },
  "aquarium-granary-01": {
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
        "09:00",
        "23:00"
      ],
      "fri": [
        "09:00",
        "00:00"
      ],
      "sat": [
        "10:00",
        "00:00"
      ],
      "sun": [
        "10:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "170 Milk Street, Boston, MA 02109",
      "website": "https://www.granarytavern.com/",
      "phone": "617-606-9485",
      "hours_verified": false,
      "hours_note": "Used the restaurant’s dedicated location page. The homepage and parent company publish different hours. These closing times are for the venue, and kitchen hours differ. The homepage also lists 617-449-7110.",
      "hours_source": "https://www.granarytavern.com/location/granary-tavern/",
      "awards": [
        {
          "title": "Best Kid-Friendly Restaurant, Readers’ Poll runner-up",
          "org": "Boston Magazine",
          "year": 2025,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/news/2025/07/09/best-of-boston-readers-poll-results/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4,
          "count": 697,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d3268111-Reviews-Granary_Tavern-Boston_Massachusetts.html"
        },
        {
          "source": "OpenTable",
          "rating": 4.2,
          "count": 927,
          "url": "https://www.opentable.com/r/granary-tavern-boston"
        }
      ],
      "review_highlights": [
        "Diners mention the patio and open windows for warm-weather meals.",
        "The Boston dip sandwich and Cobb salad drew praise in a lunch review.",
        "Cocktails and the dining-room atmosphere drew positive comments from OpenTable diners."
      ],
      "review_excerpts": [
        {
          "author": "JennH",
          "source": "OpenTable",
          "text": "Delicious food and amazing cocktails!",
          "rating": 5,
          "date_label": "February 27, 2022",
          "url": "https://www.opentable.com/r/granary-tavern-boston"
        },
        {
          "author": "DavidP",
          "source": "OpenTable",
          "text": "Good food, great atmosphere!",
          "rating": 5,
          "date_label": "February 27, 2022",
          "url": "https://www.opentable.com/r/granary-tavern-boston"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d3268111-Reviews-Granary_Tavern-Boston_Massachusetts.html",
        "https://www.opentable.com/r/granary-tavern-boston",
        "https://restaurantguru.com/Granary-Tavern-Boston"
      ]
    }
  },
  "aquarium-sailloft-01": {
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
        "22:00"
      ],
      "sat": [
        "11:30",
        "22:00"
      ],
      "sun": [
        "11:30",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "80 Atlantic Avenue, Boston, MA 02110",
      "website": "https://www.thebostonsailloft.com/",
      "phone": "617-227-7280",
      "hours_verified": true,
      "hours_note": "Kitchen hours are listed. The bar stays open until 2 a.m. Seating is first come, first served.",
      "hours_source": "https://www.thebostonsailloft.com/location/boston-sail-loft/",
      "awards": [
        {
          "title": "Travelers’ Choice",
          "org": "Tripadvisor",
          "year": null,
          "scope": "international",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321583-Reviews-Boston_Sail_Loft-Boston_Massachusetts.html"
        },
        {
          "title": "Best Chowder, Clam Chowder",
          "org": "Boston Magazine",
          "year": 2019,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2019/boston-sail-loft-2/"
        },
        {
          "title": "Best Chowder, Clam Chowder",
          "org": "Boston Magazine",
          "year": 2018,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2018/boston-sail-loft/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.4,
          "count": 1543,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321583-Reviews-Boston_Sail_Loft-Boston_Massachusetts.html"
        },
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.6,
          "count": 6766,
          "url": "https://restaurantguru.com/Boston-Sail-Loft-Boston"
        }
      ],
      "review_highlights": [
        "Thick clam chowder with dill and lobster rolls are frequently praised.",
        "Bar seats and waterfront tables offer views of boats and the harbor.",
        "Walk-in waits can stretch past 30 minutes during busy periods."
      ],
      "review_excerpts": [
        {
          "author": "Kauff_210",
          "source": "Tripadvisor",
          "text": "It's about as good as it gets.",
          "rating": 5,
          "date_label": "November 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321583-Reviews-Boston_Sail_Loft-Boston_Massachusetts.html"
        },
        {
          "author": "TXdawg",
          "source": "Tripadvisor",
          "text": "Waited in line for about 20 minutes taking in the harbor when the owner comes out.",
          "rating": 5,
          "date_label": "October 2026",
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60745-d321583-Reviews-Boston_Sail_Loft-Boston_Massachusetts.html"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60745-d321583-Reviews-Boston_Sail_Loft-Boston_Massachusetts.html",
        "https://restaurantguru.com/Boston-Sail-Loft-Boston"
      ]
    }
  },
  "central-asmara-01": {
    "hours": {
      "mon": [
        "17:00",
        "21:00"
      ],
      "tue": [
        "17:00",
        "21:00"
      ],
      "wed": [
        "17:00",
        "21:00"
      ],
      "thu": [
        "17:00",
        "21:00"
      ],
      "fri": [
        "17:00",
        "21:00"
      ],
      "sat": [
        "17:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "739 Massachusetts Ave, Cambridge, MA 02139",
      "website": "https://www.asmararestaurantboston.com/",
      "phone": "617-864-7447",
      "hours_verified": true,
      "hours_note": "Closed Sunday. Kitchen closes 30 minutes before the restaurant.",
      "hours_source": "https://www.asmararestaurantboston.com/contactus.html",
      "awards": [
        {
          "title": "Best of Boston Award",
          "org": "Boston Magazine (reported by Asmara)",
          "year": 1987,
          "scope": "local",
          "url": "https://www.asmararestaurantboston.com/custom/aboutus.html"
        },
        {
          "title": "Experts’ Choice Award (Boston restaurants)",
          "org": "Tripexpert",
          "year": null,
          "scope": "local",
          "url": "https://www.tripexpert.com/boston/restaurants/asmara-restaurant"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 80,
          "url": "https://www.tripadvisor.ca/Restaurant_Review-g60890-d323682-Reviews-Asmara_Restaurant-Cambridge_Massachusetts.html"
        },
        {
          "source": "Birdeye",
          "rating": 4.4,
          "count": 698,
          "url": "https://reviews.birdeye.com/asmara-restaurant-145296390564873"
        }
      ],
      "review_highlights": [
        "Diners share Eritrean and Ethiopian stews and scoop them up with injera.",
        "The woven mesob tables are part of the dining experience.",
        "Kitfo and the vegetarian combination are two options reviewers single out.",
        "Some diners describe slow service, even when they find the staff friendly."
      ],
      "review_excerpts": [
        {
          "author": "demurlemur",
          "source": "Citysearch via Birdeye",
          "text": "The traditional seating around woven basket tables is charming",
          "rating": null,
          "date_label": null,
          "url": "https://reviews.birdeye.com/asmara-restaurant-145296390564873"
        },
        {
          "author": "sanfordandson053",
          "source": "Citysearch via Birdeye",
          "text": "my friend got a yellow split pea curry that was not just mild but bland",
          "rating": null,
          "date_label": null,
          "url": "https://reviews.birdeye.com/asmara-restaurant-145296390564873"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.ca/Restaurant_Review-g60890-d323682-Reviews-Asmara_Restaurant-Cambridge_Massachusetts.html",
        "https://reviews.birdeye.com/asmara-restaurant-145296390564873",
        "https://www.tripexpert.com/boston/restaurants/asmara-restaurant",
        "https://guidetocambridge.com/restaurants/asmara"
      ]
    }
  },
  "central-cicada-01": {
    "hours": {
      "tue": [
        "08:00",
        "15:00"
      ],
      "wed": [
        "08:00",
        "15:00"
      ],
      "thu": [
        "08:00",
        "15:00"
      ],
      "fri": [
        "08:00",
        "15:00"
      ],
      "sat": [
        "09:00",
        "15:00"
      ],
      "sun": [
        "09:00",
        "15:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "106 Prospect St, Cambridge, MA 02139",
      "website": "https://cicada-coffee-bar.square.site/",
      "phone": "617-714-4766",
      "hours_verified": false,
      "hours_note": "Daytime hours agree across listings. Closed Monday. Restaurantji lists evening service 5–11 p.m. Tuesday–Sunday, while the contact page lists daytime hours only. Check evening availability with the café.",
      "hours_source": "https://cicadacoffeebar.com/contact/",
      "awards": [
        {
          "title": "Emerging Chef semifinalist (Vinh Le)",
          "org": "James Beard Foundation",
          "year": 2023,
          "scope": "national",
          "url": "https://www.jamesbeard.org/stories/the-2023-james-beard-awards-semifinalists"
        },
        {
          "title": "Best of Boston: Best Coffee Shop",
          "org": "Boston Magazine",
          "year": 2023,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/award/coffee-shop/"
        },
        {
          "title": "Best of Boston: Best Coffee Shop",
          "org": "Boston Magazine",
          "year": 2022,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/2022/cicada-coffee-bar/"
        },
        {
          "title": "Eater Awards: Best New Cafe",
          "org": "Eater Boston",
          "year": 2021,
          "scope": "local",
          "url": "https://boston.eater.com/22823296/eater-awards-boston-2021-winners-best-new-restaurant-bar-cafe-bakery"
        }
      ],
      "ratings": [
        {
          "source": "Google via Wanderlog",
          "rating": 4.4,
          "count": 715,
          "url": "https://wanderlog.com/place/details/1511888/cicada"
        },
        {
          "source": "Restaurantji",
          "rating": 4.2,
          "count": 268,
          "url": "https://www.restaurantji.com/ma/cambridge/cicada-coffee-bar-/"
        }
      ],
      "review_highlights": [
        "The Sea Salt Shaker and rotating pastries stand out in daytime reviews.",
        "Diners mention mango-mushroom spring rolls, coconut eggplant and duck dishes.",
        "Indoor seating is limited, and reviewers like the backyard patio.",
        "Reviewers report a no-laptop policy and counter service."
      ],
      "review_excerpts": [
        {
          "author": "Nicholas T",
          "source": "Google via Wanderlog",
          "text": "The mango mushroom spring rolls were so fresh.",
          "rating": 5,
          "date_label": "Oct 20, 2026",
          "url": "https://wanderlog.com/place/details/1511888/cicada"
        },
        {
          "author": "Daeuni",
          "source": "Google via Wanderlog",
          "text": "The baked salmon fresh noodle is fresh, light and flavorful.",
          "rating": 5,
          "date_label": "Apr 23, 2026",
          "url": "https://wanderlog.com/place/details/1511888/cicada"
        }
      ],
      "review_sources": [
        "https://wanderlog.com/place/details/1511888/cicada",
        "https://www.restaurantji.com/ma/cambridge/cicada-coffee-bar-/"
      ]
    }
  },
  "central-andala-01": {
    "hours": {
      "mon": [
        "09:00",
        "23:00"
      ],
      "tue": [
        "09:00",
        "23:00"
      ],
      "wed": [
        "09:00",
        "23:00"
      ],
      "thu": [
        "09:00",
        "23:00"
      ],
      "fri": [
        "09:00",
        "23:00"
      ],
      "sat": [
        "08:00",
        "23:00"
      ],
      "sun": [
        "08:00",
        "23:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "286 Franklin St, Cambridge, MA 02139",
      "website": "https://www.andalacoffee.com/",
      "phone": "617-945-2212",
      "hours_verified": true,
      "hours_note": "The café lists a 9 p.m. kitchen close. Hours follow the café’s own schedule.",
      "hours_source": "https://www.andalacoffee.com/",
      "awards": [
        {
          "title": "Best Breakfast & Brunch Spots in Cambridge (roundup inclusion)",
          "org": "CBS Boston / Hoodline",
          "year": 2019,
          "scope": "local",
          "url": "https://www.cbsnews.com/boston/news/best-breakfast-brunch-cambridge/"
        }
      ],
      "ratings": [
        {
          "source": "Birdeye",
          "rating": 4.2,
          "count": 1940,
          "url": "https://reviews.birdeye.com/andala-coffee-house-149298846247127"
        },
        {
          "source": "Restaurantji",
          "rating": 3.9,
          "count": 464,
          "url": "https://www.restaurantji.com/ma/cambridge/andala-coffee-house-/"
        }
      ],
      "review_highlights": [
        "Falafel plates and chicken shawarma sandwiches are frequently mentioned.",
        "Reviewers highlight lentil soup, pastries and tea.",
        "The converted house has a sunroom and outdoor seating, with rugs and Arabic art inside.",
        "Some guests describe uneven service and noise."
      ],
      "review_excerpts": [
        {
          "author": "adwoag",
          "source": "Citysearch via Birdeye",
          "text": "Cafe Andala is one of a handful of neighborhood spots for me.",
          "rating": null,
          "date_label": null,
          "url": "https://reviews.birdeye.com/andala-coffee-house-149298846247127"
        },
        {
          "author": "lovecitylife",
          "source": "Citysearch via Birdeye",
          "text": "It is a house turned into a fantstic coffee shop!",
          "rating": null,
          "date_label": null,
          "url": "https://reviews.birdeye.com/andala-coffee-house-149298846247127"
        }
      ],
      "review_sources": [
        "https://reviews.birdeye.com/andala-coffee-house-149298846247127",
        "https://www.restaurantji.com/ma/cambridge/andala-coffee-house-/"
      ]
    }
  },
  "central-paikinkao-01": {
    "hours": {
      "mon": [
        "11:30",
        "21:00"
      ],
      "tue": [
        "11:30",
        "21:00"
      ],
      "wed": [
        "11:30",
        "21:00"
      ],
      "thu": [
        "11:30",
        "21:00"
      ],
      "fri": [
        "11:30",
        "21:00"
      ],
      "sat": [
        "11:30",
        "21:00"
      ],
      "sun": [
        "12:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "80 River St, Cambridge, MA 02139",
      "website": "https://paikinkaoboston.com/",
      "phone": "617-945-2977",
      "hours_verified": false,
      "hours_note": "Hours are from Wanderlog. Other listings show different weekend openings and closing times.",
      "hours_source": "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant",
      "awards": [
        {
          "title": "Best Thai Food in Cambridge (roundup inclusion)",
          "org": "CBS Boston / Hoodline",
          "year": 2019,
          "scope": "local",
          "url": "https://www.cbsnews.com/boston/news/best-thai-food-cambridge/"
        }
      ],
      "ratings": [
        {
          "source": "Google via Wanderlog",
          "rating": 4.4,
          "count": 420,
          "url": "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant"
        },
        {
          "source": "Tripadvisor via Wanderlog",
          "rating": 4.5,
          "count": 7,
          "url": "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant"
        }
      ],
      "review_highlights": [
        "Thai dry noodles, drunken noodles and ramen are among the dishes reviewers praise.",
        "Reviewers highlight the pineapple yellow curry and the roast pork rice plate.",
        "The dining room is small, and some reviewers report quick service.",
        "Some reviewers found the curry thin or the takeout portions small."
      ],
      "review_excerpts": [
        {
          "author": "Stuart C",
          "source": "Google via Wanderlog",
          "text": "The food was great here.",
          "rating": 5,
          "date_label": "Oct 22, 2025",
          "url": "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant"
        },
        {
          "author": "Noor A",
          "source": "Google via Wanderlog",
          "text": "the beef curry was very light",
          "rating": 3,
          "date_label": "Jul 10, 2025",
          "url": "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant"
        }
      ],
      "review_sources": [
        "https://wanderlog.com/place/details/1474996/pai-kin-kao-thai-restaurant",
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d14764774-Reviews-Pai_Kin_Kao_Thai_Restaurant_In_Cambridge-Cambridge_Massachusetts.html"
      ]
    }
  },
  "central-lanner-01": {
    "hours": {
      "mon": [
        "17:00",
        "21:30"
      ],
      "tue": [
        "17:00",
        "21:30"
      ],
      "wed": [
        "17:00",
        "21:30"
      ],
      "thu": [
        "17:00",
        "21:30"
      ],
      "fri": [
        "17:00",
        "22:00"
      ],
      "sat": [
        "11:30",
        "22:00"
      ],
      "sun": [
        "11:30",
        "21:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "24 Pearl St, Cambridge, MA 02139",
      "website": "https://www.lannernoodles.com/",
      "phone": "617-395-3206",
      "hours_verified": true,
      "hours_note": "Monday–Friday also open 11:30 a.m.–2:30 p.m. Structured weekday hours show dinner only because the schema supports one interval per day.",
      "hours_source": "https://www.lannernoodles.com/",
      "awards": [],
      "ratings": [
        {
          "source": "Restaurantji",
          "rating": 4.2,
          "count": 244,
          "url": "https://www.restaurantji.com/ma/cambridge/lanner-noodles-bar-/"
        },
        {
          "source": "Tripadvisor",
          "rating": 4,
          "count": 1,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60890-d27730252-Reviews-Lanner_Noodles-Cambridge_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers praise the chew of the hand-pulled noodles and the choice of noodle width.",
        "Beef rib chili oil noodles and Lanzhou beef noodle soup are commonly mentioned.",
        "Lamb skewers and spiced chicken nuggets get positive mentions.",
        "The dining room is snug, and one Friday diner reported a one-hour wait."
      ],
      "review_excerpts": [
        {
          "author": "Alex K.",
          "source": "Yelp via Roadtrippers",
          "text": "The chili oil beef rib noodles were fire.",
          "rating": null,
          "date_label": "May 18, 2026",
          "url": "https://maps.roadtrippers.com/us/cambridge-ma/food-drink/lanner-noodles-bar"
        },
        {
          "author": "Daniel L.",
          "source": "Yelp via Roadtrippers",
          "text": "this is my go-to spot for a comforting bowl of beef noodle soup",
          "rating": null,
          "date_label": "June 10, 2026",
          "url": "https://maps.roadtrippers.com/us/cambridge-ma/food-drink/lanner-noodles-bar"
        }
      ],
      "review_sources": [
        "https://www.restaurantji.com/ma/cambridge/lanner-noodles-bar-/",
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d27730252-Reviews-Lanner_Noodles-Cambridge_Massachusetts.html",
        "https://maps.roadtrippers.com/us/cambridge-ma/food-drink/lanner-noodles-bar"
      ]
    }
  },
  "central-veggiegalaxy-01": {
    "hours": {
      "mon": [
        "09:00",
        "21:00"
      ],
      "tue": [
        "09:00",
        "21:00"
      ],
      "wed": [
        "09:00",
        "21:00"
      ],
      "thu": [
        "09:00",
        "21:00"
      ],
      "sun": [
        "09:00",
        "21:00"
      ],
      "fri": [
        "09:00",
        "22:00"
      ],
      "sat": [
        "09:00",
        "22:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "450 Massachusetts Ave, Cambridge, MA 02139",
      "website": "https://www.veggiegalaxy.com/",
      "phone": "617-497-1513",
      "hours_verified": true,
      "hours_note": null,
      "hours_source": "https://www.veggiegalaxy.com/",
      "awards": [
        {
          "title": "Best Vegan-Friendly Restaurant: readers’ first place and editors’ vote",
          "org": "VegNews Restaurant Awards",
          "year": 2025,
          "scope": "national",
          "url": "https://vegnews.com/best-vegan-restaurants-america"
        },
        {
          "title": "Top Vegan Thanksgiving Pies honorable mention: Mile High Lemon Meringue Pie",
          "org": "PETA",
          "year": 2019,
          "scope": "national",
          "url": "https://www.peta.org/media/news-releases/who-has-the-best-vegan-pies-for-thanksgiving-see-petas-top-10-list/"
        },
        {
          "title": "Diners, Drive-Ins and Dives feature",
          "org": "Food Network",
          "year": 2019,
          "scope": "national",
          "url": "https://www.foodnetwork.com/restaurants/ma/cambridge/veggie-galaxy-restaurant"
        },
        {
          "title": "Best of Boston: Best Vegetarian Restaurant",
          "org": "Boston Magazine",
          "year": 2012,
          "scope": "local",
          "url": "https://www.bostonmagazine.com/best-of-boston-archive/award/vegetarian-restaurant/"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.5,
          "count": 329,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60890-d2316659-Reviews-Veggie_Galaxy-Cambridge_Massachusetts.html"
        },
        {
          "source": "Google via Spinach",
          "rating": 4.6,
          "count": 4482,
          "url": "https://spinach.guide/venues/veggie-galaxy-125617/"
        }
      ],
      "review_highlights": [
        "Reviewers like that the diner offers vegan versions of breakfast sandwiches and other comfort food.",
        "Vegan mozzarella sticks and the po’ boy earn praise.",
        "The bakery’s pies, rotating cakes and doughnuts draw repeat visits.",
        "Some reviewers report long waits at busy times."
      ],
      "review_excerpts": [
        {
          "author": "Kwr_",
          "source": "HappyCow",
          "text": "Great diner food, rotating cake display, boozy milkshakes",
          "rating": null,
          "date_label": "23 Jun 2025",
          "url": "https://www.happycow.net/reviews/veggie-galaxy-cambridge-27722/1959590"
        },
        {
          "author": "LewZealand",
          "source": "HappyCow",
          "text": "Had the vegan mozz sticks and the po boy sandwich.",
          "rating": null,
          "date_label": "14 Apr 2026",
          "url": "https://www.happycow.net/reviews/veggie-galaxy-cambridge-27722/2149174"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60890-d2316659-Reviews-Veggie_Galaxy-Cambridge_Massachusetts.html",
        "https://www.happycow.net/reviews/veggie-galaxy-cambridge-27722/1959590",
        "https://www.happycow.net/reviews/veggie-galaxy-cambridge-27722/2149174",
        "https://www.happycow.net/reviews/veggie-galaxy-cambridge-27722",
        "https://spinach.guide/venues/veggie-galaxy-125617/"
      ]
    }
  },
  "coolidge-zaftigs-01": {
    "hours": {
      "mon": [
        "08:00",
        "20:00"
      ],
      "tue": [
        "08:00",
        "20:00"
      ],
      "wed": [
        "08:00",
        "20:00"
      ],
      "thu": [
        "08:00",
        "20:00"
      ],
      "fri": [
        "08:00",
        "21:00"
      ],
      "sat": [
        "08:00",
        "21:00"
      ],
      "sun": [
        "08:00",
        "20:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "335 Harvard St, Brookline, MA 02446",
      "website": "https://www.zaftigs.com/",
      "phone": "617-975-0075",
      "hours_verified": true,
      "hours_note": "Brookline dining hours. Weekend brunch is walk-in only.",
      "hours_source": "https://www.zaftigs.com/locations.html",
      "awards": [
        {
          "title": "The Best Jewish Delis in America (editorial selection)",
          "org": "Condé Nast Traveler",
          "year": 2016,
          "scope": "national",
          "url": "https://www.cntraveler.com/stories/2016-04-22/the-best-jewish-delis-in-america"
        },
        {
          "title": "The Best Restaurants and Bars in Brookline (editorial selection)",
          "org": "Eater Boston",
          "year": null,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-restaurants-bars-brookline"
        }
      ],
      "ratings": [
        {
          "source": "Tripadvisor",
          "rating": 4.2,
          "count": 668,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60823-d323274-Reviews-Zaftigs_Delicatessen-Brookline_Massachusetts.html"
        },
        {
          "source": "DoorDash",
          "rating": 4.6,
          "count": null,
          "url": "https://www.doordash.com/store/1268"
        }
      ],
      "review_highlights": [
        "Crisp potato pancakes are a recurring favorite, including topped with smoked salmon and sour cream.",
        "The New Yorker stacks pastrami and corned beef, and breakfast dishes are available all day.",
        "Delivery feedback varies on the Reuben, with a complaint about unusually fatty corned beef."
      ],
      "review_excerpts": [
        {
          "author": "Lala Thaddeus",
          "source": "The Infatuation",
          "text": "the food is top notch and perfect for a meatier brunch.",
          "rating": null,
          "date_label": "October 25, 2024",
          "url": "https://www.theinfatuation.com/boston/reviews/zaftigs"
        },
        {
          "author": "Amanda G",
          "source": "DoorDash",
          "text": "i'm amazed by the size and crunch of my Single Potato Pancake",
          "rating": null,
          "date_label": "6/15/26",
          "url": "https://www.doordash.com/store/1268"
        }
      ],
      "review_sources": [
        "https://www.tripadvisor.com/Restaurant_Review-g60823-d323274-Reviews-Zaftigs_Delicatessen-Brookline_Massachusetts.html",
        "https://www.doordash.com/store/1268",
        "https://www.theinfatuation.com/boston/reviews/zaftigs"
      ]
    }
  },
  "coolidge-maruichi-01": {
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
        "21:00"
      ],
      "sat": [
        "10:00",
        "21:00"
      ],
      "sun": [
        "10:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "299 Harvard St, Brookline, MA 02446",
      "website": "https://www.maruichius.net/store",
      "phone": "617-487-8171",
      "hours_verified": false,
      "hours_note": "Third-party shop hours. Official directory confirms address and phone. Kitchen and ordering hours are shorter.",
      "hours_source": "https://restaurantguru.com/Maruichi-Japanese-Food-and-Deli-Brookline",
      "awards": [],
      "ratings": [
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.4,
          "count": 320,
          "url": "https://restaurantguru.com/Maruichi-Japanese-Food-and-Deli-Brookline"
        },
        {
          "source": "DoorDash",
          "rating": 4.7,
          "count": null,
          "url": "https://www.doordash.com/store/24998439?pickup=true&src=yp"
        }
      ],
      "review_highlights": [
        "Premium onigiri earns praise for fillings like braised pork and egg or spicy karaage.",
        "Reviewers describe the matcha as relatively unsweet and recommend the hojicha latte.",
        "Curry and freshly fried katsu are popular, while reviews differ on the value of the premium chirashi."
      ],
      "review_excerpts": [
        {
          "author": "Keira Yee",
          "source": "Google (via Restaurant Guru)",
          "text": "cute place to grab matcha! matcha was good not overly sweet.",
          "rating": null,
          "date_label": "3 months ago",
          "url": "https://restaurantguru.com/Maruichi-Japanese-Food-and-Deli-Brookline"
        },
        {
          "author": "Andrea A",
          "source": "DoorDash",
          "text": "Katsu is freshly fried and crunchy.",
          "rating": null,
          "date_label": "1/11/26",
          "url": "https://www.doordash.com/store/24998439?pickup=true&src=yp"
        },
        {
          "author": "Wynaro",
          "source": "Grubhub",
          "text": "This curry is amazing!",
          "rating": null,
          "date_label": "1 week ago",
          "url": "https://www.grubhub.com/restaurant/maruichi-select-299-harvard-st-brookline/9453736"
        }
      ],
      "review_sources": [
        "https://restaurantguru.com/Maruichi-Japanese-Food-and-Deli-Brookline",
        "https://www.doordash.com/store/24998439?pickup=true&src=yp",
        "https://www.grubhub.com/restaurant/maruichi-select-299-harvard-st-brookline/9453736"
      ]
    }
  },
  "coolidge-prairie-fire-01": {
    "hours": {
      "mon": [
        "16:00",
        "21:00"
      ],
      "tue": [
        "16:00",
        "21:00"
      ],
      "wed": [
        "16:00",
        "21:00"
      ],
      "thu": [
        "16:00",
        "21:00"
      ],
      "fri": [
        "16:00",
        "22:00"
      ],
      "sat": [
        "12:00",
        "22:00"
      ],
      "sun": [
        "12:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "242 Harvard St, Brookline, MA 02446",
      "website": "https://www.prairiefirebrookline.com/",
      "phone": "617-396-8199",
      "hours_verified": true,
      "hours_note": "All-day menu on Saturday and Sunday.",
      "hours_source": "https://www.prairiefirebrookline.com/",
      "awards": [
        {
          "title": "The Essential Guide to Brookline: Best Restaurants (editorial selection)",
          "org": "Travel + Leisure",
          "year": 2026,
          "scope": "national",
          "url": "https://www.travelandleisure.com/brookline-massachusetts-guide-11995474"
        },
        {
          "title": "Best Neighborhood Restaurants (editorial selection)",
          "org": "The Boston Globe",
          "year": 2026,
          "scope": "local",
          "url": "https://www.bostonglobe.com/2026/06/04/magazine/the-neighborhood-best-restaurants/"
        },
        {
          "title": "The Best Restaurants and Bars in Brookline (editorial selection)",
          "org": "Eater Boston",
          "year": null,
          "scope": "local",
          "url": "https://boston.eater.com/maps/best-restaurants-bars-brookline"
        }
      ],
      "ratings": [
        {
          "source": "OpenTable",
          "rating": 4.9,
          "count": 749,
          "url": "https://www.opentable.com/restaurant/profile/1071715"
        },
        {
          "source": "Tripadvisor",
          "rating": 3.8,
          "count": 42,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60823-d12936762-Reviews-Prairie_Fire-Brookline_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Squid ink campanelle with Maine lobster has been a menu constant since opening.",
        "Critics single out the wood-fired fennel-sausage pizza and lager-glazed half chicken.",
        "Oysters and cocktails at the bar complement the house-made pasta and seasonal vegetables."
      ],
      "review_excerpts": [
        {
          "author": "Devra First",
          "source": "The Boston Globe",
          "text": "Some nights the food might be better than others, but it is reliably, consistently good.",
          "rating": null,
          "date_label": "November 11, 2026",
          "url": "https://www.bostonglobe.com/2026/11/11/lifestyle/prairie-fire-restaurant-brookline-pizza/"
        },
        {
          "author": "Jacqueline Cain",
          "source": "Boston Magazine",
          "text": "a fire-roasted menu of pizza, seasonal vegetables, house-made pastas, and more",
          "rating": null,
          "date_label": "September 5, 2017",
          "url": "https://www.bostonmagazine.com/restaurants/2017/09/05/prairie-fire-open-brookline/"
        }
      ],
      "review_sources": [
        "https://www.opentable.com/restaurant/profile/1071715",
        "https://www.tripadvisor.com/Restaurant_Review-g60823-d12936762-Reviews-Prairie_Fire-Brookline_Massachusetts.html",
        "https://www.bostonglobe.com/2026/11/11/lifestyle/prairie-fire-restaurant-brookline-pizza/",
        "https://www.bostonmagazine.com/restaurants/2017/09/05/prairie-fire-open-brookline/",
        "https://boston.eater.com/maps/best-restaurants-bars-brookline"
      ]
    }
  },
  "coolidge-los-amigos-01": {
    "hours": {
      "mon": [
        "11:00",
        "21:30"
      ],
      "tue": [
        "11:00",
        "21:30"
      ],
      "wed": [
        "11:00",
        "21:30"
      ],
      "thu": [
        "11:00",
        "21:30"
      ],
      "fri": [
        "11:00",
        "21:30"
      ],
      "sat": [
        "11:00",
        "21:30"
      ],
      "sun": [
        "11:00",
        "21:30"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "1294 Beacon St, Brookline, MA 02446",
      "website": "https://www.amigosburritos.com/",
      "phone": null,
      "hours_verified": true,
      "hours_note": "The official Coolidge Corner listing identifies 1294 Beacon St and gives daily branch hours. The supplied 366 Harvard St address could not be verified. Branch phone unconfirmed.",
      "hours_source": "https://www.amigosburritos.com/",
      "awards": [],
      "ratings": [
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.4,
          "count": 936,
          "url": "https://restaurantguru.com/Los-Amigos-Taqueria-Boston"
        },
        {
          "source": "Tripadvisor",
          "rating": 4.3,
          "count": 32,
          "url": "https://www.tripadvisor.com/Restaurant_Review-g60823-d10542679-Reviews-Los_Amigos_Taqueria-Brookline_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers recommend coconut shrimp and al pastor burritos.",
        "Diners describe ample seating and good portions for the price.",
        "Customers can customize bowls with steak or chicken and chipotle or avocado crema."
      ],
      "review_excerpts": [
        {
          "author": "Cuc Nguyen",
          "source": "Google (via Restaurant Guru)",
          "text": "My favorite is the coconut shrimp specialty burrito.",
          "rating": null,
          "date_label": "4 months ago",
          "url": "https://restaurantguru.com/Los-Amigos-Taqueria-Boston"
        },
        {
          "author": "Alex Soto",
          "source": "Google (via Restaurant Guru)",
          "text": "Amazing place for a burrito or a taco.",
          "rating": null,
          "date_label": "5 months ago",
          "url": "https://restaurantguru.com/Los-Amigos-Taqueria-Boston"
        }
      ],
      "review_sources": [
        "https://restaurantguru.com/Los-Amigos-Taqueria-Boston",
        "https://www.tripadvisor.com/Restaurant_Review-g60823-d10542679-Reviews-Los_Amigos_Taqueria-Brookline_Massachusetts.html"
      ]
    }
  },
  "coolidge-bab-01": {
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
        "22:00"
      ],
      "sat": [
        "11:30",
        "22:00"
      ],
      "sun": [
        "11:00",
        "21:00"
      ]
    },
    "details": {
      "checked_on": "2026-11-22",
      "address": "1374 Beacon St, Brookline, MA 02446",
      "website": "https://babkoreanbistro.server2.spotapps.co/",
      "phone": "617-383-5575",
      "hours_verified": true,
      "hours_note": "Uses the operator’s posted hours. Some third-party listings show midnight closing on Friday and Saturday.",
      "hours_source": "https://babkoreanbistro.server2.spotapps.co/Brookline-BAB-Korean-Bistro-locations",
      "awards": [],
      "ratings": [
        {
          "source": "Google (via Restaurant Guru)",
          "rating": 4.3,
          "count": 571,
          "url": "https://restaurantguru.com/Bab-Korean-Bistro-Brookline"
        },
        {
          "source": "Restaurantji",
          "rating": 4.1,
          "count": 243,
          "url": "https://www.restaurantji.com/ma/brookline/bab-korean-bistro-/"
        },
        {
          "source": "Tripadvisor",
          "rating": 3.6,
          "count": 14,
          "url": "https://www.tripadvisor.com/Restaurants-g60823-c10661-Brookline_Massachusetts.html"
        }
      ],
      "review_highlights": [
        "Reviewers like the crispy sweet-and-sour pork with black bean noodles.",
        "Cheesy tteokbokki with ramen draws praise for its generous portion.",
        "Banchan and attentive service are recurring positives, though some diners report slower food during busy periods."
      ],
      "review_excerpts": [
        {
          "author": "Jean L",
          "source": "Yelp (republished by BAB)",
          "text": "Tangsu pork was definitely very high quality. Very crispy. Nice sauce.",
          "rating": null,
          "date_label": null,
          "url": "https://babkoreanbistro.server2.spotapps.co/"
        },
        {
          "author": "Christine C",
          "source": "Yelp (republished by BAB)",
          "text": "Great place, large portions and reasonable prices.",
          "rating": null,
          "date_label": null,
          "url": "https://babkoreanbistro.server2.spotapps.co/"
        }
      ],
      "review_sources": [
        "https://restaurantguru.com/Bab-Korean-Bistro-Brookline",
        "https://www.restaurantji.com/ma/brookline/bab-korean-bistro-/",
        "https://www.tripadvisor.com/Restaurants-g60823-c10661-Brookline_Massachusetts.html",
        "https://babkoreanbistro.server2.spotapps.co/"
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
