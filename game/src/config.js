// ISLA BRASA 3D — shared constants.
//
// Every system module reads its numbers from here, so the world, the
// missions, the garage, the crew and the police all agree about where a
// landmark is and what a car costs. Change a value here and the whole game
// follows.
//
// Coordinates: x runs east, z runs south, y is up, ground level is y = 0.
// The playable city is x/z in [-200, 200]; roads form a square grid.

// ---------------------------------------------------------------------------
// City layout
// ---------------------------------------------------------------------------

export const WORLD_SIZE = 400;
export const ROAD_SPACING = 40;
export const ROAD_LINES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
export const ROAD_WIDTH = 8;

// Landmark anchor points, as [x, z]. The canonical keys are the long names;
// missions refer to them by the short aliases in LANDMARK_ALIASES.
export const LANDMARKS = {
  plazaTower: [0, 0],
  feriaMarket: [0, -80],
  oldPier: [-160, 170],
  marinaDocks: [-120, 175],
  brasaGarage: [80, -40],
  rookArcade: [40, 80],
  coralCasino: [120, 120],
  coastTunnel: [-80, -160],
  motelVela: [-40, 40],
  underpass: [0, 150],
  oldChurch: [-120, -120],
  beachfront: [160, 170],
};

// Short mission keys ('market', 'pier', ...) -> canonical landmark keys.
export const LANDMARK_ALIASES = {
  market: 'feriaMarket',
  pier: 'oldPier',
  marina: 'marinaDocks',
  garage: 'brasaGarage',
  arcade: 'rookArcade',
  casino: 'coralCasino',
  tunnel: 'coastTunnel',
  motel: 'motelVela',
  underpass: 'underpass',
  church: 'oldChurch',
  plaza: 'plazaTower',
  beach: 'beachfront',
};

// Human-readable names, keyed by canonical landmark key.
export const LANDMARK_NAMES = {
  plazaTower: 'Plaza Tower',
  feriaMarket: 'Feria Market',
  oldPier: 'Old Pier',
  marinaDocks: 'Marina Docks',
  brasaGarage: 'Brasa Garage',
  rookArcade: 'Rook Arcade',
  coralCasino: 'Coral Room Casino',
  coastTunnel: 'Coast Tunnel',
  motelVela: 'Motel Vela',
  underpass: 'Underpass',
  oldChurch: 'Old Church',
  beachfront: 'Beachfront',
};

// The sea along the south edge; the pier, marina and beach sit on it.
export const WATER_Z_MIN = 165;
export const WATER_Z_MAX = 200;

// The Brasa Air runway along the north edge.
export const RUNWAY_Z = -195;
export const RUNWAY_X_MIN = -150;
export const RUNWAY_X_MAX = 150;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const START_CASH = 500;
export const PLAYER_WALK_SPEED = 6;
export const PLAYER_RUN_SPEED = 11;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_JUMP_SPEED = 7.5;
export const GRAVITY = 20;
export const PLAYER_SPAWN = { x: 0, z: 8 };

// Outfit colours. player.js recolours the player mesh from these entries;
// the clothes shop sells by id, so every sold id needs an entry here.
export const OUTFITS = {
  default: { shirt: 0x2e86c1, pants: 0x2c3e50, sleeves: 0x2e86c1, shoes: 0x1a1a1a, hair: 0x2b1d12 },
  street: { shirt: 0xe74c3c, pants: 0x34495e, sleeves: 0xe74c3c, shoes: 0xf5f5f5, hair: 0x111111 },
  suit: { shirt: 0x1c1c1c, pants: 0x1c1c1c, sleeves: 0x1c1c1c, shoes: 0x000000, hair: 0x3a2a1a },
  beach: { shirt: 0x1abc9c, pants: 0xe8d27a, sleeves: 0x1abc9c, shoes: 0x8b5a2b, hair: 0x6b4a1f },
  biker: { shirt: 0x111111, pants: 0x2f3542, sleeves: 0x111111, shoes: 0x222222, hair: 0x000000 },
  club: { shirt: 0x9b2c2c, pants: 0x1a202c, sleeves: 0x9b2c2c, shoes: 0xd53f8c, hair: 0x111111 },
};

// ---------------------------------------------------------------------------
// Missions — 12 story missions, $10,510 total (see the round-4 mission spec).
// The missions module owns the step engine; this array is only the data.
// Step kinds: goto, collect (count), clear (count), steal, deliver (inCar?).
// ---------------------------------------------------------------------------

export const MISSIONS = [
  {
    id: 1, name: 'Tamale Run', payout: 740,
    brief: "Hot tamales from Feria Market to the beach and the plaza. Don't let them go cold.",
    steps: [
      { kind: 'collect', at: 'market', count: 3, label: 'Pick up 3 tamale crates' },
      { kind: 'deliver', at: 'beach', label: 'Deliver to the Beachfront' },
      { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 2, name: 'The Vela Job', payout: 800,
    brief: 'A car is waiting at Motel Vela. Take it and bring it to Rook Arcade — quietly.',
    steps: [
      { kind: 'goto', at: 'motel', label: 'Reach Motel Vela' },
      { kind: 'steal', at: 'motel', label: 'Take the car' },
      { kind: 'deliver', at: 'arcade', inCar: true, label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 3, name: 'Feria Shakedown', payout: 990,
    brief: "Delgado's men are shaking down the market stalls. Clear them out, grab the cash, and take a getaway car.",
    steps: [
      { kind: 'clear', at: 'market', count: 5, label: "Clear 5 of Delgado's men" },
      { kind: 'collect', at: 'market', count: 2, label: 'Collect the cash' },
      { kind: 'steal', at: 'market', label: 'Take a getaway car' },
      { kind: 'deliver', at: 'arcade', inCar: true, label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 4, name: 'Coral Room Getaway', payout: 1300, timed: 150,
    brief: 'Hit the Coral Room Casino, grab the chips, and lose the cops in the Coast Tunnel. 150 seconds.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Reach the casino' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 chip cases' },
      { kind: 'deliver', at: 'tunnel', label: 'Escape to the Coast Tunnel' },
    ],
  },
  {
    id: 5, name: 'Last Call', payout: 850,
    brief: 'Four drops, one night: the pier, the motel, the underpass and the church. Then report back to Rook.',
    steps: [
      { kind: 'deliver', at: 'pier', label: 'Drop 1: Old Pier' },
      { kind: 'deliver', at: 'motel', label: 'Drop 2: Motel Vela' },
      { kind: 'deliver', at: 'underpass', label: 'Drop 3: Underpass' },
      { kind: 'deliver', at: 'church', label: 'Drop 4: Old Church' },
      { kind: 'goto', at: 'arcade', label: 'Report to Rook Arcade' },
    ],
  },
  {
    id: 6, name: 'Dawn Dash', payout: 880, timed: 120,
    brief: 'Rush delivery: hot plates from the market to the beach AND the plaza before the sun is up. 120 seconds.',
    steps: [
      { kind: 'collect', at: 'market', count: 2, label: 'Pick up the plates' },
      { kind: 'deliver', at: 'beach', label: 'Deliver to the Beachfront' },
      { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 7, name: 'Hot Plate', payout: 860, timed: 90,
    brief: "A rival crew's courier car is waiting at the marina. Take it and get the plaza tower menu there by lunch. 90 seconds.",
    steps: [
      { kind: 'steal', at: 'marina', label: 'Take the courier car' },
      { kind: 'deliver', at: 'plaza', inCar: true, label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 8, name: 'Pier Pressure', payout: 750,
    brief: "Crates are piling up at the pier and Delgado's crew is guarding them. Clear the crew, grab the crates, stash them at the church.",
    steps: [
      { kind: 'clear', at: 'pier', count: 3, label: 'Clear 3 guards' },
      { kind: 'collect', at: 'pier', count: 5, label: 'Collect 5 crates' },
      { kind: 'deliver', at: 'church', label: 'Stash them at the Old Church' },
    ],
  },
  {
    id: 9, name: 'Motel Stakeout', payout: 800,
    brief: 'A snitch is holed up at Motel Vela. Get close, grab the ledger, deal with his guards, and slip away to Rook.',
    steps: [
      { kind: 'goto', at: 'motel', label: 'Reach Motel Vela' },
      { kind: 'collect', at: 'motel', count: 1, label: 'Grab the ledger' },
      { kind: 'clear', at: 'motel', count: 2, label: 'Deal with 2 guards' },
      { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 10, name: 'Tunnel Run', payout: 820,
    brief: 'The Coast Tunnel is the only way past the roadblocks tonight. Take a fast car, thread the tunnel, and hit the marina then the beach.',
    steps: [
      { kind: 'steal', at: 'tunnel', label: 'Take a fast car' },
      { kind: 'deliver', at: 'marina', inCar: true, label: 'Drop 1: Marina Docks' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Drop 2: Beachfront' },
    ],
  },
  {
    id: 11, name: 'Casino Chips', payout: 850,
    brief: 'The Coral Room is moving chips. Hit the casino floor, take the cases, then fight off the reinforcements at the plaza and keep the cut.',
    steps: [
      { kind: 'clear', at: 'casino', count: 5, label: 'Clear 5 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Take 3 chip cases' },
      { kind: 'clear', at: 'plaza', count: 3, label: 'Fight off 3 reinforcements' },
      { kind: 'deliver', at: 'plaza', label: 'Keep the cut at Plaza Tower' },
    ],
  },
  {
    id: 12, name: 'The Big One', payout: 870, timed: 240,
    brief: 'The final heist: lift the vault cash at the casino, clear the guards, take the getaway car, shake the tail at the beach, and meet Rook. 240 seconds.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Reach the casino' },
      { kind: 'clear', at: 'casino', count: 4, label: 'Clear 4 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 vault cases' },
      { kind: 'steal', at: 'casino', label: 'Take the getaway car' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Shake the tail at the Beachfront' },
      { kind: 'goto', at: 'arcade', label: 'Meet Rook and finish' },
    ],
  },
];

export const MISSION_TOTAL = MISSIONS.reduce((sum, m) => sum + m.payout, 0); // 10,510

// Heist chain (missions 13-15): unlocks after mission 12. Total +$5,000.
export const HEIST = [
  {
    id: 13, part: 1, name: 'Heist: The Plan', payout: 1000,
    brief: 'The Coral Room vault. Case the casino, grab the floor plans, and meet Ghost at the garage.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Case the Coral Room Casino' },
      { kind: 'collect', at: 'casino', count: 2, label: 'Grab 2 floor plans' },
      { kind: 'goto', at: 'garage', label: 'Meet Ghost at Brasa Garage' },
    ],
  },
  {
    id: 14, part: 2, name: 'Heist: Infiltrate', payout: 1500,
    brief: 'Inside the Coral Room. Clear the vault guards and lift the cash — quiet if you can, loud if you must.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Slip into the casino' },
      { kind: 'clear', at: 'casino', count: 4, label: 'Clear 4 vault guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Lift 3 vault bags' },
    ],
  },
  {
    id: 15, part: 3, name: 'Heist: Getaway', payout: 2500, timed: 180,
    brief: 'The alarm is up. Take the getaway car, lose the tail at the beach, and vanish through the Coast Tunnel. 180 seconds.',
    steps: [
      { kind: 'steal', at: 'casino', label: 'Take the getaway car' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Lose the tail at the Beachfront' },
      { kind: 'deliver', at: 'tunnel', inCar: true, label: 'Vanish through the Coast Tunnel' },
    ],
  },
];

export const HEIST_TOTAL = HEIST.reduce((sum, m) => sum + m.payout, 0); // 5,000

// ---------------------------------------------------------------------------
// Garage cars (cheapest first). Ids match state.carsOwned entries.
// ---------------------------------------------------------------------------

export const GARAGE_CARS = [
  { id: 'sedan', name: 'Brasa Sedan', price: 2800, topSpeed: 26, accel: 10, handling: 1.0 },
  { id: 'coupe', name: 'Vela Coupe', price: 5000, topSpeed: 32, accel: 13, handling: 1.1 },
  { id: 'sport', name: 'Coral Sport', price: 8000, topSpeed: 38, accel: 16, handling: 1.25 },
  { id: 'supercar', name: 'Isla GT', price: 12000, topSpeed: 46, accel: 20, handling: 1.4 },
];
export const GARAGE_CAR_PRICES = [2800, 5000, 8000, 12000];

// Selling a car pays back 60% of its price plus 40% of upgrade spend.
export const SELL_BACK_RATE = 0.6;
export const SELL_UPGRADE_RATE = 0.4;

// Garage upgrades: engine / armor / handling, 3 tiers each.
export const UPGRADE_MAX_TIER = 3;
export const UPGRADE_PARTS = ['engine', 'armor', 'handling'];

// ---------------------------------------------------------------------------
// Crew for hire. Each levels 0-3 by helping in missions.
// ---------------------------------------------------------------------------

export const CREW = {
  rico: { id: 'rico', name: 'Rico Vega', role: 'driver', price: 1500 },
  marta: { id: 'marta', name: 'Marta Solis', role: 'gunman', price: 2000 },
  ghost: { id: 'ghost', name: 'Ghost', role: 'hacker', price: 2500 },
};

// ---------------------------------------------------------------------------
// Extra vehicles and heavy weapons (shop prices).
// ---------------------------------------------------------------------------

export const MOTORBIKE_PRICE = 1500;
export const BOAT_PRICE = 4500;
export const SNIPER_PRICE = 6000;
export const RPG_PRICE = 9000;

// ---------------------------------------------------------------------------
// Properties: buy once, income lands every in-game day.
// ---------------------------------------------------------------------------

export const PROPERTIES = {
  safehouse: { id: 'safehouse', name: 'Vela Safehouse', price: 5000, income: 100 },
  shop: { id: 'shop', name: 'Feria Shop', price: 12000, income: 300 },
  nightclub: { id: 'nightclub', name: 'Coral Nightclub', price: 25000, income: 800 },
};

// ---------------------------------------------------------------------------
// Side jobs
// ---------------------------------------------------------------------------

export const SIDE_JOBS = {
  taxi: 120, // dollars per taxi fare
  delivery: 100, // dollars per delivery
  deliveryFastBonus: 50, // bonus for a fast delivery
  orb: 50, // dollars per collectible orb
};
export const ORB_COUNT = 10;

// ---------------------------------------------------------------------------
// Weapon wheel (hold Q). Sniper and RPG come from the weapon shop.
// ---------------------------------------------------------------------------

export const WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rpg'];
export const WEAPON_STATS = {
  fists: { damage: 10, range: 2, rate: 2.0 },
  pistol: { damage: 20, range: 40, rate: 2.5 },
  smg: { damage: 12, range: 32, rate: 8.0 },
  shotgun: { damage: 45, range: 16, rate: 1.0 },
  rifle: { damage: 35, range: 70, rate: 4.0 },
  sniper: { damage: 90, range: 120, rate: 0.8 },
  rpg: { damage: 150, range: 80, rate: 0.5 },
};

// ---------------------------------------------------------------------------
// Street races: beat the clock through the checkpoints for a prize.
// ---------------------------------------------------------------------------

export const RACES = ['Malecon Sprint', 'Old Town Circuit', 'Beachfront Dash'];

// ---------------------------------------------------------------------------
// Respect ranks. Legend needs 35,000; each rank adds +5% mission payout.
// ---------------------------------------------------------------------------

export const RESPECT_RANKS = ['Nobody', 'Hustler', 'Dealer', 'Boss', 'Kingpin', 'Legend'];
export const RESPECT_TOTAL = 35000;
export const RESPECT_PAYOUT_BONUS_PER_RANK = 0.05;

// ---------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------

export const DAY_LENGTH_SECONDS = 360; // one full day/night cycle
export const DAY_LENGTH = DAY_LENGTH_SECONDS; // alias some modules use
export const RAIN_GRIP = 0.75; // car grip factor while it rains
export const RAIN_DROPS = 900; // rain streaks (weather.js)
export const PARTICLE_MAX = 400; // particle ring-buffer size (particles.js)
export const BPM = 112; // default music tempo (audio.js)

// Brasa Air plane: this speed to take off, this height is the ceiling.
export const PLANE_TAKEOFF_SPEED = 22;
export const PLANE_CEILING = 120;

// ---------------------------------------------------------------------------
// Police
// ---------------------------------------------------------------------------

export const WANTED_MAX = 5;
export const ROADBLOCK_WANTED = 3; // roadblocks + CONDOR-1 heli at 3+ stars

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export const SAVE_KEY = 'islaBrasaSave';

// Everything in one object, for modules that prefer a single import.
export const CONFIG = {
  WORLD_SIZE,
  ROAD_SPACING,
  ROAD_LINES,
  ROAD_WIDTH,
  LANDMARKS,
  LANDMARK_ALIASES,
  LANDMARK_NAMES,
  WATER_Z_MIN,
  WATER_Z_MAX,
  RUNWAY_Z,
  RUNWAY_X_MIN,
  RUNWAY_X_MAX,
  START_CASH,
  PLAYER_WALK_SPEED,
  PLAYER_RUN_SPEED,
  PLAYER_MAX_HEALTH,
  PLAYER_JUMP_SPEED,
  GRAVITY,
  PLAYER_SPAWN,
  OUTFITS,
  MISSIONS,
  MISSION_TOTAL,
  HEIST,
  HEIST_TOTAL,
  GARAGE_CARS,
  GARAGE_CAR_PRICES,
  SELL_BACK_RATE,
  SELL_UPGRADE_RATE,
  UPGRADE_MAX_TIER,
  UPGRADE_PARTS,
  CREW,
  MOTORBIKE_PRICE,
  BOAT_PRICE,
  SNIPER_PRICE,
  RPG_PRICE,
  PROPERTIES,
  SIDE_JOBS,
  ORB_COUNT,
  WEAPONS,
  WEAPON_STATS,
  RACES,
  RESPECT_RANKS,
  RESPECT_TOTAL,
  RESPECT_PAYOUT_BONUS_PER_RANK,
  DAY_LENGTH_SECONDS,
  DAY_LENGTH,
  RAIN_GRIP,
  RAIN_DROPS,
  PARTICLE_MAX,
  BPM,
  PLANE_TAKEOFF_SPEED,
  PLANE_CEILING,
  WANTED_MAX,
  ROADBLOCK_WANTED,
  SAVE_KEY,
};

export default CONFIG;
