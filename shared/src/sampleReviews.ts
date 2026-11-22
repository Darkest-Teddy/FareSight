import type { Review } from './types.js';

const notes: Record<string, [string, string]> = {
  'kenmore-shudaxia-01': ['Hot pot works well when everyone orders a few ingredients to share. Decide on broth and a per-person budget before you start ordering.', 'I’d leave more time for a group dinner than for a quick bite. The shared pot makes it easy to linger while everyone cooks.'],
  'bu-starbucks-01': ['I’d leave a little time for the espresso line when classes let out. It’s a practical stop for coffee to go on Commonwealth Avenue.', 'For a short study break, I’d look for a seat before ordering. If the tables are full, it’s easy to take the drink back to campus.'],
  'bu-ramen-01': ['The tonkotsu bowl is a full meal on its own. The counter makes a solo lunch easy if you only have one break between classes.', 'Katsu curry is the bigger order. For four people I’d go before the dinner rush because the wall tables are limited.'],
  'bu-pavement-01': ['A bagel sandwich and coffee are enough for breakfast before class. I’d eat there for a short break and take it to go when the line grows.', 'The reading nook works for one person with a laptop. For group work I’d meet elsewhere if we need space to spread out.'],
  'bu-nudpob-01': ['Pad see ew travels well and the portion makes a solid lunch. It’s an easy stop when we’re already on Commonwealth Avenue.', 'The curries are a good share order for two. I’d leave more time during the class-change rush if we want a table.'],
  'bu-halal-01': ['A rice bowl goes further than a wrap for me. It’s useful when a group wants to eat together but order at different counters.', 'The hall is lively around lunch and hard to use for a quiet chat. Budget a few minutes for the walk from the platform and finding seats.'],
  'bu-beach-01': ['Bring your own lunch and a blanket. The lawn is an inexpensive place to sit with friends if it has been dry.', 'The river view is the draw. There’s little cover, so I’d have an indoor backup for rain or a windy afternoon.'],
  'bu-grill-01': ['A slice is quick between classes. A hot sub is a better pick when lunch needs to carry me through the afternoon.', 'I’d plan for takeout with a group. It’s an easy walk from the T, and that makes a short dinner stop practical.'],
  'allston-karaoke-01': ['Splitting the room by the hour makes sense with friends. Check how much time you want before comparing the per-person price.', 'The sofa wall is good for sitting while friends sing. I’d use the fit preview before booking if everyone wants to move around.'],
  'allston-brownsugar-01': ['Fried rice and a curry make a good pairing to share. A group can try more here than if everybody orders separately.', 'It’s a lively dinner room. I’d go earlier if the group wants an easier conversation and time to settle in.'],
  'allston-bostongoods-01': ['Come with time to browse the racks. The by-weight area is useful for a budget, but I’d check the price before the register.', 'The walk from the T is long enough that I’d pair this with another Allston stop. Good for a browsing afternoon with a friend.'],
  'allston-super88-01': ['Handy when one person wants dumplings and another just wants boba. We can split up for food and meet at a table.', 'The food court is more practical than quiet. I’d grab a table before everyone orders if we’re coming at the lunch rush.'],
  'allston-coreanos-01': ['Kimchi rice is the filling order. Tacos are easier to split if you’re trying a couple of things with a friend.', 'It’s more of a counter stop than a long dinner. With a larger group I’d get takeout and leave time for the walk.'],
  'allston-brightonmusic-01': ['The standing floor puts you close to the stage. If anyone needs to sit, check the event’s access details before buying.', 'Leave extra time for the walk from Packard’s Corner. The catalog price is a planning number, so check the specific show for tickets.'],
  'kenmore-fenway-01': ['I’d compare the seat view before paying for a ticket. A few rows can change how much of the field you can see.', 'Allow longer for the walk on game day. Families may want aisle seats if they expect to get up often.'],
  'kenmore-hob-01': ['General admission is good if you’re happy to stand. Check event-specific seating before bringing a group that needs chairs.', 'The walk is easy from Kenmore, but games across the street can make the area busy. I’d leave extra time before doors.'],
  'kenmore-jefes-01': ['A burrito is the better value if you need a whole meal. Tacos work as a quick bite when you’re headed to Fenway.', 'It’s close to the station and fits a late-night plan. On an event night I’d allow extra time for the order line.'],
  'kenmore-eastern-01': ['The burger is an approachable dinner order if the bigger plates push the budget. Booths suit a small group that wants to linger.', 'The bar is convenient for two. I’d check dinner availability for a bigger table before making the walk from Kenmore.'],
  'kenmore-esplanade-01': ['A picnic is a good low-cost option before sunset. Bring layers because the river path is exposed.', 'The walk from Kenmore is worth allowing time for. I’d decide on a meeting point before splitting up along the path.'],
  'harvard-cafe-01': ['Matcha and tiramisu are enough for a study break. The long tables are better for laptops than the smaller window seats.', 'I’d go earlier for quiet reading. A friend joining later can use the short walk from Harvard without losing much study time.'],
  'harvard-bookstore-01': ['The used section downstairs is worth checking first on a student budget. I’d give myself more time than I think I need.', 'It’s a short walk from Harvard and easy to pair with coffee. Better for a browse than a place to sit down with a group.'],
  'harvard-felipes-01': ['A burrito makes a full meal. A couple of tacos are easier to fit into a smaller budget or split with a friend.', 'Counter service keeps the stop quick. If the rooftop matters, check whether it’s open for the weather and season.'],
  'harvard-tatte-01': ['A pastry and coffee are good for a short stop. Shakshuka makes more sense if this is the main meal.', 'It’s close enough to the T for a quick meetup. For study time I’d go off-peak, when it’s easier to find a seat.'],
  'harvard-art-01': ['Free admission makes this easy to pair with lunch. Start with the courtyard if you only have time for a short visit.', 'Check the hours before going on a Monday. The walk through Harvard is manageable, but allow time if everyone is meeting at the T.'],
  'chinatown-heila-01': ['Dim sum is better with a group that wants to share. Start with a few baskets and add more if people are still hungry.', 'It works for a family lunch, but I’d leave time for a table on the weekend. From Chinatown station the walk itself is short.'],
  'chinatown-winsor-01': ['Ordering off the menu is convenient for two. Rice rolls and dumplings are an easy first round before deciding on more.', 'The café is compact. I’d go earlier if we need seats together and want a shorter lunch stop.'],
  'chinatown-genes-01': ['The hand-pulled noodles are the reason I’d go. One bowl is a filling lunch, especially if you aren’t sharing sides.', 'Limited counter seats make this better for one or two. Leave a few minutes for the walk and check the earlier closing time.'],
  'chinatown-hoyuen-01': ['An egg tart and a bun make a low-cost snack. Plan to take them away and eat somewhere nearby.', 'Works well as the last Chinatown stop before the T. I’d go early if we’re counting on a specific pastry.'],
  'chinatown-q-01': ['Hot pot makes sense for a group that wants to share and linger. A few ingredients can add up, so agree on a budget first.', 'It’s close to the T and useful before a theater show. Allow enough time for both seating and cooking at the table.'],
  'chinatown-taiwan-01': ['Rice dishes stretch the meal for a group. Soup dumplings are an easy starting order while everyone chooses plates to share.', 'Good for a sit-down dinner close to the T. I’d come early if we’re a larger group trying to keep a tight schedule.'],
};

const authors = ['Maya K.', 'Devon R.', 'Inez L.', 'Owen T.', 'Rina P.', 'Jordan C.', 'Leah S.'];

export function sampleReviews(placeId: string): Review[] {
  const first = [...placeId].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % authors.length;
  return (notes[placeId] ?? []).map((text, index) => ({
    id: `sample-review-${placeId}-${index + 1}`, author: authors[(first + index) % authors.length],
    text, sample: true, rating: 0, created_at: '2026-11-21T12:00:00.000Z',
  }));
}
