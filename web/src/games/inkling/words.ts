// Inkling's own word list: everyday things for a room of adults, with no brand names and no people's names.
// One line per category and difficulty (1 easy, 2 medium, 3 hard), comma-separated.
//   "donut|doughnut"  other spellings that also count as right
//   "couch~sofa"      near misses that earn a private "close!" (a synonym, a nickname)
export interface Word {
  /** The word as shown (lower case). */
  w: string;
  /** 1 easy, 2 medium, 3 hard. */
  d: 1 | 2 | 3;
  cat: string;
  /** Other spellings that count as right. */
  same: string[];
  /** Near misses: "close!". */
  near: string[];
}

const RAW: Record<string, [string, string, string]> = {
  food: [
    "apple, banana, pizza, cake, egg, bread, cheese, carrot, cherry, grapes, lemon, pear, cookie~biscuit, ice cream, hot dog, burger|hamburger, sandwich, soup, corn, onion, potato, tomato, donut|doughnut, popcorn, strawberry, pineapple, watermelon, pie, candy~sweets",
    "pancake, waffle, taco, sushi, noodles~ramen, broccoli, mushroom, garlic, avocado, coconut, pretzel, croissant, cupcake~muffin, lollipop, honey, salad, steak, sausage, bacon, omelette|omelet, peanut, popsicle|ice lolly, fries|french fries~chips, olive, salt, coffee, tea, milkshake, chili|chilli, lobster",
    "fondue, smoothie, birthday cake, spaghetti~pasta, dumpling, kebab, burrito, cheese board, fortune cookie, wedding cake, food truck, barbecue|bbq, picnic, leftovers, brunch, breakfast in bed, cocktail, hangover, espresso, room service",
  ],
  home: [
    "bed, chair, table, door, window, lamp, clock, cup~mug, plate, fork, spoon, knife, key, bath|bathtub, toilet, couch~sofa, pillow, bucket, box, candle, mirror, towel, soap, broom, rug~carpet, stairs, fridge|refrigerator, oven, kettle, teapot",
    "blanket, curtain, bookshelf, toothbrush, toothpaste, hairdryer|hair dryer, vacuum|vacuum cleaner|hoover, washing machine, dishwasher, frying pan~pan, microwave, light bulb|lightbulb, doorbell, mailbox|letterbox, fireplace, chandelier, bunk bed, hammock, ironing board, laundry, alarm clock, coat hanger|hanger, plug, fan, remote control|remote, rocking chair, wine glass, bottle, corkscrew, ladder",
    "smoke alarm, junk drawer, spare key, power cut|blackout|power outage, houseplant|house plant, garden gnome|gnome, welcome mat|doormat, dust bunny, leaky tap|leaky faucet, extension cord, fridge magnet, sock drawer, pillow fight, bed sheet, shower curtain",
  ],
  animals: [
    "cat~kitten, dog~puppy, fish, bird, cow, pig, horse~pony, duck, snake, frog, mouse~rat, rabbit~bunny, bee, spider, lion, bear, monkey, elephant, giraffe, shark, whale, turtle~tortoise, owl, sheep~lamb, chicken~hen, snail, butterfly, ant, crab, zebra",
    "octopus, penguin, kangaroo, crocodile~alligator, dolphin, flamingo, peacock, squirrel, hedgehog, bat, camel, jellyfish, seahorse, parrot, ostrich, goldfish, ladybug|ladybird, mosquito, worm, deer, fox, wolf, goat, donkey, beaver, panda, koala, hamster, starfish, swan",
    "chameleon, platypus, porcupine, sloth, walrus, narwhal, stingray, hermit crab, woodpecker, caterpillar, scorpion, tadpole, moose, skunk, llama~alpaca",
  ],
  nature: [
    "sun, moon, star, tree, flower, cloud, rain, snow, leaf, rock~stone, mountain, river, beach, island, fire, rainbow, grass, sea~ocean, wave, lake",
    "volcano, waterfall, desert, cactus, palm tree, lightning, tornado, snowflake, iceberg, cave, forest, sunset~sunrise, puddle, thunderstorm|storm, acorn, pine cone|pinecone, seashell|shell, cliff, comet, planet",
    "eclipse, avalanche, earthquake, constellation, northern lights|aurora, quicksand, sand dune|dune, hot spring, rock pool|tide pool, shooting star, heatwave|heat wave, fog, hailstorm|hail, glacier, meteor",
  ],
  things: [
    "ball, book, pen, pencil, hat~cap, shoe, sock, glasses, ring, crown, bag, phone, camera, umbrella, balloon, gift|present, kite, flag, bell, drum, guitar, scissors, hammer, nail, coin, map, envelope~letter, button, robot, sword",
    "backpack|rucksack, suitcase, wallet~purse, necklace, lipstick, perfume, sunglasses, headphones, microphone|mic, magnifying glass, telescope, compass, flashlight|torch, paintbrush, trumpet, violin, piano, saxophone, harp, dice, chess, puzzle, padlock|lock, battery, magnet, calculator, keyboard, laptop, television|tv, newspaper, stamp, trophy, medal, shield, anchor, rope, chain, paperclip|paper clip, stapler, candlestick",
    "fire extinguisher, hourglass, snow globe, message in a bottle, treasure chest, sewing machine, typewriter, metronome, record player, disco ball, piggy bank, lava lamp, bubble wrap, rubber duck, wind chime, crystal ball, duct tape, sticky note, safety pin, mousetrap, boomerang, parachute, jigsaw, fidget spinner, tape measure",
  ],
  clothes: [
    "shirt, t-shirt|tshirt|tee, dress, skirt, coat~jacket, scarf, glove, boot, belt, tie, sweater|jumper, shorts, pyjamas|pajamas, sandal",
    "bow tie, high heels, flip flops, raincoat, bathrobe|dressing gown, swimsuit~bikini, hoodie, overalls, apron, mittens, beanie, cowboy hat, top hat, slippers, wig",
    "wedding dress, tuxedo, onesie, cardigan, leg warmers, bum bag|fanny pack, monocle, tiara, sombrero, ugly sweater|christmas jumper",
  ],
  transport: [
    "car, bus, bicycle|bike, boat, train, airplane|plane|aeroplane, truck|lorry, ship, rocket, taxi|cab",
    "helicopter, submarine, sailboat|sailing boat, canoe~kayak, scooter, skateboard, tractor, ambulance, fire truck|fire engine, motorcycle|motorbike, hot air balloon, tram, bulldozer, limousine|limo, caravan~camper van",
    "traffic jam, speed bump, roundabout, parking ticket, flat tyre|flat tire, gondola, cable car, rickshaw, jet ski, airship~blimp, unicycle, road trip, car wash, toll booth, seat belt|seatbelt",
  ],
  places: [
    "house~home, school, castle, farm, zoo, park, shop~store, bridge, tower, church, hospital, garden, kitchen, office, pool",
    "lighthouse, airport, library, museum, prison|jail, igloo, pyramid, windmill, barn, skyscraper, playground, campsite, cinema|movie theater, stadium, bakery, factory, petrol station|gas station, supermarket, haunted house, treehouse|tree house, tent",
    "bowling alley, laundromat, waiting room, escape room, karaoke bar, nightclub|night club, car park|parking lot, rooftop bar, dentist office, wine cellar, ski lift, ferris wheel|big wheel, roller coaster|rollercoaster, carousel|merry go round, maze",
  ],
  doing: [
    "swimming, running, sleeping, dancing, singing, cooking, reading, jumping, flying, eating, laughing, crying, painting, skiing, surfing",
    "juggling, yoga, camping, fishing, gardening, knitting, bowling, sunbathing, snoring, sneezing, yawning, hiking, skydiving, karate, boxing, archery, golf, tennis, bungee jump|bungee jumping, sleepwalking, whistling, high five, selfie, blowing bubbles, ice skating",
    "online dating, job interview, moving house, first date, tax return, group chat, midlife crisis, power nap, brain freeze, road rage, small talk, binge watching, speed dating, karaoke, stand up comedy|standup, photobomb, lie in|sleep in, shopping spree, dad joke, lottery ticket",
  ],
  body: [
    "eye, ear, nose, mouth, hand, foot, tooth, hair, heart, brain, bone, finger, leg, arm",
    "skeleton, mustache|moustache, beard, tattoo, freckles, eyebrow, lips, elbow, knee, belly button|navel, fingerprint, wink",
    "goosebumps, double chin, bad hair day, pins and needles, funny bone, crows feet, six pack, hiccups",
  ],
  people: [
    "ghost, alien, monster, dragon, witch, angel, snowman, baby, king~queen, pirate",
    "mermaid, unicorn, vampire, zombie, wizard, fairy, superhero, scarecrow, mummy, chef|cook, pilot, doctor~nurse, farmer, clown, astronaut, firefighter|fireman, painter, plumber, waiter|waitress, judge, detective, magician, ninja, cowboy",
    "genie, yeti~bigfoot, werewolf, lifeguard, lumberjack, beekeeper, lion tamer, mime, ventriloquist, zookeeper, dentist, barber~hairdresser, dj, photographer, tour guide, bouncer, sumo wrestler",
  ],
  stuff: [
    "computer, game, music, party, money, birthday, dream, holiday~vacation, smile",
    "password, wifi, emoji, video call, low battery, spam, fireworks, confetti, piñata|pinata, campfire, snowball, sandcastle, treasure map, magic wand~wand",
    "wedding, graduation, retirement, jet lag, deadline, monday morning, out of office, sore loser, plot twist, silent disco, déjà vu|deja vu, cliffhanger, inside joke, white lie, snooze button",
  ],
};

/** Lower case, accents and punctuation off, single spaces: how guesses and words are compared. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function build(): Word[] {
  const out: Word[] = [];
  for (const [cat, levels] of Object.entries(RAW)) {
    levels.forEach((line, i) => {
      for (const item of line.split(",")) {
        const t = item.trim();
        if (!t) continue;
        const [spell, ...near] = t.split("~");
        const [w, ...same] = spell!.split("|");
        out.push({ w: w!.trim(), d: (i + 1) as 1 | 2 | 3, cat, same: same.map((x) => x.trim()), near: near.map((x) => x.trim()) });
      }
    });
  }
  return out;
}

export const WORDS: readonly Word[] = build();
export const wordByText = new Map(WORDS.map((w) => [norm(w.w), w]));
