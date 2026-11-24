// The word decks. Each entry is a pair of close words: one goes to everyone, the other is the odd one's decoy
// (decoy mode). Which side is which is picked at random each round, so both should work as the main word.
// Words mode: describe your word with one adjective. Jobs mode: say something that happens in that job.

export type Mode = "words" | "jobs";
export type Pair = readonly [string, string];

export const WORD_PAIRS: Pair[] = [
  ["Coffee", "Tea"], ["Beach", "Desert"], ["Pizza", "Burger"], ["Cat", "Dog"], ["Guitar", "Violin"],
  ["Rain", "Snow"], ["Wine", "Beer"], ["Train", "Bus"], ["Moon", "Sun"], ["Castle", "Palace"],
  ["Shark", "Dolphin"], ["Lemon", "Lime"], ["Wedding", "Funeral"], ["Pillow", "Blanket"], ["Volcano", "Earthquake"],
  ["Ghost", "Zombie"], ["Piano", "Organ"], ["Honey", "Jam"], ["Library", "Bookshop"], ["Rocket", "Aeroplane"],
  ["Lion", "Tiger"], ["Ice cream", "Frozen yogurt"], ["Sushi", "Ramen"], ["Hospital", "Prison"], ["Mirror", "Window"],
  ["Football", "Rugby"], ["Spider", "Scorpion"], ["Candle", "Torch"], ["Tattoo", "Piercing"], ["Gold", "Silver"],
  ["Hotel", "Hostel"], ["Submarine", "Ship"], ["Garlic", "Onion"], ["Popcorn", "Crisps"], ["Forest", "Jungle"],
  ["Diamond", "Pearl"], ["Lipstick", "Nail polish"], ["Chess", "Poker"], ["Hammer", "Axe"], ["Tornado", "Hurricane"],
  ["Cheese", "Butter"], ["Owl", "Bat"], ["Socks", "Gloves"], ["Bicycle", "Motorbike"], ["Cactus", "Bonsai"],
  ["Hangover", "Jet lag"], ["Gym", "Sauna"], ["Mosquito", "Wasp"], ["Chocolate", "Caramel"], ["Bath", "Shower"],
  ["Tent", "Caravan"], ["Penguin", "Polar bear"], ["Karaoke", "Concert"], ["Fireworks", "Bonfire"], ["Toothbrush", "Comb"],
  ["Pirate", "Viking"], ["Vampire", "Werewolf"], ["Mango", "Pineapple"], ["Umbrella", "Raincoat"], ["Elevator", "Escalator"],
  ["Crocodile", "Snake"], ["Netflix", "YouTube"], ["Selfie", "Passport photo"], ["Perfume", "Deodorant"], ["Bread", "Cake"],
  ["Wolf", "Fox"], ["Tequila", "Vodka"], ["Snail", "Slug"], ["Glasses", "Contact lenses"], ["Desk", "Table"],
  ["Lighthouse", "Windmill"], ["Kiss", "Hug"], ["Alarm clock", "Doorbell"], ["Banana", "Cucumber"], ["Igloo", "Treehouse"],
  ["Balloon", "Bubble"], ["Taxi", "Ambulance"], ["Frog", "Toad"], ["Soup", "Smoothie"], ["Breakup", "Divorce"],
  ["Casino", "Nightclub"], ["Horse", "Camel"], ["Thunder", "Lightning"], ["Sofa", "Bed"], ["Magnet", "Glue"],
  ["Crown", "Helmet"], ["Robot", "Alien"], ["Peach", "Apricot"], ["Bee", "Butterfly"], ["Sneeze", "Hiccup"],
  ["Microwave", "Oven"], ["Ladder", "Stairs"], ["Bank", "Post office"], ["Wallet", "Handbag"], ["Coconut", "Walnut"],
  ["Skateboard", "Surfboard"], ["Dragon", "Dinosaur"], ["Mermaid", "Fairy"], ["Ketchup", "Mustard"], ["Waterfall", "Fountain"],
  ["Gossip", "Rumour"], ["Bowling", "Golf"], ["Octopus", "Jellyfish"], ["Zoo", "Aquarium"], ["Beard", "Moustache"],
];

export const JOB_PAIRS: Pair[] = [
  ["Doctor", "Nurse"], ["Chef", "Baker"], ["Pilot", "Flight attendant"], ["Teacher", "Professor"], ["Firefighter", "Police officer"],
  ["Dentist", "Barber"], ["Lawyer", "Judge"], ["Plumber", "Electrician"], ["Farmer", "Gardener"], ["Actor", "Singer"],
  ["Astronaut", "Deep-sea diver"], ["Waiter", "Bartender"], ["Lifeguard", "Swimming coach"], ["Vet", "Zookeeper"], ["Photographer", "Painter"],
  ["Mechanic", "Engineer"], ["Taxi driver", "Bus driver"], ["Butcher", "Fishmonger"], ["Librarian", "Bookseller"], ["Surgeon", "Tattoo artist"],
  ["Postman", "Delivery driver"], ["DJ", "Radio host"], ["Clown", "Magician"], ["Soldier", "Security guard"], ["Accountant", "Banker"],
  ["Architect", "Builder"], ["Journalist", "Author"], ["Hairdresser", "Make-up artist"], ["Priest", "Therapist"], ["Detective", "Spy"],
  ["Cleaner", "Housekeeper"], ["Programmer", "Gamer"], ["Fisherman", "Sailor"], ["Pharmacist", "Scientist"], ["Referee", "Coach"],
  ["Tailor", "Fashion designer"], ["Personal trainer", "Yoga teacher"], ["Influencer", "Model"], ["Comedian", "News reader"], ["Cashier", "Shelf stacker"],
  ["Miner", "Lumberjack"], ["Undertaker", "Florist"], ["Wedding planner", "Event DJ"], ["Car salesman", "Estate agent"], ["Babysitter", "Dog walker"],
  ["Archaeologist", "Museum guide"], ["Paramedic", "Midwife"], ["Locksmith", "Burglar"], ["Window cleaner", "Roofer"], ["Barista", "Ice cream seller"],
  ["Tour guide", "Travel agent"], ["Translator", "Sign language interpreter"], ["Stunt double", "Racing driver"], ["Weather presenter", "Astrologer"], ["Ship captain", "Train driver"],
  ["Beekeeper", "Shepherd"], ["Poet", "Rapper"], ["Bouncer", "Bodyguard"], ["Sommelier", "Food critic"], ["Politician", "Salesperson"],
];

export const DECKS: Record<Mode, Pair[]> = { words: WORD_PAIRS, jobs: JOB_PAIRS };
